/*
 * popup.js — the extension UI.
 *
 * Talks to the background worker for all state and network work. Reads the current
 * tab's detection, lets the user connect to MAL (OAuth), and update progress —
 * either automatically-confirmed or by picking from search candidates.
 */

"use strict";

const $ = (id) => document.getElementById(id);

// Send a message to the background worker and await its response.
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(res);
    });
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

let currentDetection = null;
let activeTabId = null;
let currentSite = null; // MALSites site record for the active tab, or null

// The MAL anime that will actually be edited when the user clicks Update.
// { id, title, mainPicture, unconfirmed } | null
let currentTarget = null;
// Last candidate list shown in the change/pick panel (from RESOLVE, a failed
// UPDATE_PROGRESS, or a manual SEARCH), kept so re-opening the panel doesn't
// start empty.
let lastCandidates = [];
let lastSuggestion = null;

function renderSiteLine(tabUrl) {
  const el = $("site-line");
  currentSite = tabUrl ? MALSites.siteForUrl(tabUrl) : null;
  if (!tabUrl || /^chrome/.test(tabUrl)) {
    el.className = "site-line muted";
    el.innerHTML = '<span class="dot"></span>Open a supported anime site.';
    return;
  }
  if (currentSite) {
    const verified = currentSite.verified;
    el.className = "site-line " + (verified ? "supported" : "unverified");
    el.innerHTML =
      '<span class="dot"></span>Site: <strong>' +
      currentSite.name +
      "</strong>" +
      (verified ? "" : " (best-effort / unverified)");
  } else {
    el.className = "site-line unsupported";
    let host = tabUrl;
    try {
      host = new URL(tabUrl).hostname;
    } catch (_) {}
    el.innerHTML =
      '<span class="dot"></span>Unsupported site: <strong>' +
      host +
      "</strong>";
  }
}

function setMsg(text, kind) {
  const el = $("status-msg");
  el.textContent = text || "";
  el.className = "status-msg" + (kind ? " " + kind : "");
}

function renderDetection(d) {
  currentDetection = d;
  const info = $("detection-info");
  const empty = $("detection-empty");
  if (d && d.animeTitle) {
    empty.classList.add("hidden");
    info.classList.remove("hidden");
    $("d-title").textContent = d.animeTitle;
    $("d-episode").textContent = d.episode;
    $("d-slug").textContent = d.seriesSlug ? `slug: ${d.seriesSlug}` : "";
  } else {
    info.classList.add("hidden");
    empty.classList.remove("hidden");
    // No detection (anymore) — there's nothing to resolve/edit.
    selectTarget(null);
    closeChangePanel();
  }
  refreshUpdateButton();
}

// ---- Target preview ("this is what will be edited") ------------------------

function renderTarget() {
  const card = $("target-card");
  if (!currentTarget || !currentTarget.id) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  const url = `https://myanimelist.net/anime/${currentTarget.id}`;
  const titleLink = $("target-title-link");
  titleLink.textContent = currentTarget.title || `MAL #${currentTarget.id}`;
  titleLink.href = url;
  $("target-cover-link").href = url;

  const img = $("target-cover");
  const pic = currentTarget.mainPicture;
  const src = (pic && (pic.medium || pic.large)) || "";
  img.src = src;
  img.classList.toggle("hidden", !src);

  $("target-episode-num").textContent = currentDetection ? currentDetection.episode : "—";

  const note = $("target-note");
  if (currentTarget.unconfirmed) {
    note.textContent = "Best guess — not confirmed yet. Please check below.";
    note.classList.remove("hidden");
  } else {
    note.textContent = "";
    note.classList.add("hidden");
  }
}

// Set (or clear) the anime that will be edited. `node` is a MAL anime node
// (from RESOLVE's suggestion, a SEARCH result, or a candidate list entry) —
// `{ id, title, main_picture }` — or `{ id, title, mainPicture }` from RESOLVE.
function selectTarget(node, { unconfirmed = false } = {}) {
  if (!node || node.id == null) {
    currentTarget = null;
  } else {
    currentTarget = {
      id: node.id,
      title: node.title || null,
      mainPicture: node.mainPicture || node.main_picture || null,
      unconfirmed,
    };
  }
  renderTarget();
  refreshUpdateButton();
}

