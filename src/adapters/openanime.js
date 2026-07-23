/*
 * adapters/openanime.js — VERIFIED against a saved episode page.
 *
 * Watch route, confirmed from the canonical URL and the in-page episode links:
 *     https://openani.me/anime/{series-slug}/{season}/{episode}
 *     e.g. /anime/the-exiled-heavy-knight-knows-how-to-game-the-system/1/4
 * There is NO numeric id segment (an earlier best-effort version of this adapter
 * assumed "/anime/{id}/{slug}"). Season and episode are the two trailing numeric
 * segments, in that order — the previous code read the FIRST trailing number and
 * so reported the season as the episode.
 *
 * Titles are English and mark the episode as "S01B04" (B = Bölüm) rather than the
 * Turkish "N. Bölüm" wording the shared helpers look for:
 *     <title>   The Exiled Heavy Knight Knows How to Game the System S01B04 | OpenAnime
 *     og:title  The Exiled Heavy Knight Knows How to Game the System S01B04
 * The description meta does spell it out in Turkish ("... 1. Sezon 4. Bölüm izle"),
 * so it serves as a fallback when the URL carries no numbers.
 *
 * IMPORTANT: every season lives under the SAME series slug — only the /{season}/
 * segment changes — so seriesSlug is season-qualified ("{slug}-s{season}"). Without
 * that, the background's slugMap (seriesSlug -> malId) would collapse every season
 * onto one MAL entry. Same reasoning as adapters/animecix.js.
 */
(function () {
  "use strict";
  const A = window.MALAdapters;

  // /anime/{slug}/{season}/{episode} — the confirmed watch route.
  const WATCH_RE = /\/anime\/([a-z0-9\-]+)\/(\d+)\/(\d+)(?:[/?#]|$)/i;
  // /anime/{slug} — slug only, used when the numbers come from the title instead.
  const SLUG_RE = /\/anime\/([a-z0-9\-]+)/i;
  // "S01B04" — season + episode marker used in the page/og title.
  const SXXBXX_RE = /\bS(\d{1,2})B(\d{1,3})\b/i;

  // Remove the "S01B04" marker so it doesn't end up in the MAL search query.
  function stripEpisodeMarker(raw) {
    return String(raw || "").replace(/\s*\bS\d{1,2}B\d{1,3}\b\s*/i, " ");
  }

  function detect(doc, url) {
    const rawTitle = A.metaContent(doc, "og:title") || doc.title;
    const desc =
      A.metaContent(doc, "og:description") || A.metaContent(doc, "description");

    let seriesSlug = null;
    let season = null;
    let episode = null;

    // The URL is authoritative when it carries the full watch route.
    const mw = url.match(WATCH_RE);
    if (mw) {
      seriesSlug = mw[1];
      season = parseInt(mw[2], 10);
      episode = parseInt(mw[3], 10);
    } else {
      const ms = url.match(SLUG_RE);
      if (ms) seriesSlug = ms[1];
    }

    // Fall back to the "S01B04" title marker, then to the Turkish description.
    if (season == null || episode == null) {
      const mk = String(rawTitle || "").match(SXXBXX_RE);
      if (mk) {
        if (season == null) season = parseInt(mk[1], 10);
        if (episode == null) episode = parseInt(mk[2], 10);
      }
    }
    if (episode == null) episode = A.episodeFromTitle(desc);
    if (season == null) season = A.seasonFromTitle(desc);

    const animeTitle = A.cleanAnimeTitle(stripEpisodeMarker(rawTitle));
    if (!animeTitle || episode == null) return null;

    return {
      animeTitle,
      episode,
      // Season-qualified so seasons sharing one slug can't collide in slugMap.
      seriesSlug: seriesSlug
        ? season != null
          ? `${seriesSlug}-s${season}`
          : seriesSlug
        : null,
      season: season != null ? season : null,
    };
  }

  A.register({
    id: "openanime",
    isEpisodePage(doc, url) {
      if (WATCH_RE.test(url)) return true;
      // A series page (/anime/{slug}) must not be treated as an episode just
      // because its description mentions one, so require the title marker.
      if (!/\/anime\//i.test(url)) return false;
      return SXXBXX_RE.test(A.metaContent(doc, "og:title") || doc.title || "");
    },
    detect,
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
