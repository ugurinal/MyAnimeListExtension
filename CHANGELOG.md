# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.3] - 2026-09-23

### Fixed

- **TRanimeizle stopped being detected** after the site moved to `www.tranimeizle.live`.
  Added `tranimeizle.live` to the site's hosts in `sites.js` and to the manifest's
  content-script matches; the older `.io`/`.co`/`.net` domains are kept in case the site
  rotates back.
- **A manually picked anime didn't stick.** Choosing the right entry from the search/pick
  list only changed the popup's display; the match was saved only after a successful
  "Update progress on MAL", and only when the page URL yielded a slug. Picks are now
  saved immediately (new `SET_MAPPING` message), and mappings are keyed per site by both
  slug and title+season, so the same show resolves on later episodes and visits even
  without a slug (the title key is used only when the page has no slug). Existing
  slug-only mappings still resolve.

## [1.1.2] - 2026-07-31

### Fixed

- **`MAL search failed (400): {"message":"invalid q","error":"bad_request"}` on long anime
  titles.** MAL requires the search `q` to be 3–64 characters (undocumented in its own API
  reference), but `sanitizeSearchQuery()` capped at 80, so any title between 65 and 80
  characters was sent oversized and rejected. Hit on Anizm's
  *Rakudai Kenja no Gakuin Musou: Nidome no Tensei, S-Rank Cheat Majutsushi Boukenroku*,
  and applied to every site — long light-novel titles were simply unresolvable. The cap is
  now 64 and truncates on a word boundary, since a mid-word slice matches nothing on MAL.
- **Titles wrapped entirely in brackets collapsed to an empty query.** The WAF-avoidance
  step strips whole `(…)`/`[…]` groups, which turned `[Oshi no Ko]` into `""` — also an
  `invalid q`. It now falls back to keeping the inner text and dropping just the bracket
  characters, which is equally WAF-safe.
- **A single unusable query variant aborted the whole lookup.** `searchAnime()` now returns
  no results for a query below MAL's 3-character minimum instead of throwing, so a short
  base title no longer prevents the season-qualified variants from being tried.
- **Sites that pre-truncate their own `og:title` leaked the ellipsis into the search.**
  Anizm serves `"… S-Rank Cheat Maj..."` while its `<h1>` carries the full title.
  `cleanAnimeTitle()` now strips a trailing `...`/`…` (and a trailing `/`), and
  `genericDetect()` prefers the page heading only when `og:title` is visibly truncated —
  deliberately narrow, so the verified adapters keep their existing title source.

## [1.1.1] - 2026-07-24

### Fixed

- **Client Secret input in Settings didn't match the Client ID input's styling.** It was
  a `type="password"` field, but the shared input styling (`popup.css`) only targeted
  `input[type="text"]`, so it fell back to unstyled browser chrome instead of the dark
  theme, border, radius, padding and focus state used everywhere else. Extended those
  selectors to also cover `input[type="password"]`.

## [1.1.0] - 2026-07-24

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

[Unreleased]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/ugurinal/MyAnimeListExtension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ugurinal/MyAnimeListExtension/releases/tag/v1.0.0