function closeChangePanel() {
  $("change-card").classList.add("hidden");
}

function renderPickList(candidates, suggestion) {
  lastCandidates = candidates || [];
  lastSuggestion = suggestion || null;
  const list = $("pick-list");
  list.innerHTML = "";
  for (const c of lastCandidates) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.src = (c.main_picture && (c.main_picture.medium || c.main_picture.large)) || "";
    img.alt = "";
    const meta = document.createElement("div");
    meta.className = "pick-meta";
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = c.title;
    const m = document.createElement("span");
    m.className = "m";
    const eps = c.num_episodes ? `${c.num_episodes} eps` : "";
    const flag = suggestion && suggestion.id === c.id ? " · best guess" : "";
    m.textContent = `MAL #${c.id}${eps ? " · " + eps : ""}${flag}`;
    meta.appendChild(t);
    meta.appendChild(m);
    li.appendChild(img);
    li.appendChild(meta);
    li.addEventListener("click", () => {
      // Picking a candidate only updates the *displayed* target — it does not
      // write to MAL by itself. The actual write (and the slugMap cache
      // update) happens when the user clicks "Update progress on MAL".
      selectTarget(c, { unconfirmed: false });
      closeChangePanel();
      setMsg('Target changed. Click "Update progress on MAL" to save.', "busy");
    });
    list.appendChild(li);
  }
}

// Ask the worker which MAL anime this detection resolves to, WITHOUT patching
// MAL (read-only preview) — see the RESOLVE message handler in background.js.
async function resolveTarget(detection) {
  if (!connected || !detection || !detection.animeTitle) {
    selectTarget(null);
    return;
  }
  setMsg("Looking up anime on MyAnimeList…", "busy");
  try {
    const res = await send({ type: "RESOLVE", detection });
    if (!res || !res.ok) {
      setMsg((res && res.error) || "Could not resolve anime.", "err");
      return;
    }
    if (res.id) {
      // Confident (or cached) match — this is the target, no action needed.
      // Keep the candidates around so "Change / wrong anime?" has a starting
      // point without an extra round trip.
      selectTarget({ id: res.id, title: res.title, mainPicture: res.mainPicture });
      renderPickList(res.candidates || [], res.suggestion);
      closeChangePanel();
      setMsg("", null);
    } else if (res.suggestion) {
      // Ambiguous — show the best guess but flag it, and open the picker so
      // the user can confirm or pick a different one right away.
      selectTarget(res.suggestion, { unconfirmed: true });
      $("change-heading").textContent = "Pick the correct anime";
      $("change-hint").textContent =
        "We couldn't confidently match this title. Choose one, or search:";
      renderPickList(res.candidates || [], res.suggestion);
      $("change-card").classList.remove("hidden");
      setMsg("Couldn't confidently match — please confirm the anime below.", "busy");
    } else {
      selectTarget(null);
      $("change-heading").textContent = "Search for the anime";
      $("change-hint").textContent = "No MAL match found automatically — search for it:";
      renderPickList([], null);
      $("change-card").classList.remove("hidden");
      setMsg("No MAL match found — search below.", "err");
    }
  } catch (e) {
    setMsg(e.message || "Could not resolve anime.", "err");
  }
}

let connected = false;

function refreshUpdateButton() {
  $("btn-update").disabled = !(connected && currentDetection && currentDetection.animeTitle);
}

function setConnected(isConnected) {
  connected = isConnected;
  const badge = $("conn-badge");
  if (isConnected) {
    badge.textContent = "Connected";
    badge.className = "badge badge-on";
    $("btn-connect").classList.add("hidden");
    $("btn-disconnect").classList.remove("hidden");
  } else {
    badge.textContent = "Not connected";
    badge.className = "badge badge-off";
    $("btn-connect").classList.remove("hidden");
    $("btn-disconnect").classList.add("hidden");
  }
  refreshUpdateButton();
}

// ---- Initial load ---------------------------------------------------------

