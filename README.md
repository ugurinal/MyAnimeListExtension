# MyAnimeList Updater for Turkish Anime Sites

A Manifest V3 Chrome extension that detects which anime and episode you are watching
on a **Turkish anime streaming site** and updates your
**[MyAnimeList](https://myanimelist.net)** (MAL) watch progress — the number of
episodes watched and, optionally, the list status (Watching / Completed / etc.).

It uses the official MyAnimeList API v2 with OAuth2 **PKCE** (the `plain` method MAL
requires). MAL authenticates the client at its token endpoint, so you provide **your
own Client ID and Client Secret**, stored locally in the browser.

## Supported sites

Detection is handled by a modular per-site **adapter** system, so new sites are easy
to add. "Verified" means the URL/DOM pattern was confirmed against a real page and the
adapter exercised against the live site — all six currently are. A new adapter that
only follows a site's conventions without being confirmed is marked **UNVERIFIED** in
code and carries `verified: false`, which the popup surfaces to the user.

| Site | Hosts | Episode URL pattern | Status |
| --- | --- | --- | --- |
| TRanimeizle | tranimeizle.io/.co/.net | `/{slug}-{N}-bolum-izle` | Verified |
| Anizm | anizm.net, anizm.tr | `/{slug}-{N}-bolum-izle` | Verified |
| TürkAnime | turkanime.co/.tv/.com.tr/.pro | `/video/{slug}-{N}-bolum` | Verified |
| TRAnimeci | tranimaci.com | `/video/{id}-{slug}-{N}-bolum` | Verified |
| OpenAnime | openani.me, openanime.com.tr | `/anime/{slug}/{S}/{E}` (SPA) | Verified |
| AnimeCix | animecix.tv, animecix.net | `/titles/{id}/{slug}/season/{S}/episode/{E}` (SPA) | Verified |

The MAL side (OAuth, title→id resolution, caching, auto-update, settings) is shared
across every site.

---

## What it does

- Runs a content script on every supported host (see the table above).
- Picks the matching **site adapter** by hostname at runtime and delegates parsing.
  Each adapter extracts the anime title and episode number from the URL slug,
  `og:title`/`<title>`, headings/breadcrumbs, and (where available) the active
  episode list item. It also captures a **season** number when present ("N. Sezon").
- The popup shows the current site (and whether it is supported / best-effort), the
  detected anime + episode, and a **"Will update on MAL"** preview of the exact MAL
  entry that will be edited — its full title, cover, and a link to its MAL page — so
  you can confirm before committing. You can:
  - **Connect MyAnimeList** via OAuth (one time).
  - **Update progress on MAL** manually with one click.
  - Set the **status** (Watching / Completed / …) and an optional **score** (1–10).
  - Use **"Change / wrong anime?"** to search MyAnimeList and pick a different entry
    at any time — not only when the automatic match is uncertain.
  - Enable **auto-update while I watch**, which marks the episode watched after you
    have actually watched a good chunk of it (video progress or a 90s fallback).
- When the site title can't be matched to a single MAL entry with confidence, the
  popup surfaces search candidates so you can pick the right one. Your pick is cached
  per series slug so future episodes update instantly.
- On update it also **stamps the start date** the first time an entry has none, and
  **stamps the finish date** when you set the status to Completed or Dropped.

---

## Getting a MyAnimeList API Client ID

You must use **your own** MAL API client id (the extension ships without one, and
MAL API apps are per-user).

1. Sign in to MyAnimeList, then go to **<https://myanimelist.net/apiconfig>**.
2. Click **Create ID**.
3. Fill in the form:
   - **App Name**: anything, e.g. `TRanimeizle Updater`.
   - **App Type**: **web** (works fine for the PKCE flow).
   - **App Redirect URL**: the extension's redirect URI (see next section) — the
     `https://<extension-id>.chromiumapp.org/` value shown in the extension's
     Settings. Paste it **exactly**.
   - **Homepage URL / other required fields**: any valid value (e.g. the redirect
     URL again). Agree to the terms.
4. Submit. Open the app and copy the **Client ID** and the **Client Secret**.
   - MyAnimeList authenticates the client at its token endpoint, so the **Client
     Secret is required** — even with PKCE, omitting it fails with
     `401 invalid_client`.
5. Paste the Client ID and Client Secret into the extension's **Settings** and click
   **Save settings**.

> **Redirect URI:** the OAuth flow returns through
> `https://<your-extension-id>.chromiumapp.org/` (from
> `chrome.identity.getRedirectURL()`). The extension shows this exact value in
> Settings (with a Copy button) once it's loaded. Register that value as the **App
> Redirect URL** in your MAL app. The extension id is stable for an unpacked
> extension as long as its folder path (and optional `key`) don't change.

---

## Load the extension (unpacked)

1. Download / clone this repo.
2. Open **`chrome://extensions`** in Chrome (or any Chromium browser: Edge, Brave…).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the repository folder (the one containing
   `manifest.json`).
5. Pin the extension. Open its popup, expand **Settings**, and:
   - Copy the **Redirect URI** shown there and register it in your MAL app
     (see above).
   - Paste your **MAL Client ID** and **Save settings**.
   - Click **Connect MyAnimeList** and approve access.

Then open any episode on a supported site and click **Update progress on MAL**.

---

## How it works end to end

1. **Detection (`src/content.js` + `src/adapters/*`)** — `content.js` resolves the
   site adapter for the current hostname (via `src/sites.js`) and calls
   `adapter.isEpisodePage()` / `adapter.detect()`. The adapter extracts `episode`,
   `seriesSlug`, optional `season`, and `animeTitle` (stripping the Turkish suffix
   `"N. Sezon N. Bölüm İzle"`). `content.js` attaches `siteId`/`siteName` and pushes
   `{animeTitle, episode, seriesSlug, season, siteId}` to the worker; it also answers
   live `GET_DETECTION` requests from the popup and re-detects on SPA route changes.
2. **OAuth (`src/background.js`)** — `Connect` runs the PKCE flow by opening MAL's
   sign-in in a **normal browser tab** and watching for the redirect back to the
   `chromiumapp.org` URI (MAL's authorize page refuses to render inside
   `chrome.identity.launchWebAuthFlow`'s cookieless window). **MAL only supports the
   PKCE `plain` method**, so the extension sends `code_challenge = code_verifier` with
   `code_challenge_method=plain`, then exchanges the returned `code` — **plus the
   Client Secret**, which MAL requires at its token endpoint — for access + refresh
   tokens. Tokens are stored in `chrome.storage.local` and auto-refreshed.
3. **Resolve + update** — The popup previews the target via a read-only `RESOLVE`
   first. On update, the worker calls `GET /anime?q={title}` to find the MAL id and
   scores the results against the site title. For a **season ≥ 2** detection it also
   searches season-qualified variants ("Season 2", "2nd Season", roman numerals…) and
   requires a season marker before auto-accepting, so it lands on the right per-season
   MAL entry instead of Season 1. It then calls
   `PATCH /anime/{id}/my_list_status` with `num_watched_episodes` (the detected
   episode), `status`, an optional `score`, and `start_date` / `finish_date` stamps.
   The confirmed `slug → malId` mapping is cached.
4. **Auto-update** — If enabled, the content script sends `EPISODE_WATCHED` after
   real watch progress, and the worker runs the same update automatically.

---

## File tree

```
manifest.json
src/
  sites.js            # DOM-free registry of supported sites (shared by popup + content)
  content.js          # picks the adapter by hostname, reports detection, auto-watch
  background.js       # OAuth PKCE, token refresh, MAL API, message routing
  adapters/
    common.js         # shared detection helpers + adapter registry (MALAdapters)
    tranimeizle.js    # verified
    anizm.js          # verified
    turkanime.js      # verified
    tranimaci.js      # verified
    openanime.js      # verified (SPA)
    animecix.js       # verified (SPA)
  popup.html          # UI markup
  popup.css           # UI styles
  popup.js            # UI logic (settings folded in here)
icons/
  icon.svg            # source
  icon16.png icon48.png icon128.png
README.md
CHANGELOG.md          # Keep a Changelog format
```

## Adding a new site adapter

1. **Register the site** in `src/sites.js`: add an entry to `SUPPORTED_SITES` with
   `id`, `name`, `hosts`, `matches` (Chrome match patterns), and `verified`.
2. **Add the hosts** to `manifest.json` `content_scripts[].matches` (keep it in sync
   with the `matches` you wrote in step 1).
3. **Create `src/adapters/<id>.js`** implementing the adapter interface:
   ```js
   window.MALAdapters.register({
     id: "<id>",                                  // must match the sites.js id
     isEpisodePage(document, url) { return bool; },
     detect(document, url) {
       // return { animeTitle, episode, seriesSlug, season? } or null
     },
     getVideoEl(document) { return document.querySelector("video"); } // optional
   });
   ```
   `window.MALAdapters` (from `adapters/common.js`) provides helpers you can reuse:
   `metaContent`, `textFromSelectors`, `cleanAnimeTitle`, `episodeFromTitle`,
   `seasonFromTitle`, and `genericDetect(doc, url, { urlRe, titleSelectors })` /
   `genericIsEpisodePage(doc, url, urlRe)` for the common `…-N-bolum…` case.
4. **List the file** in `manifest.json` `content_scripts[].js` **before**
   `src/content.js` (order matters: `sites.js` → `adapters/common.js` → adapters →
   `content.js`).
5. Reload the unpacked extension. The popup will show the new site automatically.

---

## Limitations & TODOs

- **Title matching accuracy.** The sites use English titles, which usually match
  MAL well, but seasons/cours, alternate romanizations, and movies can be
  ambiguous. When unsure, the popup asks you to pick; the choice is then cached per
  series slug. You can also open **"Change / wrong anime?"** to search MAL and
  override the match at any time.
- **Auto-update heuristic.** "Watched" fires on ~60% video progress, or a 90s
  fallback when the player is inside a cross-origin iframe we can't read. It may be
  too eager/lazy for some players. TODO: make the threshold configurable.
- **SPA fragility.** AnimeCix and OpenAnime are single-page apps: they swap episodes
  without a full page load, so detection depends on `content.js` re-running when the
  URL changes (polled every 1.5s) rather than on a fresh document. All six adapters are
  verified against real pages, but the SPA pair is the likeliest to break first if a
  site reworks its routing.
- **Season handling.** Resolution is season-aware: a `season ≥ 2` detection searches
  season-qualified title variants and picks the matching per-season MAL entry (each
  MAL season is a separate entry). Sites that bake the season into the title as a
  roman numeral (e.g. Anizm / TürkAnime "… II") resolve directly. The per-season
  episode number is written as-is, which is correct because MAL counts each season's
  episodes from 1. Unusual absolute-numbering cases can still need a manual pick.
- **MAL rate limits.** The API is rate-limited; heavy rapid use can return 429.
  Normal per-episode updates are well within limits.
- **Redirect URI stability.** If the unpacked extension id changes (different
  folder, or reinstalled without a fixed `key`), re-register the new redirect URI
  in your MAL app. Add a `"key"` to `manifest.json` to pin the id if needed.
- **No network/build at ship time.** Pure vanilla JS/HTML/CSS, load-unpacked, no
  bundler. The code was written and reviewed statically; actually authenticating
  requires your own client id and a live browser session.

---

## Contributing

Issues and pull requests are welcome — especially **adapter fixes**, since much of the
upkeep here is keeping pace with sites that change their markup.

### Setup

There is no build step, no dependencies, and no test suite — it is vanilla JS/HTML/CSS
loaded unpacked, so cloning the repo and following
[Load the extension](#load-the-extension-unpacked) is the whole setup.

After editing:

- **`manifest.json` or `background.js`** → click **Reload** on the extension card.
- **Content scripts / adapters** → Reload, then refresh the streaming page.
- **Popup** → just reopen the popup.

Each context has its own console: the page's DevTools for content scripts, the **service
worker** link on the extension card for `background.js`, and right-click → **Inspect** on
the popup.

### Most wanted

- **Reporting a site that broke.** These sites change markup and rotate domains without
  notice, so an adapter that works today can silently stop detecting. If the popup shows
  "Unsupported site" or the wrong episode, open an issue with the episode URL — that
  alone is usually enough to fix it. Saving the page (Ctrl+S → "Webpage, Single File")
  and attaching what you can is even better: reading real markup is how every adapter
  here was confirmed.
- **New sites** — see [Adding a new site adapter](#adding-a-new-site-adapter).
- **Title-matching accuracy**, particularly seasons, cours, and movies.

### Testing a change

There is no automated suite, so say what you actually exercised. For an adapter change
the useful evidence is the episode URL you tested and what was detected — the popup
shows the detected title, episode, and slug, so a screenshot of it is enough.

Worth checking beyond the happy path:

- a **season ≥ 2** episode, which exercises the season-aware resolution and the
  season-qualified slug cache;
- a title carrying a year or punctuation, which is what previously tripped MAL's search
  WAF;
- the site's non-episode pages (home, series index) — `isEpisodePage()` should return
  false rather than mis-detect.

### House style

- Vanilla ES2020, 2-space indent, double quotes, `"use strict"`. No frameworks and no
  new dependencies: the extension must stay loadable unpacked with zero tooling.
- Every file opens with a block comment saying what it owns and **why** any surprising
  decision was made. Several constraints here look like bugs and are not — PKCE `plain`,
  the required client secret, the deliberate avoidance of `launchWebAuthFlow`, the
  season-marker score capping. Keep that commenting habit rather than "simplifying" them
  away.
- `src/sites.js` is loaded in several contexts and must stay DOM-free.
- Keep `host_permissions` minimal — adding a site does **not** need one.
- Never commit a Client ID or Secret; they are user-supplied and live in
  `chrome.storage.local`.

### Pull requests

Branch off `main`, keep the change focused, and add a note under
`## [Unreleased]` in `CHANGELOG.md` for anything user-visible. Call out any manual step a
reviewer has to take — reload the extension, re-authorize, re-register a redirect URI.
