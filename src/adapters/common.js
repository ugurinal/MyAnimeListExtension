/*
 * adapters/common.js — shared helpers + the runtime adapter registry.
 *
 * Content scripts can't use ES modules, so every adapter file is listed in
 * manifest.json and communicates through a single global (`MALAdapters`) attached
 * here. Each adapter calls MALAdapters.register({...}); content.js later looks one
 * up by site id via MALAdapters.get(id).
 *
 * The detection helpers below are Turkish-aware:
 *   "Bölüm" = episode, "Sezon" = season, "İzle" = watch.
 */
(function () {
  "use strict";

  const registry = new Map();

  function register(adapter) {
    if (!adapter || !adapter.id) throw new Error("Adapter needs an id");
    registry.set(adapter.id, adapter);
  }
  function get(id) {
    return registry.get(id) || null;
  }
  function list() {
    return Array.from(registry.values());
  }

  // Read a <meta property="..."> or <meta name="..."> content value.
  function metaContent(doc, key) {
    const el =
      doc.querySelector(`meta[property="${key}"]`) ||
      doc.querySelector(`meta[name="${key}"]`);
    return el ? el.getAttribute("content") : null;
  }

  // First non-empty text among a list of CSS selectors.
  function textFromSelectors(doc, selectors) {
    for (const sel of selectors || []) {
      const el = doc.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  // Strip the Turkish episode/season suffix and trailing "İzle" from a display
  // title, e.g. "One Piece 2. Sezon 5. Bölüm İzle" -> "One Piece".
  function cleanAnimeTitle(raw) {
    if (!raw) return "";
    let t = String(raw).trim();
    // Cut everything from the first "<n>. Sezon" or "<n>. Bölüm" onward.
    t = t.replace(/\s*\d+\s*\.??\s*(?:Sezon|B[oö]l[uü]m).*$/iu, "");
    // Remove any site-name tail after a separator (" | Anizm", " - Turkanime", …).
    t = t.replace(/\s*[|–—\-–—:]\s*[^|\-–—:]{0,40}$/u, function (m) {
      // Only drop it if the tail looks like a site/section label, not part of a title.
      return /izle|anime|hd|tv|net|com|\.me|watch/i.test(m) ? "" : m;
    });
    // Remove a lone trailing "İzle"/"izle".
    t = t.replace(/\s*[İIi]zle\s*$/u, "");
    // Strip a trailing parenthetical that is *purely* a year or year range, e.g.
    // "... (2026)" or "... (2019-2020)" — this is a release-year annotation
    // (seen on AnimeciX og:title), not part of the anime's actual title. Kept
    // conservative: only matches 4-digit years, so real parenthetical titles
    // (e.g. "Fullmetal Alchemist (Brotherhood)") are left alone.
    t = t.replace(/\s*\(\s*\d{4}\s*(?:[-–—]\s*\d{4}\s*)?\)\s*$/u, "");
    t = t.replace(/\s+/g, " ").replace(/[\s\-–—:|]+$/u, "").trim();
    return t;
  }

  // Extract an episode number from "... N. Bölüm ..." text.
  function episodeFromTitle(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+)\s*\.??\s*B[oö]l[uü]m/iu);
    return m ? parseInt(m[1], 10) : null;
  }

  // Extract a season number from "... N. Sezon ..." text (optional).
  function seasonFromTitle(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+)\s*\.??\s*Sezon/iu);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Generic detector used by most "…-N-bolum…" sites.
   * opts = { urlRe, titleSelectors }
   *   urlRe: RegExp with capture groups (1)=seriesSlug (2)=episodeNumber
   * Returns { animeTitle, episode, seriesSlug, season } | null.
   */
  function genericDetect(doc, url, opts) {
    const m = opts.urlRe ? url.match(opts.urlRe) : null;
    let seriesSlug = m ? m[1] : null;
    let episode = m ? parseInt(m[2], 10) : null;

    const rawTitle =
      metaContent(doc, "og:title") ||
      textFromSelectors(doc, opts.titleSelectors) ||
      doc.title;

    if (episode == null) episode = episodeFromTitle(rawTitle);
    const animeTitle = cleanAnimeTitle(rawTitle);
    const season = seasonFromTitle(rawTitle) || seasonFromTitle(url);

    if (!animeTitle || episode == null) return null;
    return { animeTitle, episode, seriesSlug, season: season || null };
  }

  function genericIsEpisodePage(doc, url, urlRe) {
    if (urlRe && urlRe.test(url)) return true;
    return metaContent(doc, "og:type") === "video.episode";
  }

  window.MALAdapters = {
    register,
    get,
    list,
    // helpers exposed for individual adapters:
    metaContent,
    textFromSelectors,
    cleanAnimeTitle,
    episodeFromTitle,
    seasonFromTitle,
    genericDetect,
    genericIsEpisodePage,
  };
})();
