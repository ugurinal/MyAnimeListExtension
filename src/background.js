/*
 * background.js — MV3 service worker.
 *
 * Owns:
 *  - OAuth2 + PKCE with MyAnimeList (see captureOAuthRedirectViaTab).
 *  - Token storage + refresh.
 *  - MAL API v2 calls: search anime, patch my_list_status.
 *  - Per-tab cache of the latest detection reported by the content script.
 *  - Auto-update handling when the content script signals EPISODE_WATCHED.
 *
 * IMPORTANT MAL details, both of which look wrong but are not:
 *  - The MyAnimeList OAuth endpoint only supports the PKCE "plain" code-challenge
 *    method. That means code_challenge === code_verifier and
 *    code_challenge_method=plain.
 *  - MAL authenticates the client at its token endpoint, so the Client Secret is
 *    REQUIRED even with PKCE — omitting it fails with 401 invalid_client. The user
 *    supplies their own Client ID + Secret (stored in chrome.storage.local); the
 *    extension ships without credentials of its own.
 *  - chrome.identity.launchWebAuthFlow is deliberately NOT used; its cookieless
 *    window makes MAL's authorize page refuse to render. See connect().
 */

"use strict";

const MAL_AUTH_URL = "https://myanimelist.net/v1/oauth2/authorize";
const MAL_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const MAL_API_BASE = "https://api.myanimelist.net/v2";

// ---- Storage keys ---------------------------------------------------------
const K = {
  clientId: "clientId",
  clientSecret: "clientSecret", // MAL "web" apps require this at the token endpoint
  autoUpdate: "autoUpdate",
  tokens: "tokens", // { access_token, refresh_token, expires_at }
  slugMap: "slugMap", // { [seriesSlug]: malAnimeId } — confirmed match cache
};

// In-memory cache of detections keyed by tabId.
const detectionsByTab = new Map();

