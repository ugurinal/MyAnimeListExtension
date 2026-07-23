# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Target preview in the popup.** A "Will update on MAL" card shows the exact MAL
  entry that will be edited — full title, cover image, and a link to its
  `myanimelist.net/anime/{id}` page — before you commit. Backed by a new read-only
  `RESOLVE` worker message that resolves the match without patching MAL.
- **"Change / wrong anime?" control.** A MyAnimeList search box + candidate picker
  that is always available, not only when the automatic match is uncertain, so you
  can override the target at any time. The chosen entry is cached per series slug.
- **Score selection.** A 1–10 score selector (with MAL's labels, plus "don't set")
  in the popup, written to MAL on update.
- **Automatic start date.** On update, `start_date` is stamped with today's local
  date the first time an entry has none; existing start dates are left untouched.
- **Automatic finish (end) date.** `finish_date` is stamped with today's local date
  when the status is set to **Completed** or **Dropped** (and isn't already set).
- **Season-aware resolution.** For a `season ≥ 2` detection, the worker also searches
  season-qualified title variants ("Season 2", "2nd Season", "Part 2", roman
  numerals) and only auto-accepts a candidate that carries a matching season marker —
  so it targets the correct per-season MAL entry.

### Fixed

- **Season 2 updating the Season 1 entry.** On sites that write the season as
  "N. Sezon" (TRanimeizle, AnimeciX), the season-stripped title resolved to the
  Season 1 MAL entry and cached it under the season-2 slug, so every later episode
  updated Season 1. Resolution is now season-aware (see above), and markerless
  matches for `season ≥ 2` are surfaced for confirmation instead of silently
  auto-accepted.
- **AnimeciX slug captured the numeric id.** The adapter read `13280` (the numeric
  title id) as the series slug because the real watch URL is
  `/titles/{id}/{slug}/season/{S}/episode/{E}` (slash-separated), not
  `/titles/{id}-{slug}`. It now parses the numeric id and the human-readable text
  slug, reads season/episode from the `/season/N/episode/M` segments, and
  season-qualifies the cache key (`{slug}-s{season}`) so seasons nested under one
  title id no longer collide.
- **MAL search returning a raw 403 page.** Titles carrying a release year like
  `(2026)` produced a query whose parentheses tripped MAL's edge WAF, which returned
  an HTML `403 Forbidden` page dumped straight into the popup. The trailing
  `(YYYY)` / `(YYYY-YYYY)` year is now stripped from titles, search queries are
  sanitized of parenthetical/bracketed segments and length-capped before sending,
  and a blocked search now shows a short "MyAnimeList blocked the search (403)"
  message pointing at the manual search.

### Changed

- **Extension name and description generalized.** The manifest still identified the
  extension as "MyAnimeList Updater for TRanimeizle" and described it as working on
  `tranimeizle.io` only, long after five more sites were supported.
- **Dropped the unused `tranimeizle.io` host permission.** Declarative content scripts
  take their injection rights from `content_scripts[].matches`, and nothing in the
  extension fetches a streaming site — only MAL. `host_permissions` now covers just the
  two MAL hosts, narrowing the install-time permission prompt with no behavior change.
- **Docs corrected.** The README no longer claims OAuth uses
  `chrome.identity.launchWebAuthFlow` (it opens a normal browser tab and captures the
  redirect) or that no Client Secret is needed (MAL requires it at the token
  endpoint). The `background.js` header comment, which still made both of those
  now-corrected claims, has been brought in line with the code.
- **Added `CLAUDE.md`** documenting the architecture, the four-file sync required to add
  a site, and the non-obvious MAL/PKCE and slug-caching constraints.

## [1.0.0]

_Initial release._

### Added

- Manifest V3 browser extension that detects the anime/episode on Turkish anime
  streaming sites and updates MyAnimeList progress via the official MAL API v2.
- OAuth2 with PKCE (`plain` method) using the user's own Client ID + Client Secret;
  token storage and automatic refresh.
- Per-site content-script **adapter** system with a DOM-free site registry:
  TRanimeizle, Anizm, TürkAnime, Animeler (verified); AnimeCix, OpenAnime
  (best-effort / UNVERIFIED SPAs).
- Title → MAL id resolution with candidate scoring, a manual pick list for ambiguous
  matches, and a `slug → malId` cache for instant subsequent updates.
- `PATCH /anime/{id}/my_list_status` update of `num_watched_episodes` + `status`.
- **Auto-update while watching**, triggered by real video progress (~60%) or a 90s
  fallback for cross-origin players.
- Toolbar status badge reflecting the MyAnimeList connection state.

[Unreleased]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ugurinal/MyAnimeListExtension/releases/tag/v1.0.0
