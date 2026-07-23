/*
 * adapters/anizm.js — VERIFIED URL pattern.
 *
 * Episode page: https://anizm.net/{series-slug}-{N}-bolum-izle
 *   (e.g. https://anizm.net/one-piece-1-bolum-izle)
 * Title appears as "<Anime> N. Bölüm izle | Anizm".
 */
(function () {
  "use strict";
  const A = window.MALAdapters;
  const URL_RE = /\/([a-z0-9\-]+?)-(\d+)-bolum-izle(?:[/?#]|$)/i;

  A.register({
    id: "anizm",
    isEpisodePage: (doc, url) => A.genericIsEpisodePage(doc, url, URL_RE),
    detect: (doc, url) =>
      A.genericDetect(doc, url, {
        urlRe: URL_RE,
        titleSelectors: ["h1", ".seri-adi", ".anime-title", ".title"],
      }),
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
