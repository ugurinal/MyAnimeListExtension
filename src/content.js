/*
 * content.js — runs on every supported streaming site (see manifest matches).
 *
 * It is site-agnostic: it resolves the matching adapter for the current hostname
 * (via MALSites + MALAdapters, loaded before this file) and delegates all
 * site-specific parsing to that adapter. Everything downstream (reporting to the
 * worker, auto-update signalling) is shared across sites.
 *
 * Load order (manifest content_scripts.js):
 *   sites.js -> adapters/common.js -> adapters/*.js -> content.js
 */
(function () {
  "use strict";

  const site = window.MALSites.siteForHostname(location.hostname);
  const adapter = site ? window.MALAdapters.get(site.id) : null;

  // Should never happen (content script only injects on matched hosts), but guard.
  if (!site || !adapter) return;

  // ---- Detection wrapper --------------------------------------------------

  let lastDetection = null;

  function detect() {
    let d = null;
    try {
      if (adapter.isEpisodePage(document, location.href)) {
        d = adapter.detect(document, location.href);
      }
    } catch (e) {
      d = null; // adapter bug shouldn't break the page
    }
    if (d) {
      // Attach shared context every detection carries.
      d.url = location.href;
      d.siteId = site.id;
      d.siteName = site.name;
      d.verified = site.verified;
    }
    return d;
  }

  function report() {
    const d = detect();
    lastDetection = d;
    try {
      chrome.runtime.sendMessage({ type: "DETECTED", payload: d }, () => {
        void chrome.runtime.lastError; // ignore "no receiver"
      });
    } catch (_) {
      /* extension context invalidated during navigation */
    }
    return d;
  }

  // Answer direct queries from the popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "GET_DETECTION") {
      sendResponse({ detection: lastDetection || detect(), site });
      return true;
    }
    return false;
  });

  // ---- Auto-update-on-watch ----------------------------------------------
  //
  // Only report "watched" after the user has actually consumed part of the
  // episode: a <video> crossing ~60% of its duration, else a 90s fallback timer
  // (useful when the player is a cross-origin iframe we can't read). Fires once
  // per detected episode.

  let watchedFired = false;

  function fireWatched() {
    if (watchedFired || !lastDetection) return;
    watchedFired = true;
    try {
      chrome.runtime.sendMessage(
        { type: "EPISODE_WATCHED", payload: lastDetection },
        () => void chrome.runtime.lastError
      );
    } catch (_) {
      /* ignore */
    }
  }

  function setupWatchTracking() {
    const video =
      (adapter.getVideoEl && adapter.getVideoEl(document)) ||
      document.querySelector("video");
    if (video) {
      video.addEventListener("timeupdate", function onTime() {
        if (!video.duration || isNaN(video.duration)) return;
        const threshold = Math.min(video.duration * 0.6, video.duration - 30);
        if (threshold > 0 && video.currentTime >= threshold) {
          video.removeEventListener("timeupdate", onTime);
          fireWatched();
        }
      });
    }
    setTimeout(fireWatched, 90 * 1000);
  }

  // ---- Boot & SPA navigation handling ------------------------------------

  function init() {
    report();
    if (!lastDetection) return; // not on an episode page (yet)
    try {
      chrome.runtime.sendMessage({ type: "GET_AUTO_UPDATE" }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.autoUpdate) setupWatchTracking();
      });
    } catch (_) {
      /* ignore */
    }
  }

  // Many of these sites (esp. the SPA ones) swap content without a full reload.
  let lastUrl = location.href;
  const urlWatcher = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      watchedFired = false;
      init();
    }
  }, 1500);
  window.addEventListener("unload", () => clearInterval(urlWatcher));

  // For SPAs, the initial DOM/title may not be ready at document_idle; re-detect
  // a few times shortly after load if nothing was found yet.
  let retries = 0;
  const retry = setInterval(() => {
    if (lastDetection || retries++ >= 5) {
      clearInterval(retry);
      return;
    }
    init();
  }, 1200);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
