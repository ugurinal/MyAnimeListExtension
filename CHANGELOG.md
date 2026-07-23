# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TRAnimeci support** (`tranimaci.com`) — episode pages of the form
  `/video/{id}-{slug}-{N}-bolum`. Verified against a saved episode page. Note this is a
  different site from TRanimeizle despite the similar name.

### Changed

- **OpenAnime is now verified, and its adapter rewritten.** The real watch route is
  `/anime/{slug}/{season}/{episode}` — there is no numeric id segment, contrary to what
  the best-effort adapter assumed.
- **AnimeCix is now verified.** Its adapter has been exercised against the live site; no
  code change was needed. No adapter is marked UNVERIFIED any more.

### Removed

- **Animeler support** (`animeler.me`, `animeler.pw`) — adapter, site registry entry and
  manifest matches dropped.

### Fixed

- **OpenAnime reported the season number as the episode.** The old adapter took the
  first trailing numeric URL segment, which is the season, so
  `/anime/{slug}/1/4` was detected as episode 1 rather than episode 4.
- **OpenAnime never detected a season, and its slug collided across seasons.** Season is
  now read from the URL (or the `S01B04` title marker, or the Turkish description), and
  `seriesSlug` is season-qualified (`{slug}-s{season}`) so seasons sharing one slug can no
  longer overwrite each other's MAL mapping.
- **OpenAnime's episode marker leaked into the MAL search query.** Titles read as
  `"... S01B04"`; the marker is now stripped before the title is searched.

## [1.0.0] - 2026-07-24

_Initial release._

### Added

- Manifest V3 browser extension that detects the anime/episode you are watching on a
  Turkish anime streaming site and updates your MyAnimeList progress via the official
  MAL API v2. Vanilla JS/HTML/CSS — no bundler, no dependencies, loads unpacked.
- OAuth2 with PKCE (`plain` method) using your own Client ID + Client Secret, with
  token storage and automatic refresh. Sign-in opens in a normal browser tab and the
  redirect is captured from `tabs.onUpdated`, because MAL's authorize page refuses to
  render inside `chrome.identity.launchWebAuthFlow`'s cookieless window.
- Per-site content-script **adapter** system with a DOM-free site registry:
  TRanimeizle, Anizm, TürkAnime, Animeler (verified); AnimeCix, OpenAnime
  (best-effort / UNVERIFIED SPAs).
- Title → MAL id resolution with candidate scoring, a manual pick list for ambiguous
  matches, and a `slug → malId` cache for instant subsequent updates. Cache keys are
  season-qualified on sites that nest every season under one slug (AnimeciX), so
  seasons cannot collide.
- **Season-aware resolution.** Because each MAL season is a separate catalog entry, a
  `season ≥ 2` detection also searches season-qualified title variants ("Season 2",
  "2nd Season", "Part 2", roman numerals) and only auto-accepts a candidate carrying a
  matching season marker — markerless matches are surfaced for confirmation rather
  than silently writing to the Season 1 entry.
- **Target preview in the popup.** A "Will update on MAL" card shows the exact MAL
  entry that will be edited — full title, cover image, and a link to its
  `myanimelist.net/anime/{id}` page — before you commit. Backed by a read-only
  `RESOLVE` worker message that resolves the match without patching MAL.
- **"Change / wrong anime?" control.** A MyAnimeList search box + candidate picker
  that is always available, not only when the automatic match is uncertain, so you can
  override the target at any time. The chosen entry is cached per series slug.
- `PATCH /anime/{id}/my_list_status` update of `num_watched_episodes` + `status`, with
  an optional 1–10 **score** selector.
- **Automatic dates.** `start_date` is stamped with today's local date the first time
  an entry has none; `finish_date` is stamped when the status is set to **Completed**
  or **Dropped**. Existing dates are left untouched.
- **Auto-update while watching**, triggered by real video progress (~60%) or a 90s
  fallback for cross-origin players.
- Toolbar status badge reflecting the MyAnimeList connection state.
- Search queries are sanitized — release-year suffixes such as `(2026)` are stripped
  from titles, parenthetical/bracketed segments removed, and length capped — because
  MAL's edge WAF answers such queries with an HTML `403` page. A blocked search shows a
  short message pointing at the manual search instead of raw markup.

[Unreleased]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ugurinal/MyAnimeListExtension/releases/tag/v1.0.0
