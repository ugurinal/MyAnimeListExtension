/*
 * sites.js — shared, DOM-free registry of supported streaming sites.
 *
 * Loaded in THREE contexts (content script, popup, and — via importScripts —
 * potentially the worker), so it must not touch `document`/`window` at load time.
 * It only carries metadata + hostname lookup. The actual per-site detection logic
 * lives in src/adapters/*.js (content-script only).
 *
 * `matches` are Chrome match patterns and are kept in sync with
 * manifest.json `content_scripts[].matches`.
 * `verified` = the URL/DOM pattern was confirmed against a real page; `false` means
 * a best-effort UNVERIFIED adapter (see README).
 */
(function (root) {
  "use strict";

  const SUPPORTED_SITES = [
    {
      id: "tranimeizle",
      name: "TRanimeizle",
      hosts: ["tranimeizle.io", "tranimeizle.co", "tranimeizle.net"],
      matches: [
        "*://*.tranimeizle.io/*",
        "*://*.tranimeizle.co/*",
        "*://*.tranimeizle.net/*",
      ],
      verified: true,
    },
    {
      id: "anizm",
      name: "Anizm",
      hosts: ["anizm.net", "anizm.tr"],
      matches: ["*://*.anizm.net/*", "*://*.anizm.tr/*"],
      verified: true,
    },
    {
      id: "turkanime",
      name: "TürkAnime",
      hosts: ["turkanime.co", "turkanime.tv", "turkanime.com.tr", "turkanime.pro"],
      matches: [
        "*://*.turkanime.co/*",
        "*://*.turkanime.tv/*",
        "*://*.turkanime.com.tr/*",
        "*://*.turkanime.pro/*",
      ],
      verified: true,
    },
    {
      id: "tranimaci",
      name: "TRAnimeci",
      hosts: ["tranimaci.com"],
      matches: ["*://*.tranimaci.com/*"],
      verified: true,
    },
    {
      id: "animecix",
      name: "AnimeCix",
      hosts: ["animecix.tv", "animecix.net"],
      matches: ["*://*.animecix.tv/*", "*://*.animecix.net/*"],
      verified: true, // Cloudflare-protected SPA; confirmed by live testing
    },
    {
      id: "openanime",
      name: "OpenAnime",
      hosts: ["openani.me", "openanime.com.tr"],
      matches: ["*://*.openani.me/*", "*://*.openanime.com.tr/*"],
      verified: true, // watch route confirmed against a saved openani.me page
    },
  ];

  // Return the site whose host list matches a given hostname, or null.
  function siteForHostname(hostname) {
    if (!hostname) return null;
    const h = hostname.toLowerCase().replace(/^www\./, "");
    for (const site of SUPPORTED_SITES) {
      for (const base of site.hosts) {
        if (h === base || h.endsWith("." + base)) return site;
      }
    }
    return null;
  }

  // Convenience: resolve from a full URL string.
  function siteForUrl(url) {
    try {
      return siteForHostname(new URL(url).hostname);
    } catch (_) {
      return null;
    }
  }

  const api = { SUPPORTED_SITES, siteForHostname, siteForUrl };

  // Expose on whatever global object exists (window in page/popup, self in worker).
  root.MALSites = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this);
