/*
 * adapters/tranimaci.js — VERIFIED against a saved episode page.
 *
 * TRAnimeci (tranimaci.com) — note the spelling: "tranim-A-ci", a different site
 * from TRanimeizle (adapters/tranimeizle.js).
 *
 * Episode page: https://tranimaci.com/video/{id}-{series-slug}-{N}-bolum
 *   e.g. /video/474-the-exiled-heavy-knight-knows-how-to-game-the-system-4-bolum
 * Same shape as TürkAnime's /video/{slug}-{N}-bolum, plus a leading numeric id.
 * og:type is "video.episode" and og:title carries the Turkish "N. Bölüm" wording,
 * so the shared generic detector handles this site as-is.
 *
 * NOTE: the URL slug is the ENGLISH title while the page title is the ROMAJI one
 * ("...the-exiled-heavy-knight..." vs "Tsuihou sareta Tensei Juukishi wa..."). The
 * romaji title is what gets searched on MAL, which is the better of the two — it
 * matches MAL's primary title field directly. The slug is only ever a cache key.
 */
(function () {
  "use strict";
  const A = window.MALAdapters;

  // The leading "{id}-" is optional so a future URL without it still parses.
  // Capture groups must stay (1)=seriesSlug (2)=episode for genericDetect.
  const URL_RE = /\/video\/(?:\d+-)?([a-z0-9\-]+?)-(\d+)-bolum(?:[/?#]|$)/i;

  A.register({
    id: "tranimaci",
    isEpisodePage: (doc, url) => A.genericIsEpisodePage(doc, url, URL_RE),
    detect: (doc, url) =>
      A.genericDetect(doc, url, {
        urlRe: URL_RE,
        titleSelectors: ["h1", ".media-title", ".title"],
      }),
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