// ---- Small storage helpers ------------------------------------------------
function get(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function set(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

// ---- PKCE helpers ---------------------------------------------------------

// MAL uses the "plain" method, so the verifier is used directly as the challenge.
// The verifier must be 43–128 chars from the unreserved set [A-Za-z0-9-._~].
function generateCodeVerifier() {
  const bytes = new Uint8Array(96);
  crypto.getRandomValues(bytes);
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
  return out; // 96 chars, within the 43–128 range.
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The redirect URI that launchWebAuthFlow round-trips through. The user must
// register EXACTLY this value in their MAL app config. It has the form
// https://<extension-id>.chromiumapp.org/
function redirectUri() {
  return chrome.identity.getRedirectURL();
}

// ---- OAuth flow -----------------------------------------------------------

async function connect() {
  const { [K.clientId]: clientId, [K.clientSecret]: clientSecret } = await get([
    K.clientId,
    K.clientSecret,
  ]);
  if (!clientId) {
    throw new Error("No MAL Client ID set. Add it in the extension settings first.");
  }

  const codeVerifier = generateCodeVerifier();
  const state = randomState();
  const redirect = redirectUri();

  const authUrl =
    `${MAL_AUTH_URL}?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&code_challenge=${encodeURIComponent(codeVerifier)}` + // plain: challenge == verifier
    `&code_challenge_method=plain` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}`;

  console.log("[MAL] redirect_uri =", redirect);
  console.log("[MAL] authorize URL =", authUrl);

  // NOTE: we deliberately do NOT use chrome.identity.launchWebAuthFlow here.
  // Its isolated auth window loads MAL's authorize page in a cookie-less
  // context that MAL's front end refuses to render ("Authorization page could
  // not be loaded" with no window shown). Opening the sign-in in a normal
  // browser tab uses the full browsing context (cookies, anti-bot clearance),
  // so the page renders exactly like it does when pasted into the address bar.
  // We then intercept MAL's redirect back to our chromiumapp.org redirect_uri.
  const redirectResponse = await captureOAuthRedirectViaTab(authUrl, redirect);
  console.log("[MAL] captured redirect =", redirectResponse);

  // Parse code + state out of the returned redirect URL.
  const returned = new URL(redirectResponse);
  const returnedState = returned.searchParams.get("state");
  const code = returned.searchParams.get("code");
  const err = returned.searchParams.get("error");
  if (err) throw new Error(`MAL authorization error: ${err}`);
  if (!code) throw new Error("No authorization code returned by MAL.");
  if (returnedState !== state) throw new Error("OAuth state mismatch (possible CSRF).");

  // Exchange the code for tokens.
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier, // plain PKCE proof
    redirect_uri: redirect,
  });
  // MAL authenticates the client at the token endpoint; without the secret it
  // returns 401 invalid_client even for the PKCE flow.
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetch(MAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[MAL] token exchange failed", res.status, text);
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  await storeTokens(json);
  console.log("[MAL] connected — tokens stored");
  return { ok: true };
}

// Opens the MAL sign-in in a normal tab and resolves with the full redirect URL
// (https://<ext-id>.chromiumapp.org/?code=...&state=...) once MAL bounces back
// to our registered redirect_uri. The chromiumapp.org host doesn't serve a real
// page, but tabs.onUpdated reports the navigation URL before/while it loads, so
// we grab the code from there and close the tab. Rejects if the user closes the
// tab first or nothing arrives within the timeout.
function captureOAuthRedirectViaTab(authUrl, redirect) {
  return new Promise((resolve, reject) => {
    let authTabId = null;
    let settled = false;
    let timer = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (timer) clearTimeout(timer);
    };

    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (authTabId != null) {
        // Close the sign-in tab; ignore errors if it's already gone.
        chrome.tabs.remove(authTabId, () => void chrome.runtime.lastError);
      }
      ok ? resolve(value) : reject(value);
    };

    const consider = (url) => {
      if (url && url.startsWith(redirect)) finish(true, url);
    };

    const onUpdated = (tabId, changeInfo, tab) => {
      if (tabId !== authTabId) return;
      // The redirect target shows up as changeInfo.url (navigation start) or, on
      // some Chrome builds, only as tab.pendingUrl/tab.url — check all of them.
      consider(changeInfo.url || (tab && (tab.pendingUrl || tab.url)));
    };

    const onRemoved = (tabId) => {
      if (tabId === authTabId) {
        finish(false, new Error("Sign-in tab was closed before completing."));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.create({ url: authUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        finish(false, new Error(chrome.runtime.lastError?.message || "Could not open the sign-in tab."));
        return;
      }
      authTabId = tab.id;
      // In case the redirect already happened between create and listener setup.
      consider(tab.pendingUrl || tab.url);
    });

    // Don't leak listeners if the user never finishes.
    timer = setTimeout(() => {
      finish(false, new Error("Timed out waiting for MyAnimeList sign-in."));
    }, 5 * 60 * 1000);
  });
}

async function storeTokens(tokenJson) {
  const expiresInSec = Number(tokenJson.expires_in || 0);
  const tokens = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    // Refresh a bit early (60s skew) to avoid edge-of-expiry failures.
    expires_at: Date.now() + Math.max(0, expiresInSec - 60) * 1000,
  };
  await set({ [K.tokens]: tokens });
}

async function refreshTokens() {
  const { [K.clientId]: clientId, [K.clientSecret]: clientSecret, [K.tokens]: tokens } =
    await get([K.clientId, K.clientSecret, K.tokens]);
  if (!tokens || !tokens.refresh_token) throw new Error("Not connected to MAL.");
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetch(MAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    // Refresh token is dead — force a fresh connect.
    await set({ [K.tokens]: null });
    throw new Error("Session expired. Please reconnect MyAnimeList.");
  }
  const json = await res.json();
  await storeTokens(json);
  return json.access_token;
}

// Returns a valid access token, refreshing if needed. Throws if not connected.
async function getAccessToken() {
  const { [K.tokens]: tokens } = await get(K.tokens);
  if (!tokens || !tokens.access_token) throw new Error("Not connected to MyAnimeList.");
  if (Date.now() >= tokens.expires_at) return refreshTokens();
  return tokens.access_token;
}

// ---- MAL API calls --------------------------------------------------------

// Wrapper that attaches the bearer token and retries once after a refresh on 401.
async function malFetch(path, options = {}, _retried = false) {
  const token = await getAccessToken();
  const res = await fetch(`${MAL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && !_retried) {
    await refreshTokens();
    return malFetch(path, options, true);
  }
  return res;
}

// Defensively sanitize a search query before it's percent-encoded and sent to
// MAL. cleanAnimeTitle() already strips a trailing "(YYYY)" year, but this is a
// last line of defense: MAL's edge WAF returns a plain-HTML 403 ("friendly error
// page") for queries containing parentheses/brackets (they percent-encode to
// %28/%29 etc.), so strip any remaining parenthesized/bracketed segments,
// collapse whitespace, and cap length so no stray punctuation or oversized
// query can ever trip it.
function sanitizeSearchQuery(query) {
  let q = String(query || "");
  q = q.replace(/[([][^)\]]*[)\]]/g, " "); // drop (...) and [...] groups
  q = q.replace(/\s+/g, " ").trim();
  if (q.length > 80) q = q.slice(0, 80).trim();
  return q;
}