async function init() {
  const tab = await getActiveTab();
  activeTabId = tab ? tab.id : null;
  renderSiteLine(tab ? tab.url : null);

  // Pull settings + connection + cached detection from the background.
  let state;
  try {
    state = await send({ type: "GET_STATE", tabId: activeTabId });
  } catch (e) {
    setMsg("Could not reach the extension worker. Try reopening.", "err");
    return;
  }

  $("client-id").value = ""; // filled from storage below
  const stored = await new Promise((r) =>
    chrome.storage.local.get(["clientId", "clientSecret", "autoUpdate"], r)
  );
  $("client-id").value = stored.clientId || "";
  $("client-secret").value = stored.clientSecret || "";
  $("auto-update").checked = !!stored.autoUpdate;
  $("redirect-uri").value = state.redirectUri || "";

  setConnected(!!state.connected);

  // Prefer the background's cached detection; if absent, ask the content script live.
  let detection = state.detection;
  if (!detection && tab && currentSite) {
    try {
      const res = await new Promise((resolve) =>
        chrome.tabs.sendMessage(activeTabId, { type: "GET_DETECTION" }, (r) => {
          void chrome.runtime.lastError;
          resolve(r);
        })
      );
      if (res && res.detection) detection = res.detection;
    } catch (_) {
      /* content script not present */
    }
  }
  renderDetection(detection);

  // Resolve + preview which MAL anime will be edited (read-only — no MAL
  // write). Skipped when not connected; resolveTarget() also no-ops without
  // a usable detection.
  await resolveTarget(detection);

  if (!state.clientIdSet) {
    setMsg("Add your MAL Client ID in Settings to get started.", "busy");
    // Open settings so it's obvious.
    toggleSettings(true);
  }
}

// ---- Settings -------------------------------------------------------------

function toggleSettings(force) {
  const btn = $("settings-toggle");
  const body = $("settings-body");
  const open = force != null ? force : btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", String(open));
  body.classList.toggle("hidden", !open);
}

$("settings-toggle").addEventListener("click", () => toggleSettings());

$("btn-save").addEventListener("click", async () => {
  const clientId = $("client-id").value.trim();
  const clientSecret = $("client-secret").value.trim();
  const autoUpdate = $("auto-update").checked;
  await new Promise((r) =>
    chrome.storage.local.set({ clientId, clientSecret, autoUpdate }, r)
  );
  setMsg("Settings saved.", "ok");
});

$("copy-redirect").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("redirect-uri").value);
    $("copy-redirect").textContent = "Copied";
    setTimeout(() => ($("copy-redirect").textContent = "Copy"), 1200);
  } catch (_) {
    $("redirect-uri").select();
  }
});

// ---- Connect / disconnect -------------------------------------------------

$("btn-connect").addEventListener("click", async () => {
  const clientId = $("client-id").value.trim();
  const clientSecret = $("client-secret").value.trim();
  if (!clientId) {
    setMsg("Enter your MAL Client ID first.", "err");
    toggleSettings(true);
    return;
  }
  if (!clientSecret) {
    setMsg("Enter your MAL Client Secret first.", "err");
    toggleSettings(true);
    return;
  }
  // Persist the credentials before launching the flow.
  await new Promise((r) => chrome.storage.local.set({ clientId, clientSecret }, r));
  setMsg("Opening MyAnimeList sign-in…", "busy");
  try {
    const res = await send({ type: "CONNECT" });
    // send() only rejects on a Chrome messaging error; a failed OAuth/token
    // exchange comes back as { ok:false, error }. Check it so we don't falsely
    // show "Connected" and then fail on the next update.
    if (!res || !res.ok) {
      setConnected(false);
      setMsg((res && res.error) || "Connection failed.", "err");
      return;
    }
    setConnected(true);
    setMsg("Connected to MyAnimeList.", "ok");
  } catch (e) {
    setConnected(false);
    setMsg(e.message || "Connection failed.", "err");
  }
});

$("btn-disconnect").addEventListener("click", async () => {
  await send({ type: "DISCONNECT" });
  setConnected(false);
  setMsg("Disconnected.", "busy");
});

// ---- Update progress ------------------------------------------------------

