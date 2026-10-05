(function initializeSearchPolicy(root, factory) {
  "use strict";

  const searchPolicy = factory();
  root.BlockInstaSearchPolicy = searchPolicy;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = searchPolicy;
  }
})(globalThis, function createSearchPolicy() {
  "use strict";

  const STATES = Object.freeze({
    INACTIVE: "inactive",
    LOCATING: "locating",
    DISCOVERY_HIDDEN: "discovery_hidden",
    SEARCH_ACTIVE: "search_active",
    AMBIGUOUS: "ambiguous",
  });

  const MODES = Object.freeze({
    OTHER: "other",
    EXPLORE_LANDING: "explore_landing",
    SEARCH_LANDING: "search_landing",
    SEARCH_RESULTS: "search_results",
    SEARCH_PANEL: "search_panel",
  });

  function isInstagramHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "instagram.com"
      || normalized.endsWith(".instagram.com");
  }

  function normalizedPathname(value) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
    const path = `/${String(decoded || "").replace(/^\/+|\/+$/g, "")}`
      .replace(/\/{2,}/g, "/")
      .toLowerCase();
    return path === "/" ? path : path.replace(/\/+$/g, "");
  }

  function getSearchMode(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return MODES.OTHER;
    }
    if (!isInstagramHostname(url.hostname)) {
      return MODES.OTHER;
    }

    const path = normalizedPathname(url.pathname);
    if (path === "/explore") {
      return MODES.EXPLORE_LANDING;
    }
    if (path === "/explore/search") {
      return MODES.SEARCH_LANDING;
    }
    if (path.startsWith("/explore/search/")) {
      return MODES.SEARCH_RESULTS;
    }
    return MODES.OTHER;
  }

  function decideSearchRoute(value, candidateSettings, panelVisible = false) {
    const settings = candidateSettings || {};
    const routeMode = getSearchMode(value);
    if (!settings.enabled || !settings.hideSearchDiscovery) {
      return Object.freeze({ action: "ignore", mode: routeMode });
    }
    if (routeMode === MODES.EXPLORE_LANDING
      || routeMode === MODES.SEARCH_LANDING) {
      return Object.freeze({ action: "observe", mode: routeMode });
    }
    if (panelVisible) {
      return Object.freeze({ action: "observe", mode: MODES.SEARCH_PANEL });
    }
    return Object.freeze({ action: "ignore", mode: routeMode });
  }

  function classifyObservation(candidate) {
    const observation = candidate || {};
    if (!observation.eligible
      || observation.inDialog
      || observation.otherFeatureOwned) {
      return Object.freeze({ action: "ignore", reason: null });
    }
    if (observation.systemState) {
      return Object.freeze({ action: "keep", reason: "system_state" });
    }
    if (observation.searchControlled) {
      return Object.freeze({ action: "keep", reason: "search_owned" });
    }
    if (observation.queryActive
      || observation.composing
      || observation.resultRoute) {
      return Object.freeze({ action: "keep", reason: "search_active" });
    }
    if (observation.discoveryLoader) {
      return observation.discoveryOwned
        ? Object.freeze({ action: "hide", reason: "discovery_loader" })
        : Object.freeze({ action: "ambiguous", reason: "unowned_loader" });
    }
    if (observation.discoveryGrid) {
      const signalCount = Math.max(0, Number(observation.signalCount) || 0);
      const mediaLinkCount = Math.max(
        0,
        Number(observation.mediaLinkCount) || 0,
      );
      if (signalCount >= 2 && mediaLinkCount >= 3) {
        return Object.freeze({ action: "hide", reason: "idle_discovery" });
      }
      return Object.freeze({ action: "ambiguous", reason: "weak_grid" });
    }
    return Object.freeze({ action: "ambiguous", reason: "no_candidate" });
  }

  function isSearchActive(candidate) {
    const observation = candidate || {};
    return Boolean(observation.composing
      || observation.inputFocused
      || observation.queryActive
      || observation.searchOwnerVisible);
  }

  function nextState(currentState, eventName) {
    if (eventName === "deactivate") {
      return STATES.INACTIVE;
    }
    if (eventName === "locate") {
      return STATES.LOCATING;
    }
    if (eventName === "hide") {
      return STATES.DISCOVERY_HIDDEN;
    }
    if (eventName === "search") {
      return STATES.SEARCH_ACTIVE;
    }
    if (eventName === "ambiguous") {
      return STATES.AMBIGUOUS;
    }
    return currentState;
  }

  return Object.freeze({
    STATES,
    MODES,
    getSearchMode,
    decideSearchRoute,
    classifyObservation,
    isSearchActive,
    nextState,
  });
});