async function searchAnime(query) {
  const sanitized = sanitizeSearchQuery(query);
  const q = encodeURIComponent(sanitized);
  const res = await malFetch(
    `/anime?q=${q}&limit=10&fields=id,title,alternative_titles,num_episodes,main_picture`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // MAL's edge WAF returns an HTML "friendly error page" (not JSON) for
    // requests it blocks, most commonly a 403 for queries with punctuation it
    // doesn't like. Surface a short human message instead of dumping raw HTML
    // into the popup.
    if (res.status === 403 || /^\s*</.test(text)) {
      throw new Error("MyAnimeList blocked the search (403). Try the manual search.");
    }
    throw new Error(`MAL search failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return (json.data || []).map((entry) => entry.node);
}

// Fetch a single anime's details (used to show title/cover for a cached
// slugMap hit, which resolveAnime otherwise wouldn't need to look up).
async function getAnimeDetails(animeId) {
  const res = await malFetch(
    `/anime/${animeId}?fields=id,title,alternative_titles,main_picture,num_episodes`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MAL anime lookup failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function updateListStatus(animeId, { numWatched, status, score, startDate, finishDate } = {}) {
  const body = new URLSearchParams();
  if (typeof numWatched === "number") body.set("num_watched_episodes", String(numWatched));
  if (status) body.set("status", status);
  if (typeof score === "number" && score >= 0) body.set("score", String(score));
  if (startDate) body.set("start_date", startDate);
  if (finishDate) body.set("finish_date", finishDate);
  const res = await malFetch(`/anime/${animeId}/my_list_status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MAL update failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Local (not UTC) "YYYY-MM-DD" for today — MAL's date fields are plain dates
// with no timezone, and toISOString() is UTC-based and can land on the wrong
// calendar day depending on the user's offset.
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Fetch the user's current list status for an anime, if it's on their list.
// Returns null (never throws) so a lookup hiccup doesn't block the update —
// the caller treats null the same as "not on the list yet".
async function getMyListStatus(animeId) {
  try {
    const res = await malFetch(`/anime/${animeId}?fields=my_list_status`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.my_list_status || null;
  } catch (_) {
    return null;
  }
}

// ---- High-level "update progress" -----------------------------------------

// Simple normalized string similarity to rank search results against the site title.
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function normTokens(s) {
  const n = norm(s);
  return n ? n.split(" ") : [];
}
function scoreMatch(candidate, target) {
  const c = norm(candidate);
  const t = norm(target);
  if (!c || !t) return 0;
  if (c === t) return 1;
  if (c.startsWith(t) || t.startsWith(c)) return 0.85;
  if (c.includes(t) || t.includes(c)) return 0.7;
  // token overlap
  const cs = new Set(c.split(" "));
  const ts = t.split(" ");
  const overlap = ts.filter((w) => cs.has(w)).length;
  return overlap / Math.max(cs.size, ts.length);
}

// ---- Season-aware resolution helpers ---------------------------------------
//
// MAL does not model "seasons" as a field on one anime — each season/cour of a
// show is its own separate catalog entry (e.g. "Kimetsu no Yaiba" and "Kimetsu
// no Yaiba: Yuukaku-hen" are different `anime_id`s). Our adapters strip the
// season out of the site title (cleanAnimeTitle), so a bare search for that
// stripped title reliably returns the Season 1 entry — which is wrong, and
// silently wrong, once a confident-match auto-accept caches it under the
// season-2+ slug. The helpers below broaden the search and the scoring so a
// season >= 2 detection actually lands on the right per-season entry.

function toRoman(n) {
  const map = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, sym] of map) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

function ordinalWord(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

// Common English phrasings MAL uses for a show's Nth season, used both to
// broaden the search query and (below) to recognize a season marker on a
// candidate's own titles.
function seasonPhrases(season) {
  return [`Season ${season}`, `${ordinalWord(season)} Season`, `Part ${season}`, toRoman(season)];
}

// Search-query variants tried in addition to the bare (season-stripped) title
// when detection.season >= 2, e.g. "Attack on Titan" -> "Attack on Titan
// Season 2", "Attack on Titan 2nd Season", "Attack on Titan II", ...
function seasonTitleVariants(baseTitle, season) {
  if (!season || season < 2 || !baseTitle) return [];
  return seasonPhrases(season).map((phrase) => `${baseTitle} ${phrase}`);
}

// True if `title` carries a recognizable marker for `season` (e.g. "Season 2",
// "2nd Season", "Part 2", or the roman numeral "II"). Matches on whole tokens
// so "Season 2" doesn't also match "Season 20", etc.
function titleHasSeasonMarker(title, season) {
  if (!title || !season) return false;
  const tokens = normTokens(title);
  const roman = toRoman(season).toLowerCase();
  const ordinal = ordinalWord(season).toLowerCase();
  const hasSeq = (seq) => {
    for (let i = 0; i + seq.length <= tokens.length; i++) {
      if (seq.every((w, j) => tokens[i + j] === w)) return true;
    }
    return false;
  };
  return (
    hasSeq(["season", String(season)]) ||
    hasSeq([ordinal, "season"]) ||
    hasSeq(["part", String(season)]) ||
    tokens.includes(roman) ||
    tokens.includes("s" + season)
  );
}

// Resolve a MAL anime id for a detection. Uses the confirmed-slug cache first,
// then a search with best-match scoring. Returns { id, title, mainPicture,
// candidates, suggestion, suggestionScore, cached }.
async function resolveAnime(detection) {
  const slugMap = (await get(K.slugMap))[K.slugMap] || {};
  if (detection.seriesSlug && slugMap[detection.seriesSlug]) {
    const id = slugMap[detection.seriesSlug];
    // Cached hit: fetch details so callers (e.g. the popup's "will update"
    // preview) can still show a title/cover for an already-confirmed match.
    let node = null;
    try {
      node = await getAnimeDetails(id);
    } catch (_) {
      /* network hiccup — id-only is enough for the actual update to proceed */
    }
    return {
      id,
      title: node ? node.title : null,
      mainPicture: node ? node.main_picture || null : null,
      candidates: [],
      cached: true,
    };
  }

  const season = detection.season || null;

  // For season >= 2, also search season-qualified variants of the title and
  // merge the results with the base-title search — see the comment above
  // seasonTitleVariants for why the bare title alone isn't enough.
  const queries = [detection.animeTitle, ...seasonTitleVariants(detection.animeTitle, season)];
  const byId = new Map();
  for (const q of queries) {
    const results = await searchAnime(q);
    for (const node of results) if (!byId.has(node.id)) byId.set(node.id, node);
  }
  const candidates = Array.from(byId.values());
  if (!candidates.length) return { id: null, title: null, mainPicture: null, candidates: [] };

  let best = candidates[0];
  let bestScore = 0;
  for (const cand of candidates) {
    const titles = [cand.title];
    if (cand.alternative_titles) {
      if (cand.alternative_titles.en) titles.push(cand.alternative_titles.en);
      (cand.alternative_titles.synonyms || []).forEach((s) => titles.push(s));
    }
    let s = Math.max(...titles.map((tt) => scoreMatch(tt, detection.animeTitle)));

    if (season && season >= 2) {
      const hasMarker = titles.some((tt) => titleHasSeasonMarker(tt, season));
      if (hasMarker) {
        // Confirmed season marker on this candidate — trust it even if the
        // plain string score against the stripped title is mediocre (season
        // titles often diverge more, e.g. "... 2nd Season").
        s = Math.max(s, 0.9);
      } else {
        // No season marker anywhere on this candidate: for a season>=2
        // detection this is very likely the Season-1 (or an unrelated) entry.
        // Cap it below the auto-accept threshold so we never silently write
        // to the wrong per-season MAL entry — surface it for user confirmation
        // instead.
        s = Math.min(s, 0.79);
      }
    }

    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  // Only auto-accept confident matches; otherwise surface candidates for the user.
  const confident = bestScore >= 0.8;
  return {
    id: confident ? best.id : null,
    title: confident ? best.title : null,
    mainPicture: (best && best.main_picture) || null,
    candidates,
    suggestion: best,
    suggestionScore: bestScore,
    cached: false,
  };
}

// Core update used by both manual and auto flows.
async function doUpdate({ detection, animeId, status, score }) {
  if (!detection) throw new Error("Nothing detected on this tab.");

  let id = animeId;
  let resolvedTitle = null;
  if (!id) {
    const r = await resolveAnime(detection);
    if (!r.id) {
      // Ambiguous — return candidates so the popup can ask the user to pick.
      return {
        ok: false,
        needsPick: true,
        candidates: r.candidates,
        suggestion: r.suggestion || null,
      };
    }
    id = r.id;
    resolvedTitle = r.title;
  }

  // Choose status automatically when not specified.
  const effectiveStatus = status || "watching";

  // Look up the user's current list entry (if any) so we only stamp
  // start_date/finish_date when MAL doesn't already have one — MAL never
  // sets these itself, so we have to.
  const current = await getMyListStatus(id).catch(() => null);

  const patch = { numWatched: detection.episode, status: effectiveStatus };
  if (typeof score === "number" && score > 0) patch.score = score;
  if (!current || !current.start_date) patch.startDate = todayStr();
  if (
    (effectiveStatus === "completed" || effectiveStatus === "dropped") &&
    (!current || !current.finish_date)
  ) {
    patch.finishDate = todayStr();
  }

  const result = await updateListStatus(id, patch);

  // Remember the confirmed slug->id mapping for next time.
  if (detection.seriesSlug) {
    const slugMap = (await get(K.slugMap))[K.slugMap] || {};
    slugMap[detection.seriesSlug] = id;
    await set({ [K.slugMap]: slugMap });
  }

  return {
    ok: true,
    animeId: id,
    resolvedTitle,
    numWatchedEpisodes: result.num_episodes_watched ?? detection.episode,
    status: result.status,
    score: result.score,
    startDate: result.start_date,
    finishDate: result.finish_date,
  };
}

// ---- Messaging ------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "DETECTED": {
          if (sender.tab && sender.tab.id != null) {
            detectionsByTab.set(sender.tab.id, msg.payload || null);
          }
          sendResponse({ ok: true });
          break;
        }
        case "GET_AUTO_UPDATE": {
          const s = await get(K.autoUpdate);
          sendResponse({ autoUpdate: !!s[K.autoUpdate] });
          break;
        }
        case "GET_STATE": {
          const store = await get([K.clientId, K.autoUpdate, K.tokens]);
          const tabId = msg.tabId;
          sendResponse({
            connected: !!(store[K.tokens] && store[K.tokens].access_token),
            clientIdSet: !!store[K.clientId],
            autoUpdate: !!store[K.autoUpdate],
            redirectUri: redirectUri(),
            detection: tabId != null ? detectionsByTab.get(tabId) || null : null,
          });
          break;
        }
        case "CONNECT": {
          const r = await connect();
          sendResponse({ ok: true, ...r });
          // The popup was destroyed when the sign-in tab took focus, so the
          // response above goes nowhere. Reopen the popup so the user sees the
          // updated "Connected" state without manually clicking the icon again.
          try {
            if (chrome.action && chrome.action.openPopup) await chrome.action.openPopup();
          } catch (_) {
            /* openPopup may reject (unsupported / no focused window); harmless */
          }
          break;
        }
        case "DISCONNECT": {
          await set({ [K.tokens]: null });
          sendResponse({ ok: true });
          break;
        }
        case "UPDATE_PROGRESS": {
          const r = await doUpdate({
            detection: msg.detection,
            animeId: msg.animeId, // set when the user picked from candidates
            status: msg.status,
            score: msg.score,
          });
          sendResponse(r);
          break;
        }
        case "SEARCH": {
          const results = await searchAnime(msg.query);
          sendResponse({ ok: true, results });
          break;
        }
        case "RESOLVE": {
          // Read-only counterpart to UPDATE_PROGRESS: resolves which MAL anime
          // a detection points to WITHOUT patching MAL, so the popup can show
          // "this is what will be edited" before the user commits.
          if (!msg.detection) {
            sendResponse({ ok: false, error: "Nothing detected on this tab." });
            break;
          }
          const r = await resolveAnime(msg.detection);
          sendResponse({
            ok: true,
            id: r.id,
            title: r.title,
            mainPicture: r.mainPicture || null,
            candidates: r.candidates || [],
            suggestion: r.suggestion || null,
            cached: !!r.cached,
          });
          break;
        }
        case "EPISODE_WATCHED": {
          // Auto-update path: only proceed if enabled and connected.
          const store = await get([K.autoUpdate, K.tokens]);
          if (!store[K.autoUpdate] || !store[K.tokens]) {
            sendResponse({ ok: false, skipped: true });
            break;
          }
          const r = await doUpdate({ detection: msg.payload, status: "watching" });
          sendResponse(r);
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type." });
      }
    } catch (err) {
      console.error("[MAL] message handler error", msg && msg.type, err);
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});

// Clean up cached detections for closed tabs.
chrome.tabs.onRemoved.addListener((tabId) => detectionsByTab.delete(tabId));

// ---- Toolbar badge --------------------------------------------------------
//
// Reflect connection state on the extension icon: a green check when we hold a
// MAL access token, cleared otherwise. Reads from storage so it stays correct
// across service-worker restarts (the worker is ephemeral in MV3).
async function refreshBadge() {
  try {
    const { [K.tokens]: tokens } = await get(K.tokens);
    const connected = !!(tokens && tokens.access_token);
    // Chrome's badge background can't be truly transparent (alpha 0 renders as
    // black), so instead we composite a small status dot onto the icon itself,
    // where the canvas gives us real transparency.
    await chrome.action.setBadgeText({ text: "" }); // clear any prior text badge
    await drawStatusIcon(connected ? "#2e7d32" : "#c62828");
    await chrome.action.setTitle({
      title: connected
        ? "MyAnimeList Updater — connected"
        : "MyAnimeList Updater — not connected",
    });
  } catch (_) {
    /* action API unavailable during teardown; harmless */
  }
}

// Draw the base icon with a small colored status dot in the bottom-right corner
// onto a transparent canvas, and set it as the toolbar icon.
async function drawStatusIcon(color) {
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const resp = await fetch(chrome.runtime.getURL("icons/icon128.png"));
  const bitmap = await createImageBitmap(await resp.blob());
  ctx.clearRect(0, 0, size, size); // start fully transparent
  ctx.drawImage(bitmap, 0, 0, size, size);

  const r = size * 0.21; // dot radius
  const cx = size - r - 1.5;
  const cy = size - r - 1.5;
  // White ring for contrast against the icon.
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
}

// Re-sync the badge whenever the token changes (connect, disconnect, or a dead
// refresh token clearing the session), and once on every worker startup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[K.tokens]) refreshBadge();
});
refreshBadge();
