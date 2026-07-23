/*
 * adapters/animecix.js — VERIFIED by live testing.
 *
 * AnimeCix (animecix.tv / animecix.net) is a Cloudflare-protected React SPA. Its
 * watch-route shape was confirmed from a saved page (og:url / canonical) and the
 * adapter has since been exercised against the live site:
 *     https://animecix.tv/titles/{numericId}/{text-slug}/season/{S}/episode/{E}
 * i.e. the numeric title id and the text slug are SLASH-separated path segments (not
 * hyphen-joined as previously assumed), followed by explicit /season/N/episode/M
 * segments. An older/alternate "/titles/{id}-{slug}" form is also tolerated.
 *
 * IMPORTANT: AnimeciX nests every season of a series under the SAME numeric title id
 * and the SAME text slug — only the /season/N/ segment changes. If seriesSlug were
 * just that text slug, the background's slugMap cache (seriesSlug -> malId) would
 * collide across seasons and season 2 would silently overwrite season 1's MAL entry.
 * So seriesSlug here is season-qualified: "${slug}-s${season}" when a season is known,
 * falling back to the bare slug only when no season could be determined.
 *
 * Strategy: recognise /titles/ URLs, pull the numeric id + text slug from the path,
 * read season/episode from the explicit /season/N/episode/M segments first, and fall
 * back to the document title / other URL forms ("N. Bölüm", trailing "-N-bolum", or
 * an "?episode=" query param). Because it's an SPA, detection is re-run on route
 * changes by content.js — that re-detection is what makes this site work at all, so
 * be careful changing it.
 */
(function () {
  "use strict";
  const A = window.MALAdapters;

  // /titles/{id}/{slug}[/season/{S}/episode/{E}] — the current real shape.
  const TITLES_SLASH_RE = /\/titles\/(\d+)\/([a-z0-9\-]+)/i;
  // Older/alternate /titles/{id}-{slug} form, tolerated as a fallback.
  const TITLES_DASH_RE = /\/titles\/(\d+)-([a-z0-9\-]+)/i;
  const SEASON_EPISODE_URL_RE = /\/season\/(\d+)\/episode\/(\d+)/i;
  const BOLUM_URL_RE = /[-/](\d+)-bolum/i;
  const EP_QUERY_RE = /[?&](?:episode|ep|bolum)=(\d+)/i;

  function detect(doc, url) {
    const rawTitle = A.metaContent(doc, "og:title") || doc.title;

    // Season/episode: explicit /season/N/episode/M URL segments first.
    let episode = null;
    let season = null;
    const mse = url.match(SEASON_EPISODE_URL_RE);
    if (mse) {
      season = parseInt(mse[1], 10);
      episode = parseInt(mse[2], 10);
    }

    // Episode fallbacks: title text, then other URL forms.
    if (episode == null) episode = A.episodeFromTitle(rawTitle);
    if (episode == null) {
      const mb = url.match(BOLUM_URL_RE);
      if (mb) episode = parseInt(mb[1], 10);
    }
    if (episode == null) {
      const mq = url.match(EP_QUERY_RE);
      if (mq) episode = parseInt(mq[1], 10);
    }

    // Season fallback: title text / URL "N. Sezon".
    if (season == null) season = A.seasonFromTitle(rawTitle) || A.seasonFromTitle(url) || null;

    // Numeric title id + text slug from /titles/{id}/{slug} (or the older
    // /titles/{id}-{slug} form).
    let numericId = null;
    let textSlug = null;
    const msSlash = url.match(TITLES_SLASH_RE);
    if (msSlash) {
      numericId = msSlash[1];
      textSlug = msSlash[2];
    } else {
      const msDash = url.match(TITLES_DASH_RE);
      if (msDash) {
        numericId = msDash[1];
        textSlug = msDash[2];
      }
    }

    // Season-qualify the seriesSlug so different seasons under the same title id
    // never collide in the background's seriesSlug -> malId cache (see header
    // comment). Only append the season suffix when a season is actually known.
    const baseSlug = textSlug || numericId || null;
    const seriesSlug = baseSlug ? (season != null ? `${baseSlug}-s${season}` : baseSlug) : null;

    const animeTitle = A.cleanAnimeTitle(rawTitle);
    if (!animeTitle || episode == null) return null;
    return {
      animeTitle,
      episode,
      seriesSlug,
      season,
    };
  }

  A.register({
    id: "animecix",
    isEpisodePage(doc, url) {
      // Only meaningful when we can actually extract an episode number.
      if (!/\/titles\//i.test(url)) return false;
      return detect(doc, url) != null;
    },
    detect,
    getVideoEl: (doc) => doc.querySelector("video"),
  });
})();
