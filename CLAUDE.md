# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 browser extension (vanilla JS/HTML/CSS — **no bundler, no package.json, no
dependencies, no test suite**) that detects the anime/episode being watched on Turkish
streaming sites and updates the user's MyAnimeList progress via MAL API v2.

## Development workflow

There is no build, lint, or test command. Development is load-unpacked:

1. `chrome://extensions` → Developer mode → **Load unpacked** → repo root.
2. After editing, click **Reload** on the extension card. Content-script changes also
   need a page refresh; `manifest.json` changes always need the reload.
3. Debug per context — they have separate consoles:
   - content scripts → the streaming page's DevTools console
   - service worker → "service worker" link on the `chrome://extensions` card
   - popup → right-click the popup → Inspect

Verification requires a real browser session plus the user's own MAL Client ID/Secret,
so you cannot exercise the OAuth or update paths yourself. When a change needs a reload,
re-auth, or manual click-through, say so explicitly.

Changes are logged in `CHANGELOG.md` (Keep a Changelog format, under `## [Unreleased]`).

## Architecture

Three contexts talking over `chrome.runtime` messages:

```
content script (per-site)  --DETECTED / EPISODE_WATCHED-->  background.js (worker)
        ^                                                        ^
        |  GET_DETECTION (chrome.tabs.sendMessage)               |  GET_STATE, CONNECT,
        +---------------------  popup.js  ----------------------+   RESOLVE, UPDATE_PROGRESS, SEARCH
```

**`src/background.js`** (service worker) owns everything privileged: OAuth, token
storage/refresh, all MAL API calls, the `tabId → detection` in-memory cache, and the
toolbar status icon. All message handling goes through one `onMessage` listener that
`return true`s to keep the channel open.

**`src/content.js`** is site-agnostic. It resolves the site record for
`location.hostname` via `MALSites`, looks up the adapter via `MALAdapters`, and delegates
all parsing. It re-detects on SPA URL changes (1.5s poll) and retries a few times after
load for SPAs that render late.

**`src/sites.js`** is a DOM-free registry loaded in *both* the content script and the
popup (`popup.html` includes it). It must never touch `document`/`window` at load time —
it attaches to `self`.

**`src/adapters/*.js`** — one per site. Content scripts can't use ES modules, so every
adapter self-registers into the `window.MALAdapters` global created by
`adapters/common.js`. **Load order in `manifest.json` is load-bearing:**
`sites.js` → `adapters/common.js` → `adapters/*.js` → `content.js`.

Detection helpers in `common.js` are Turkish-language aware: `Bölüm` = episode,
`Sezon` = season, `İzle` = watch.

### Adding a site

Four places must stay in sync, or detection silently no-ops:

1. `src/sites.js` — a `SUPPORTED_SITES` entry (`id`, `name`, `hosts`, `matches`, `verified`).
2. `manifest.json` `content_scripts[].matches` — must mirror the `matches` from step 1.
3. `manifest.json` `content_scripts[].js` — the new adapter file, **before** `src/content.js`.
4. `src/adapters/<id>.js` — `window.MALAdapters.register({ id, isEpisodePage, detect, getVideoEl? })`
   where `id` matches the `sites.js` id. Reuse `genericDetect` / `genericIsEpisodePage`
   for the common `…-N-bolum…` URL shape.

`verified: false` marks a best-effort adapter whose DOM was never confirmed; the popup
surfaces this to the user. All six adapters are currently `verified: true`, so a new site
is the only reason to set it false — and flipping it back to true means both confirming
the markup and exercising the adapter on the live site. Keep the header comment in the
adapter file consistent with the flag.

Saved `.mhtml` page snapshots used to confirm an adapter live in `fixtures/`, which is
gitignored — they're large and mirror third-party pages. MHTML is quoted-printable, so
parse it (Python's `email` module) rather than grepping the raw file.

## Non-obvious constraints

**MAL OAuth is unusual on two counts, and both are deliberate:**

- MAL supports only the PKCE **`plain`** method, so `code_challenge === code_verifier`
  and `code_challenge_method=plain`.
- MAL authenticates the client at its token endpoint, so the **Client Secret is
  required** even with PKCE — omitting it returns `401 invalid_client`. The user supplies
  their own Client ID *and* Secret in Settings.
- `chrome.identity.launchWebAuthFlow` is **not** used. Its cookieless window makes MAL's
  authorize page refuse to render. Instead `captureOAuthRedirectViaTab()` opens a normal
  tab and watches `chrome.tabs.onUpdated` for a navigation to
  `chrome.identity.getRedirectURL()`. This is why the `tabs` permission exists. The popup
  is destroyed when that tab takes focus, so `CONNECT` reopens it via `chrome.action.openPopup()`
  and the popup also re-syncs from `chrome.storage.onChanged` on `tokens`.

**`seriesSlug` is the cache key** for the persistent `slugMap` (`seriesSlug → malId`) in
`chrome.storage.local`. Once a slug is cached, resolution short-circuits. If a site nests
multiple seasons under one slug (AnimeCix does), the adapter **must** season-qualify it
(`${slug}-s${season}`) or season 2 will silently overwrite season 1's mapping.

**Seasons are separate MAL entries.** Adapters strip the season out of the title, so a
bare search returns the Season 1 entry. For `season >= 2`, `resolveAnime()` also searches
season-qualified variants ("Season 2", "2nd Season", "Part 2", roman numerals) and caps the
score of any candidate lacking a season marker below the 0.8 auto-accept threshold, forcing
user confirmation rather than a silently wrong write. Don't "simplify" that capping away.

**MAL's edge WAF returns HTML 403s** for search queries containing parentheses/brackets.
`sanitizeSearchQuery()` strips them and caps length; `searchAnime()` detects an HTML body
and raises a short message instead of dumping markup into the popup.

**MV3 worker is ephemeral.** `detectionsByTab` is in-memory and intentionally disposable;
anything that must survive a worker restart (tokens, settings, `slugMap`, badge state)
reads from `chrome.storage.local`. Storage keys are centralized in the `K` object.

**Dates**: MAL date fields are timezone-less plain dates, so `todayStr()` builds
`YYYY-MM-DD` from local getters — never `toISOString()`.

**Popup preview is authoritative.** `RESOLVE` is the read-only twin of `UPDATE_PROGRESS`;
the popup resolves first, shows the target card, and then sends the chosen `animeId` with
the update so the write always matches what the user saw.

**`host_permissions` intentionally covers only the MAL hosts.** Declarative content scripts
get their injection rights from `content_scripts[].matches`, and nothing in the extension
fetches a streaming site — the worker only calls MAL. Do not add streaming hosts here when
adding a site; it would widen the install-time permission prompt for no functional gain.
