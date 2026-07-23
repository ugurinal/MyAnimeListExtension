/*
 * adapters/animeler.js — VERIFIED URL pattern.
 *
 * Episode page: https://animeler.me/izle/{series-slug}-{N}-bolum/
 *   (e.g. https://animeler.me/izle/school-days-1-bolum/)
 * Series page:  https://animeler.me/anime/
 * Title:        "<Anime> N. Bölüm izle - Animeler Pw".
 */
(function () {
  "use strict";
  const A = window.MALAdapters;
  const URL_RE = /\/izle\/([a-z0-9\-]+?)-(\d+)-bolum(?:[/?#]|$)/i;

  A.register({
    id: "animeler",
    isEpisodePage: (doc, url) => A.genericIsEpisodePage(doc, url, URL_RE),
    detect: (doc, url) =>
      A.genericDetect(doc, url, {
        urlRe: URL_RE,
        titleSelectors: ["h1.entry-title", "h1", ".title"],
      }),
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
