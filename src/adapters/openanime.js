/*
 * adapters/openanime.js — UNVERIFIED (best-effort).
 *
 * OpenAnime (openani.me / openanime.com.tr) is a modern SPA whose exact watch-route
 * DOM could not be confirmed at build time. Its anime routes are of the form
 *     https://openani.me/anime/{id}/{series-slug}
 * with the watch view adding season/episode segments (e.g. .../{season}/{episode}).
 *
 * Strategy: read the episode number from the document title ("N. Bölüm") or from
 * trailing numeric URL segments after the slug; read the slug from /anime/{id}/{slug}.
 * Re-run on SPA route changes by content.js. Update this adapter once the real
 * structure is confirmed.
 */
(function () {
  "use strict";
  const A = window.MALAdapters;

  const ANIME_RE = /\/anime\/(?:\d+\/)?([a-z0-9\-]+)/i;
  const BOLUM_URL_RE = /[-/](\d+)-bolum/i;
  // Trailing ".../{season}/{episode}" numeric segments as a last resort.
  const TRAILING_EP_RE = /\/anime\/[^?#]*?\/(\d+)(?:[/?#]|$)/i;

  function detect(doc, url) {
    const rawTitle = A.metaContent(doc, "og:title") || doc.title;

    let episode = A.episodeFromTitle(rawTitle);
    if (episode == null) {
      const mb = url.match(BOLUM_URL_RE);
      if (mb) episode = parseInt(mb[1], 10);
    }
    if (episode == null) {
      const mt = url.match(TRAILING_EP_RE);
      if (mt) episode = parseInt(mt[1], 10);
    }

    let seriesSlug = null;
    const ms = url.match(ANIME_RE);
    if (ms) seriesSlug = ms[1];

    const animeTitle = A.cleanAnimeTitle(rawTitle);
    if (!animeTitle || episode == null) return null;
    return {
      animeTitle,
      episode,
      seriesSlug,
      season: A.seasonFromTitle(rawTitle) || A.seasonFromTitle(url) || null,
    };
  }

  A.register({
    id: "openanime",
    isEpisodePage(doc, url) {
      if (!/\/anime\//i.test(url)) return false;
      return detect(doc, url) != null;
    },
    detect,
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
