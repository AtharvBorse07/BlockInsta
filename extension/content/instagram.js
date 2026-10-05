(function initializeInstagramGuard() {
  "use strict";

  if (window.top !== window) {
    return;
  }

  const compat = globalThis.BlockInstaCompat;
  const settingsApi = globalThis.BlockInstaSettings;
  const routesApi = globalThis.BlockInstaRoutes;
  const feedGuardApi = globalThis.BlockInstaFeedGuard;
  const searchGuardApi = globalThis.BlockInstaSearchGuard;
  const api = compat.api;
  const STORAGE_KEY = "settings";
  const LOCATION_CHECK_MS = 250;
  const PENDING_VIEWER_MS = 3000;
  const BLOCKED_KEYS = new Set([
    " ",
    "ArrowDown",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
  ]);

  let settings = { ...settingsApi.DEFAULT_SETTINGS };
  let allowedItemId = null;
  let pendingViewerUntil = 0;
  let lastHref = window.location.href;
  let redirecting = false;
  let scanScheduled = false;

  const feedGuard = feedGuardApi.createFeedGuard();
  const searchGuard = searchGuardApi.createSearchGuard();

  const root = document.documentElement;
  root.dataset.blockinstaActive = "true";
  root.dataset.blockinstaBlockFeed = "true";
  searchGuard.updateSettings(settings);

  function protectionEnabled() {
    return settings.enabled
      && (settings.blockReelsFeed
        || settings.hideSearchDiscovery
        || settings.limitHomeFeed
        || settings.limitIndividualReels);
  }

  function updateRootState(singleReel = false) {
    root.dataset.blockinstaActive = String(protectionEnabled());
    root.dataset.blockinstaBlockFeed = String(
      settings.enabled && settings.blockReelsFeed,
    );
    if (singleReel && settings.enabled && settings.limitIndividualReels) {
      root.dataset.blockinstaSingleReel = "true";
    } else {
      delete root.dataset.blockinstaSingleReel;
    }
  }

  function pauseAndMuteVideos() {
    document.querySelectorAll("video").forEach((video) => {
      video.muted = true;
      try {
        video.pause();
      } catch {
        // A detached media element can reject pause; navigation still proceeds.
      }
    });
  }

  function exitInstagram(reason) {
    if (redirecting) {
      return;
    }
    redirecting = true;
    root.dataset.blockinstaLeaving = "true";
    pauseAndMuteVideos();
    const safeReason = reason === "next_reel"
      ? "next_reel"
      : "infinite_reels";
    const target = `${api.runtime.getURL("blocked/blocked.html")}?reason=${safeReason}`;
    window.location.assign(target);
  }

  function currentClassification() {
    return routesApi.classifyInstagramUrl(window.location.href);
  }

  function guardLocation() {
    if (redirecting) {
      return;
    }

    searchGuard.handleLocation();
    const feedResult = feedGuard.handleLocation();
    if (feedResult.routed) {
      return;
    }

    const classification = currentClassification();
    const decision = routesApi.decideNavigation(
      classification,
      allowedItemId,
      settings,
    );

    if (decision.action === "exit") {
      exitInstagram(decision.reason);
      return;
    }

    if (decision.action === "allow_one") {
      allowedItemId = decision.allowedItemId;
      pendingViewerUntil = 0;
      updateRootState(true);
    } else if (allowedItemId
      && (Date.now() < pendingViewerUntil || hasOpenReelDialog())) {
      updateRootState(true);
    } else {
      allowedItemId = null;
      pendingViewerUntil = 0;
      updateRootState(false);
    }

    lastHref = window.location.href;
    scheduleScan();
  }

  function elementFromEvent(event) {
    const path = typeof event.composedPath === "function"
      ? event.composedPath()
      : [];
    const candidate = path.find((entry) => entry instanceof Element);
    return candidate || (event.target instanceof Element ? event.target : null);
  }

  function anchorFromEvent(event) {
    const element = elementFromEvent(event);
    return element ? element.closest("a[href]") : null;
  }

  function reelContainerFor(element) {
    if (!element) {
      return null;
    }
    const container = element.closest("[role='dialog'], article");
    if (!container || !container.querySelector("video")) {
      return null;
    }
    return container.querySelector("a[href*='/reel/']") ? container : null;
  }

  function hasOpenReelDialog() {
    return [...document.querySelectorAll("[role='dialog']")].some(
      (dialog) => dialog.querySelector("video")
        && dialog.querySelector("a[href*='/reel/']"),
    );
  }

  function isInsideActiveViewer(element) {
    return currentClassification().surface === "reel_item"
      || Boolean(reelContainerFor(element))
      || hasOpenReelDialog();
  }

  function handleClick(event) {
    if (!settings.enabled) {
      return;
    }

    const anchor = anchorFromEvent(event);
    if (!anchor) {
      return;
    }

    const classification = routesApi.classifyInstagramUrl(
      anchor.href,
      window.location.href,
    );

    if (classification.policy === "block" && settings.blockReelsFeed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitInstagram(classification.reason);
      return;
    }

    if (classification.surface !== "reel_item"
      || !settings.limitIndividualReels) {
      return;
    }

    const element = elementFromEvent(event);
    const continuingInsideViewer = allowedItemId
      && isInsideActiveViewer(element);
    if (continuingInsideViewer && classification.itemId !== allowedItemId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitInstagram("next_reel");
      return;
    }

    allowedItemId = classification.itemId;
    pendingViewerUntil = Date.now() + PENDING_VIEWER_MS;
    updateRootState(true);
  }

  function isEditable(element) {
    return Boolean(element && element.closest(
      "input, textarea, select, button, [contenteditable='true'], [role='textbox']",
    ));
  }

  function isIndependentlyScrollable(element) {
    let current = element;
    while (current && current !== document.body && current !== root) {
      const style = window.getComputedStyle(current);
      const canScroll = /(auto|scroll)/.test(style.overflowY)
        && current.scrollHeight > current.clientHeight + 1;
      if (canScroll) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function shouldStopPaging(event) {
    if (!settings.enabled || !settings.limitIndividualReels || !allowedItemId) {
      return false;
    }
    const element = elementFromEvent(event);
    return isInsideActiveViewer(element)
      && !isEditable(element)
      && !isIndependentlyScrollable(element);
  }

  function stopPaging(event) {
    if (shouldStopPaging(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleKeydown(event) {
    if (BLOCKED_KEYS.has(event.key)) {
      stopPaging(event);
    }
  }

  function removeLinkMarker(anchor, name) {
    delete anchor.dataset[name];
    if (!anchor.dataset.blockinstaBlockedLink
      && !anchor.dataset.blockinstaDisallowedReel) {
      anchor.removeAttribute("aria-disabled");
      anchor.removeAttribute("tabindex");
    }
  }

  function markLink(anchor, name) {
    anchor.dataset[name] = "true";
    anchor.setAttribute("aria-disabled", "true");
    anchor.setAttribute("tabindex", "-1");
  }

  function scanDom() {
    scanScheduled = false;
    if (!protectionEnabled() || redirecting) {
      document.querySelectorAll(
        "[data-blockinsta-blocked-link], [data-blockinsta-disallowed-reel]",
      ).forEach((anchor) => {
        removeLinkMarker(anchor, "blockinstaBlockedLink");
        removeLinkMarker(anchor, "blockinstaDisallowedReel");
      });
      return;
    }

    for (const anchor of document.querySelectorAll("a[href]")) {
      const classification = routesApi.classifyInstagramUrl(
        anchor.href,
        window.location.href,
      );

      if (classification.policy === "block" && settings.blockReelsFeed) {
        markLink(anchor, "blockinstaBlockedLink");
      } else {
        removeLinkMarker(anchor, "blockinstaBlockedLink");
      }

      const isDifferentReel = allowedItemId
        && settings.limitIndividualReels
        && classification.surface === "reel_item"
        && classification.itemId !== allowedItemId;
      if (isDifferentReel) {
        markLink(anchor, "blockinstaDisallowedReel");
        const playingDifferentReel = [...anchor.querySelectorAll("video")]
          .some((video) => !video.paused && !video.ended);
        if (playingDifferentReel) {
          exitInstagram("next_reel");
          return;
        }
      } else {
        removeLinkMarker(anchor, "blockinstaDisallowedReel");
      }
    }
  }

  function scheduleScan() {
    if (scanScheduled || redirecting) {
      return;
    }
    scanScheduled = true;
    window.requestAnimationFrame(scanDom);
  }

  function handlePotentialNavigation() {
    window.setTimeout(guardLocation, 0);
  }

  function applySettings(candidate) {
    settings = settingsApi.normalizeSettings(candidate);
    updateRootState(Boolean(allowedItemId));
    searchGuard.updateSettings(settings);
    const feedResult = feedGuard.updateSettings(settings);
    if (feedResult.routed) {
      return;
    }
    guardLocation();
  }

  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("wheel", stopPaging, { capture: true, passive: false });
  document.addEventListener("touchmove", stopPaging, {
    capture: true,
    passive: false,
  });
  window.addEventListener("popstate", handlePotentialNavigation, true);
  window.addEventListener("hashchange", handlePotentialNavigation, true);
  window.addEventListener("pageshow", handlePotentialNavigation, true);

  if (window.navigation
    && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigate", (event) => {
      const classification = routesApi.classifyInstagramUrl(
        event.destination.url,
        window.location.href,
      );
      const decision = routesApi.decideNavigation(
        classification,
        allowedItemId,
        settings,
      );
      if (decision.action === "exit") {
        if (event.cancelable) {
          event.preventDefault();
        }
        exitInstagram(decision.reason);
        return;
      }
      handlePotentialNavigation();
    });
  }

  const observer = new MutationObserver((mutations) => {
    feedGuard.handleDocumentMutations(mutations);
    searchGuard.handleDocumentMutations(mutations);
    if (window.location.href !== lastHref) {
      guardLocation();
      return;
    }
    scheduleScan();
  });
  observer.observe(root, { childList: true, subtree: true });

  window.setInterval(() => {
    if (window.location.href !== lastHref || allowedItemId) {
      guardLocation();
    }
  }, LOCATION_CHECK_MS);

  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        applySettings(changes[STORAGE_KEY].newValue);
      }
    });
  }

  compat.storageGet([STORAGE_KEY]).then(
    (stored) => applySettings(stored && stored[STORAGE_KEY]),
    () => applySettings(settingsApi.DEFAULT_SETTINGS),
  );

  guardLocation();
})();
