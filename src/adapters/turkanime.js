/*
 * adapters/turkanime.js — VERIFIED URL pattern.
 *
 * Episode video page: https://www.turkanime.tv/video/{series-slug}-{N}-bolum
 *   (e.g. /video/one-piece-1169-bolum, /video/tenmaku-no-jaadugar-4-bolum)
 * Series page:        https://www.turkanime.tv/anime/{series-slug}
 * Heading/title:      "<Anime> N. Bölüm".
 * NOTE: unlike anizm/tranimeizle the slug is under /video/ and has no "-izle".
 */
(function () {
  "use strict";
  const A = window.MALAdapters;
  const URL_RE = /\/video\/([a-z0-9\-]+?)-(\d+)-bolum(?:[/?#]|$)/i;

  A.register({
    id: "turkanime",
    isEpisodePage: (doc, url) => A.genericIsEpisodePage(doc, url, URL_RE),
    detect: (doc, url) =>
      A.genericDetect(doc, url, {
        urlRe: URL_RE,
        titleSelectors: ["#detayPul h1", ".media-title", "h1", ".title"],
      }),
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