// Always updates whatever is currently shown as the target (currentTarget),
// so the displayed preview is authoritative — not a second, independent
// resolution. If nothing has been resolved yet (e.g. RESOLVE hadn't run),
// falls back to letting the worker resolve it itself.
async function performUpdate() {
  if (!currentDetection) return;
  setMsg("Updating MyAnimeList…", "busy");
  $("btn-update").disabled = true;
  try {
    const status = $("status-select").value || null;
    const scoreRaw = $("score-select").value;
    const score = scoreRaw ? parseInt(scoreRaw, 10) : undefined;
    const res = await send({
      type: "UPDATE_PROGRESS",
      detection: currentDetection,
      animeId: currentTarget ? currentTarget.id : undefined,
      status,
      score,
    });
    if (res && res.ok) {
      const t = res.resolvedTitle
        ? ` (${res.resolvedTitle})`
        : currentTarget && currentTarget.title
        ? ` (${currentTarget.title})`
        : "";
      const scoreMsg = typeof res.score === "number" && res.score > 0 ? `, score ${res.score}` : "";
      setMsg(`Updated${t}: episode ${res.numWatchedEpisodes}, status "${res.status}"${scoreMsg}.`, "ok");
      if (currentTarget) {
        // The write succeeded against currentTarget — treat it as confirmed
        // and drop the "best guess" flag.
        currentTarget.unconfirmed = false;
      } else if (res.animeId) {
        // No target had been resolved client-side (e.g. RESOLVE hadn't run
        // yet) — the worker resolved it on its own; reflect that back.
        selectTarget({ id: res.animeId, title: res.resolvedTitle });
      }
      renderTarget();
      closeChangePanel();
    } else if (res && res.needsPick) {
      // Only reachable when we updated without a currentTarget and the
      // worker's own resolution was ambiguous.
      selectTarget(res.suggestion, { unconfirmed: true });
      $("change-heading").textContent = "Pick the correct anime";
      $("change-hint").textContent =
        "We couldn't confidently match this title. Choose one, or search, then click Update again.";
      renderPickList(res.candidates || [], res.suggestion);
      $("change-card").classList.remove("hidden");
      setMsg("Multiple matches — pick the correct anime below.", "busy");
    } else {
      setMsg((res && res.error) || "Update failed.", "err");
    }
  } catch (e) {
    setMsg(e.message || "Update failed.", "err");
  } finally {
    refreshUpdateButton();
  }
}

$("btn-update").addEventListener("click", () => performUpdate());

// "Change / wrong anime?" — always available, confident match or not.
$("btn-change").addEventListener("click", () => {
  const panel = $("change-card");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) {
    $("change-heading").textContent = "Change anime";
    $("change-hint").textContent = "Search MyAnimeList for the correct entry:";
    $("search-input").value = "";
    $("search-input").focus();
    // Re-show whatever candidates we already have as a starting point.
    renderPickList(lastCandidates, lastSuggestion);
  }
});

async function doSearch() {
  const q = $("search-input").value.trim();
  if (!q) return;
  setMsg("Searching MyAnimeList…", "busy");
  try {
    const res = await send({ type: "SEARCH", query: q });
    if (res && res.ok) {
      $("change-heading").textContent = "Search results";
      $("change-hint").textContent = `Results for "${q}":`;
      renderPickList(res.results || [], null);
      setMsg("", null);
    } else {
      setMsg((res && res.error) || "Search failed.", "err");
    }
  } catch (e) {
    setMsg(e.message || "Search failed.", "err");
  }
}

$("btn-search").addEventListener("click", doSearch);
$("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    doSearch();
  }
});

// Keep the connection badge in sync if tokens change while the popup is open
// (e.g. the auto-reopened popup right after connecting, or a disconnect).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.tokens) return;
  const t = changes.tokens.newValue;
  const nowConnected = !!(t && t.access_token);
  setConnected(nowConnected);
  if (nowConnected) setMsg("Connected to MyAnimeList.", "ok");
});

// Persist auto-update toggle immediately when changed.
$("auto-update").addEventListener("change", () => {
  chrome.storage.local.set({ autoUpdate: $("auto-update").checked });
});

document.addEventListener("DOMContentLoaded", init);
