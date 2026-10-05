(function initializeInstagramGuard() {
  "use strict";

  if (window.top !== window) {
    return;
  }

  const compat = globalThis.BlockInstaCompat;
  const settingsApi = globalThis.BlockInstaSettings;
  const settingsStorageApi = globalThis.BlockInstaSettingsStorage;
  const routesApi = globalThis.BlockInstaRoutes;
  const feedGuardApi = globalThis.BlockInstaFeedGuard;
  const searchGuardApi = globalThis.BlockInstaSearchGuard;
  const api = compat.api;
  const buildConfig = globalThis.BlockInstaBuild || {};
  const STORAGE_KEY = settingsStorageApi.STORAGE_KEY;
  const LOCATION_CHECK_MS = 250;
  const SETTINGS_CHECK_MS = 5000;
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
  let settingsReady = false;
  let settingsReadInFlight = null;
  let lastSettingsReadAt = 0;

  const feedGuard = feedGuardApi.createFeedGuard();
  const searchGuard = searchGuardApi.createSearchGuard();
  const settingsStore = settingsStorageApi.createSettingsStore(compat);

  const root = document.documentElement;
  root.dataset.blockinstaActive = "true";
  root.dataset.blockinstaBlockFeed = "true";
  if (routesApi.isBlockedCollectionRoute(window.location.href)) {
    root.dataset.blockinstaPendingReels = "true";
  }
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

  function createElement(name, attributes = {}, text = "") {
    const element = document.createElement(name);
    for (const [attribute, value] of Object.entries(attributes)) {
      element.setAttribute(attribute, value);
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  function renderInlineBlockedPage(reason) {
    window.stop();
    const isNextReel = reason === "next_reel";
    document.title = isNextReel
      ? "Reel continuation blocked - BlockInsta"
      : "Infinite Reels blocked - BlockInsta";
    root.lang = "en";
    root.dataset.blockinstaInlineBlocked = "true";
    delete root.dataset.blockinstaPendingReels;

    const head = createElement("head");
    head.append(
      createElement("meta", { charset: "utf-8" }),
      createElement("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      }),
      createElement("meta", {
        name: "color-scheme",
        content: "light dark",
      }),
      createElement("title", {}, document.title),
    );

    const body = createElement("body");
    const main = createElement("main", {
      class: "blockinsta-inline-page",
    });
    const card = createElement("section", {
      class: "blockinsta-inline-card",
      "aria-labelledby": "blockinsta-inline-title",
    });
    card.append(
      createElement("p", { class: "blockinsta-inline-eyebrow" }, "BlockInsta"),
      createElement(
        "h1",
        { id: "blockinsta-inline-title" },
        isNextReel ? "That is the end of this Reel" : "Infinite Reels are blocked",
      ),
      createElement(
        "p",
        { class: "blockinsta-inline-message" },
        isNextReel
          ? "You can watch one Reel you deliberately opened. Continuing would open another Reel, so BlockInsta stopped here."
          : "The endless Reels collection is unavailable. Messages, posts, profiles, and individual Reels remain available.",
      ),
    );

    const actions = createElement("div", {
      class: "blockinsta-inline-actions",
    });
    const back = createElement("button", { type: "button" }, "Go back");
    back.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      }
    });
    actions.append(
      back,
      createElement("a", {
        href: "https://www.instagram.com/direct/inbox/",
      }, "Open Messages"),
      createElement("a", {
        href: "https://www.instagram.com/",
      }, "Open Home"),
    );
    card.append(actions);
    main.append(
      card,
      createElement(
        "p",
        { class: "blockinsta-inline-scope" },
        "BlockInsta changes Instagram in this browser, not the Instagram app.",
      ),
    );
    body.append(main);
    root.replaceChildren(head, body);
    back.focus();
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
    const extensionPage = compat.runtimeGetURL("blocked/blocked.html");
    if (!buildConfig.preferInlineBlockedPage && extensionPage) {
      try {
        window.location.assign(`${extensionPage}?reason=${safeReason}`);
        return;
      } catch {
        // Fall through to a page rendered entirely by the content script.
      }
    }
    renderInlineBlockedPage(safeReason);
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

    if (decision.action === "exit" && !settingsReady) {
      root.dataset.blockinstaPendingReels = "true";
      return;
    }

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
    void refreshSettings(true);
    window.setTimeout(guardLocation, 0);
  }

  function applySettings(candidate) {
    settings = settingsApi.normalizeSettings(candidate);
    settingsReady = true;
    delete root.dataset.blockinstaPendingReels;
    updateRootState(Boolean(allowedItemId));
    searchGuard.updateSettings(settings);
    const feedResult = feedGuard.updateSettings(settings);
    if (feedResult.routed) {
      return;
    }
    guardLocation();
  }

  function refreshSettings(force = false) {
    const now = Date.now();
    if (settingsReadInFlight) {
      return settingsReadInFlight;
    }
    if (!force && now - lastSettingsReadAt < SETTINGS_CHECK_MS) {
      return Promise.resolve(settings);
    }
    lastSettingsReadAt = now;
    settingsReadInFlight = settingsStore.readNormalized().then(
      (stored) => {
        applySettings(stored);
        return settings;
      },
      () => {
        applySettings(settingsApi.DEFAULT_SETTINGS);
        return settings;
      },
    ).finally(() => {
      settingsReadInFlight = null;
    });
    return settingsReadInFlight;
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshSettings(true);
    }
  }, true);

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
      if (decision.action === "exit" && settingsReady) {
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
      handlePotentialNavigation();
      return;
    }
    scheduleScan();
  });
  observer.observe(root, { childList: true, subtree: true });

  window.setInterval(() => {
    if (window.location.href !== lastHref || allowedItemId) {
      guardLocation();
    }
    void refreshSettings();
  }, LOCATION_CHECK_MS);

  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        applySettings(changes[STORAGE_KEY].newValue);
      }
    });
  }

  void refreshSettings(true);

  guardLocation();
})();
