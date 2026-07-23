/*
 * adapters/tranimeizle.js — VERIFIED against a saved episode page.
 *
 * Episode page: https://www.tranimeizle.io/{series-slug}-{N}-bolum-izle
 * Series page:  https://www.tranimeizle.io/anime/{series-slug}
 * og:type = "video.episode"; og:title = "<Anime> N. Bölüm İzle".
 * Episode list items use ".episode-li"; breadcrumb's last <li class="active">
 * links to the current episode.
 */
(function () {
  "use strict";
  const A = window.MALAdapters;

  const URL_RE = /\/([a-z0-9\-]+?)-(\d+)-bolum-izle(?:[/?#]|$)/i;

  A.register({
    id: "tranimeizle",

    isEpisodePage(doc, url) {
      return A.genericIsEpisodePage(doc, url, URL_RE);
    },

    detect(doc, url) {
      const m = url.match(URL_RE);
      const seriesSlug = m ? m[1] : null;
      let episode = m ? parseInt(m[2], 10) : null;

      // Title strategy chain: og:title -> /anime/ breadcrumb -> <title> -> active li.
      let rawTitle =
        A.metaContent(doc, "og:title") ||
        A.textFromSelectors(doc, ['.breadcrumb a[href*="/anime/"]']) ||
        doc.title;
      if (!rawTitle) {
        rawTitle = A.textFromSelectors(doc, [
          ".episode-li.active .etitle span",
          "li.active .episode-li .etitle span",
          ".episode-li.active",
        ]);
      }

      if (episode == null) episode = A.episodeFromTitle(rawTitle);
      const animeTitle = A.cleanAnimeTitle(rawTitle);
      if (!animeTitle || episode == null) return null;

      // The /anime/ breadcrumb slug can differ from the episode slug; capture it.
      let seriesDetailSlug = null;
      const crumb = doc.querySelector('.breadcrumb a[href*="/anime/"]');
      if (crumb) {
        const mm = crumb.getAttribute("href").match(/\/anime\/([a-z0-9\-]+)/i);
        if (mm) seriesDetailSlug = mm[1];
      }

      return {
        animeTitle,
        episode,
        seriesSlug,
        seriesDetailSlug,
        season: A.seasonFromTitle(rawTitle) || null,
      };
    },

    getVideoEl(doc) {
      return doc.querySelector("video");
    },
  });
})();
