(function initializeSearchGuard(root, factory) {
  "use strict";

  root.BlockInstaSearchGuard = factory(root.BlockInstaSearchPolicy);
})(globalThis, function createSearchGuardApi(policy) {
  "use strict";

  const STARTUP_TIMEOUT_MS = 5000;
  const MIN_MEDIA_LINKS = 3;
  const SEARCH_LABELS = new Set([
    "buscar",
    "cerca",
    "recherche",
    "search",
    "suche",
    "pesquisar",
    "검색",
    "検索",
    "搜索",
  ]);

  function createSearchGuard(options = {}) {
    if (!policy) {
      throw new Error("BlockInsta search policy is unavailable.");
    }

    const win = options.window || window;
    const doc = options.document || document;
    const html = doc.documentElement;
    const view = doc.defaultView || globalThis;
    const ElementType = view.Element || globalThis.Element;
    const NodeType = view.Node || globalThis.Node;
    const MutationObserverType = view.MutationObserver
      || globalThis.MutationObserver;
    const requestFrame = options.requestAnimationFrame
      || (typeof win.requestAnimationFrame === "function"
        ? win.requestAnimationFrame.bind(win)
        : (callback) => win.setTimeout(callback, 0));
    const createObserver = options.createObserver
      || ((callback) => new MutationObserverType(callback));

    let settings = {
      enabled: false,
      hideSearchDiscovery: false,
    };
    let state = policy.STATES.INACTIVE;
    let mode = policy.MODES.OTHER;
    let routeKey = null;
    let surface = null;
    let scopedObserver = null;
    let searchInput = null;
    let composing = false;
    let scanScheduled = false;
    let fullScanNeeded = false;
    let startupTimer = null;
    let listening = false;
    let pendingRoots = new Set();
    const discoveryRoots = new Set();
    const loaderNodes = new Set();
    const layoutHosts = new Set();

    function isElement(value) {
      return Boolean(ElementType && value instanceof ElementType);
    }

    function normalizeText(value) {
      return String(value || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    }

    function currentRouteKey() {
      try {
        const url = new URL(win.location.href);
        return `${url.pathname}${url.search}`;
      } catch {
        return String(win.location && win.location.href || "");
      }
    }

    function routeMode() {
      return policy.getSearchMode(win.location.href);
    }

    function isLandingMode() {
      return mode === policy.MODES.EXPLORE_LANDING
        || mode === policy.MODES.SEARCH_LANDING;
    }

    function isExcluded(element) {
      return Boolean(element && element.closest(
        "[role='dialog'], [aria-modal='true'], "
        + "[data-blockinsta-feed-end], [data-blockinsta-feed-hidden], "
        + "[data-blockinsta-after-cutoff]",
      ));
    }

    function inputText(element) {
      return normalizeText(
        element.getAttribute("aria-label")
        || element.getAttribute("placeholder")
        || element.getAttribute("name"),
      );
    }

    function hasSearchLabel(element) {
      const label = inputText(element);
      return SEARCH_LABELS.has(label)
        || [...SEARCH_LABELS].some((word) => label.startsWith(`${word} `));
    }

    function isTextInput(element) {
      if (!isElement(element)) {
        return false;
      }
      if (element.matches("[contenteditable='true'][role='combobox']")) {
        return true;
      }
      if (!element.matches("input")) {
        return false;
      }
      const type = normalizeText(element.getAttribute("type") || "text");
      return type === "text" || type === "search" || type === "";
    }

    function isLikelySearchInput(element) {
      if (!isTextInput(element) || isExcluded(element)) {
        return false;
      }
      if (element.matches("input[type='search'], [role='searchbox']")) {
        return true;
      }
      if (element.getAttribute("role") === "combobox"
        && (element.hasAttribute("aria-controls")
          || element.hasAttribute("aria-owns")
          || element.hasAttribute("aria-autocomplete"))) {
        return true;
      }
      if (element.closest("[role='search']")) {
        return true;
      }
      return isLandingMode() && hasSearchLabel(element);
    }

    function collectInputs(scope = doc) {
      const inputs = [];
      if (isElement(scope) && isLikelySearchInput(scope)) {
        inputs.push(scope);
      }
      if (scope && typeof scope.querySelectorAll === "function") {
        const candidates = scope.querySelectorAll(
          "input[type='search'], input[role='searchbox'], "
          + "input[role='combobox'], [role='search'] input, "
          + "[contenteditable='true'][role='combobox'], input[type='text'], "
          + "input:not([type])",
        );
        for (const candidate of candidates) {
          if (isLikelySearchInput(candidate)) {
            inputs.push(candidate);
          }
        }
      }
      return [...new Set(inputs)];
    }

    function findSearchInput(scope = doc) {
      if (searchInput && searchInput.isConnected
        && (!surface || surface.contains(searchInput))) {
        return searchInput;
      }
      searchInput = collectInputs(scope)[0] || collectInputs(doc)[0] || null;
      return searchInput;
    }

    function findSearchPanel() {
      for (const region of doc.querySelectorAll?.("[role='search']") || []) {
        const input = collectInputs(region)[0];
        if (!input || region.closest("nav, [role='navigation']")) {
          continue;
        }
        const candidate = region.closest("aside, [role='complementary']");
        if (candidate && !isExcluded(candidate)) {
          return candidate;
        }
      }
      return null;
    }

    function findSurface() {
      if (mode === policy.MODES.SEARCH_PANEL) {
        return findSearchPanel();
      }
      const candidate = doc.querySelector?.("main, [role='main']");
      return candidate && !isExcluded(candidate) ? candidate : null;
    }

    function referencedResultOwners() {
      const owners = new Set();
      const input = findSearchInput(surface || doc);
      if (!input) {
        return owners;
      }
      const ids = [
        input.getAttribute("aria-controls"),
        input.getAttribute("aria-owns"),
      ].filter(Boolean).flatMap((value) => value.split(/\s+/));
      for (const id of ids) {
        const owner = doc.getElementById(id);
        if (owner) {
          owners.add(owner);
        }
      }
      if (surface) {
        for (const owner of surface.querySelectorAll("[role='listbox']")) {
          owners.add(owner);
        }
      }
      return owners;
    }

    function controlledOwners() {
      const owners = referencedResultOwners();
      if (surface) {
        for (const owner of surface.querySelectorAll(
          "[role='status'], [role='alert'], [aria-live]",
        )) {
          owners.add(owner);
        }
      }
      return owners;
    }

    function isSearchControlled(element, owners = controlledOwners()) {
      if (!element) {
        return false;
      }
      if (element.matches?.(
        "[role='listbox'], [role='option'], [role='status'], "
        + "[role='alert'], [aria-live]",
      ) || element.closest?.(
        "[role='listbox'], [role='option'], [role='status'], "
        + "[role='alert'], [aria-live]",
      )) {
        return true;
      }
      return [...owners].some((owner) => owner === element
        || owner.contains(element)
        || element.contains(owner));
    }

    function queryIsActive() {
      const input = findSearchInput(surface || doc);
      return Boolean(input && normalizeText(input.value || input.textContent));
    }

    function ownerIsVisible(owner) {
      if (!owner || owner.hidden || owner.getAttribute("aria-hidden") === "true") {
        return false;
      }
      if (typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(owner);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
      }
      return true;
    }

    function searchIsActive() {
      const input = findSearchInput(surface || doc);
      const owners = controlledOwners();
      return policy.isSearchActive({
        composing,
        inputFocused: Boolean(input && doc.activeElement === input),
        queryActive: queryIsActive(),
        searchOwnerVisible: [...owners].some(ownerIsVisible),
      });
    }

    function mediaIdentity(anchor) {
      let url;
      try {
        url = new URL(anchor.href || anchor.getAttribute("href"), win.location.href);
      } catch {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      if (hostname !== "instagram.com" && !hostname.endsWith(".instagram.com")) {
        return null;
      }
      const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/i);
      return match ? `${match[1].toLowerCase()}:${match[2]}` : null;
    }

    function mediaAnchors(scope) {
      if (!scope || typeof scope.querySelectorAll !== "function") {
        return [];
      }
      const owners = controlledOwners();
      const anchors = [];
      if (isElement(scope) && scope.matches("a[href]")) {
        anchors.push(scope);
      }
      anchors.push(...scope.querySelectorAll("a[href]"));
      const identities = new Set();
      return anchors.filter((anchor) => {
        const identity = mediaIdentity(anchor);
        if (!identity || identities.has(identity)
          || isExcluded(anchor)
          || isSearchControlled(anchor, owners)) {
          return false;
        }
        identities.add(identity);
        return true;
      });
    }

    function forbiddenDiscoveryRoot(element, owners) {
      if (!element || element === surface || element === doc.body || element === html
        || isExcluded(element) || element.contains(findSearchInput(surface || doc))) {
        return true;
      }
      if (element.matches(
        "form, nav, [role='navigation'], [role='search'], [role='listbox'], "
        + "[role='status'], [role='alert'], [aria-live]",
      )) {
        return true;
      }
      return isSearchControlled(element, owners);
    }

    function distanceFromSurface(element) {
      let distance = 0;
      let current = element;
      while (current && current !== surface) {
        distance += 1;
        current = current.parentElement;
      }
      return current === surface ? distance : Number.MAX_SAFE_INTEGER;
    }

    function findDiscoveryCandidate(scope = surface) {
      if (!surface || !scope || queryIsActive() || composing) {
        return null;
      }
      const anchors = mediaAnchors(scope);
      if (anchors.length < MIN_MEDIA_LINKS) {
        return null;
      }

      const owners = controlledOwners();
      const counts = new Map();
      const candidates = new Set();
      for (const anchor of anchors) {
        let current = anchor.parentElement;
        while (current && current !== surface && surface.contains(current)) {
          candidates.add(current);
          counts.set(current, (counts.get(current) || 0) + 1);
          current = current.parentElement;
        }
      }

      let best = null;
      let bestCount = 0;
      let bestDistance = Number.MAX_SAFE_INTEGER;
      for (const candidate of candidates) {
        if (forbiddenDiscoveryRoot(candidate, owners)) {
          continue;
        }
        const count = counts.get(candidate) || 0;
        if (count < MIN_MEDIA_LINKS) {
          continue;
        }
        const distance = distanceFromSurface(candidate);
        if (count > bestCount || (count === bestCount && distance < bestDistance)) {
          best = candidate;
          bestCount = count;
          bestDistance = distance;
        }
      }
      if (!best) {
        return null;
      }

      const result = policy.classifyObservation({
        eligible: true,
        discoveryGrid: true,
        mediaLinkCount: bestCount,
        signalCount: (isLandingMode() || mode === policy.MODES.SEARCH_PANEL ? 1 : 0)
          + (bestCount >= MIN_MEDIA_LINKS ? 1 : 0)
          + (best.matches("[role='grid']") ? 1 : 0),
      });
      return result.action === "hide" ? best : null;
    }

    function nodeIsAfter(reference, candidate) {
      return Boolean(reference && candidate && reference !== candidate
        && NodeType
        && (reference.compareDocumentPosition(candidate)
          & NodeType.DOCUMENT_POSITION_FOLLOWING));
    }

    function markLoader(loader) {
      const result = policy.classifyObservation({
        eligible: true,
        discoveryLoader: true,
        discoveryOwned: true,
      });
      if (result.action !== "hide" || isExcluded(loader)
        || isSearchControlled(loader)) {
        return;
      }
      loader.dataset.blockinstaSearchLoader = "true";
      loaderNodes.add(loader);
    }

    function markOwnedLoaders(root) {
      for (const loader of root.querySelectorAll(
        "[role='progressbar'], [aria-busy='true']",
      )) {
        markLoader(loader);
      }
      const parent = root.parentElement;
      if (!parent) {
        return;
      }
      for (const loader of parent.querySelectorAll(
        ":scope > [role='progressbar'], :scope > [aria-busy='true']",
      )) {
        if (nodeIsAfter(root, loader)) {
          markLoader(loader);
        }
      }
    }

    function markLayoutHosts(root) {
      const input = findSearchInput(surface || doc);
      let current = root && root.parentElement;
      while (current && input) {
        if (current.contains(input)
          && typeof view.getComputedStyle === "function") {
          const style = view.getComputedStyle(current);
          if (style.display === "flex" || style.display === "inline-flex") {
            const isColumn = style.flexDirection.startsWith("column");
            const verticalAlignment = isColumn
              ? style.justifyContent
              : style.alignItems;
            if (verticalAlignment !== "flex-start"
              && verticalAlignment !== "normal"
              && verticalAlignment !== "stretch") {
              current.dataset.blockinstaSearchTopAlign = isColumn
                ? "flex-column"
                : "flex-row";
              layoutHosts.add(current);
            }
          } else if (style.display === "grid"
            || style.display === "inline-grid") {
            if (style.alignContent !== "start"
              && style.alignContent !== "normal"
              && style.alignContent !== "stretch") {
              current.dataset.blockinstaSearchTopAlign = "grid";
              layoutHosts.add(current);
            }
          }
        }
        if (current === surface) {
          break;
        }
        current = current.parentElement;
      }
    }

    function markDiscovery(root, provisional = false) {
      if (!root || forbiddenDiscoveryRoot(root, controlledOwners())) {
        return false;
      }
      root.dataset.blockinstaSearchDiscovery = "true";
      if (provisional) {
        root.dataset.blockinstaSearchProvisional = "true";
      } else {
        delete root.dataset.blockinstaSearchProvisional;
      }
      discoveryRoots.add(root);
      markOwnedLoaders(root);
      markLayoutHosts(root);
      state = policy.nextState(state, "hide");
      html.dataset.blockinstaSearchState = state;
      return true;
    }

    function clearDiscoveryMarker(element) {
      if (!element) {
        return;
      }
      delete element.dataset.blockinstaSearchDiscovery;
      delete element.dataset.blockinstaSearchProvisional;
      discoveryRoots.delete(element);
    }

    function clearLoaderMarker(element) {
      if (!element) {
        return;
      }
      delete element.dataset.blockinstaSearchLoader;
      loaderNodes.delete(element);
    }

    function clearLayoutMarkers() {
      for (const element of doc.querySelectorAll(
        "[data-blockinsta-search-top-align]",
      )) {
        delete element.dataset.blockinstaSearchTopAlign;
      }
      layoutHosts.clear();
    }

    function clearStartupTimer() {
      if (startupTimer !== null) {
        win.clearTimeout(startupTimer);
        startupTimer = null;
      }
    }

    function removeListeners() {
      if (!listening) {
        return;
      }
      for (const eventName of [
        "beforeinput",
        "change",
        "focusin",
        "focusout",
        "input",
        "reset",
        "submit",
      ]) {
        doc.removeEventListener(eventName, handleSearchEvent, true);
      }
      doc.removeEventListener("compositionstart", handleCompositionStart, true);
      doc.removeEventListener("compositionend", handleCompositionEnd, true);
      listening = false;
    }

    function clearOwnedMarkup() {
      if (scopedObserver) {
        scopedObserver.disconnect();
        scopedObserver = null;
      }
      for (const root of doc.querySelectorAll(
        "[data-blockinsta-search-discovery], [data-blockinsta-search-provisional]",
      )) {
        clearDiscoveryMarker(root);
      }
      for (const loader of doc.querySelectorAll(
        "[data-blockinsta-search-loader]",
      )) {
        clearLoaderMarker(loader);
      }
      discoveryRoots.clear();
      loaderNodes.clear();
      clearLayoutMarkers();
      surface = null;
      searchInput = null;
      pendingRoots = new Set();
      delete html.dataset.blockinstaHideSearchDiscovery;
      delete html.dataset.blockinstaSearchState;
    }

    function deactivate() {
      clearStartupTimer();
      removeListeners();
      clearOwnedMarkup();
      state = policy.nextState(state, "deactivate");
      mode = policy.MODES.OTHER;
      routeKey = null;
      composing = false;
      scanScheduled = false;
      fullScanNeeded = false;
    }

    function handleSearchEvent(event) {
      const target = isElement(event.target) ? event.target : null;
      if (!target || (!isLikelySearchInput(target)
        && !(surface && surface.contains(target)))) {
        return;
      }
      if (isLikelySearchInput(target)) {
        searchInput = target;
      }
      fullScanNeeded = true;
      scheduleScan(target);
    }

    function handleCompositionStart(event) {
      if (isLikelySearchInput(event.target)) {
        searchInput = event.target;
        composing = true;
        fullScanNeeded = true;
        scheduleScan(event.target);
      }
    }

    function handleCompositionEnd(event) {
      if (isLikelySearchInput(event.target)) {
        searchInput = event.target;
        composing = false;
        fullScanNeeded = true;
        scheduleScan(event.target);
      }
    }

    function addListeners() {
      if (listening) {
        return;
      }
      for (const eventName of [
        "beforeinput",
        "change",
        "focusin",
        "focusout",
        "input",
        "reset",
        "submit",
      ]) {
        doc.addEventListener(eventName, handleSearchEvent, true);
      }
      doc.addEventListener("compositionstart", handleCompositionStart, true);
      doc.addEventListener("compositionend", handleCompositionEnd, true);
      listening = true;
    }

    function handleScopedMutations(mutations) {
      processMutations(mutations);
    }

    function attachScopedObserver(candidate) {
      if (!candidate || candidate === surface) {
        return;
      }
      if (scopedObserver) {
        scopedObserver.disconnect();
      }
      surface = candidate;
      searchInput = null;
      scopedObserver = createObserver(handleScopedMutations);
      scopedObserver.observe(surface, { childList: true, subtree: true });
      fullScanNeeded = true;
    }

    function ensureSurface() {
      if (surface && surface.isConnected) {
        return true;
      }
      const candidate = findSurface();
      if (!candidate) {
        return false;
      }
      attachScopedObserver(candidate);
      return true;
    }

    function activate(nextMode) {
      clearStartupTimer();
      removeListeners();
      clearOwnedMarkup();
      mode = nextMode;
      routeKey = currentRouteKey();
      state = policy.nextState(state, "locate");
      html.dataset.blockinstaHideSearchDiscovery = "true";
      html.dataset.blockinstaSearchState = state;
      addListeners();
      ensureSurface();
      startupTimer = win.setTimeout(() => {
        startupTimer = null;
        if (state === policy.STATES.LOCATING) {
          state = policy.nextState(state, "ambiguous");
          html.dataset.blockinstaSearchState = state;
        }
      }, STARTUP_TIMEOUT_MS);
      scheduleScan();
    }

    function pruneMarkers() {
      const owners = controlledOwners();
      for (const root of [...discoveryRoots]) {
        if (!root.isConnected) {
          discoveryRoots.delete(root);
          continue;
        }
        if (root.contains(findSearchInput(surface || doc))
          || isSearchControlled(root, owners)) {
          clearDiscoveryMarker(root);
        } else {
          markOwnedLoaders(root);
        }
      }
      for (const loader of [...loaderNodes]) {
        if (!loader.isConnected || isSearchControlled(loader, owners)) {
          clearLoaderMarker(loader);
        }
      }
    }

    function releaseReusedDiscoveryForActiveQuery() {
      if (!queryIsActive() && !composing) {
        return;
      }
      const visibleOwners = [...referencedResultOwners()].filter(ownerIsVisible);
      const hasSeparateResultOwner = visibleOwners.some((owner) => (
        ![...discoveryRoots].some((root) => root === owner
          || root.contains(owner)
          || owner.contains(root))
      ));
      if (hasSeparateResultOwner) {
        return;
      }
      for (const root of [...discoveryRoots]) {
        clearDiscoveryMarker(root);
      }
      for (const loader of [...loaderNodes]) {
        clearLoaderMarker(loader);
      }
    }

    function runScan() {
      scanScheduled = false;
      if (state === policy.STATES.INACTIVE || !ensureSurface()) {
        return;
      }
      findSearchInput(surface);
      releaseReusedDiscoveryForActiveQuery();
      pruneMarkers();

      const active = searchIsActive();
      if (!queryIsActive() && !composing) {
        const scopes = fullScanNeeded || pendingRoots.size === 0
          ? [surface]
          : [...pendingRoots].filter((element) => element.isConnected);
        for (const scope of scopes) {
          const candidate = findDiscoveryCandidate(scope);
          if (candidate) {
            markDiscovery(candidate);
          }
        }
      }
      fullScanNeeded = false;
      pendingRoots.clear();

      if (active) {
        state = policy.nextState(state, "search");
      } else if (discoveryRoots.size > 0) {
        state = policy.nextState(state, "hide");
        clearStartupTimer();
      } else if (state !== policy.STATES.AMBIGUOUS) {
        state = policy.nextState(state, "locate");
      }
      html.dataset.blockinstaSearchState = state;
    }

    function scheduleScan(rootNode) {
      if (isElement(rootNode)) {
        pendingRoots.add(rootNode);
      }
      if (scanScheduled || state === policy.STATES.INACTIVE) {
        return;
      }
      scanScheduled = true;
      requestFrame(runScan);
    }

    function fastMarkAdded(element) {
      if (!surface || queryIsActive() || composing || isExcluded(element)) {
        return;
      }
      const candidate = findDiscoveryCandidate(element);
      if (candidate) {
        markDiscovery(candidate, true);
      }
    }

    function containsSearchSemantic(element) {
      return Boolean(isLikelySearchInput(element)
        || element.querySelector?.(
          "[role='search'], input[type='search'], input[role='searchbox'], "
          + "input[role='combobox']",
        ));
    }

    function processMutations(mutations) {
      if (state === policy.STATES.INACTIVE) {
        return;
      }
      if (!surface || !surface.isConnected) {
        surface = null;
        ensureSurface();
        fullScanNeeded = true;
      }
      for (const mutation of mutations || []) {
        const target = isElement(mutation.target) ? mutation.target : null;
        const hiddenRoot = target && target.closest(
          "[data-blockinsta-search-discovery]",
        );
        if (hiddenRoot && (queryIsActive() || composing)) {
          clearDiscoveryMarker(hiddenRoot);
          for (const loader of [...loaderNodes]) {
            clearLoaderMarker(loader);
          }
        }
        for (const node of mutation.addedNodes || []) {
          const element = isElement(node) ? node : node.parentElement;
          if (!element) {
            continue;
          }
          if (surface && surface.contains(element)) {
            fastMarkAdded(element);
            pendingRoots.add(element);
          }
        }
      }
      scheduleScan();
    }

    function handleLocation() {
      const panel = findSearchPanel();
      const decision = policy.decideSearchRoute(
        win.location.href,
        settings,
        Boolean(panel),
      );
      if (decision.action === "ignore") {
        if (state !== policy.STATES.INACTIVE) {
          deactivate();
        }
        return Object.freeze({ active: false, mode: decision.mode });
      }

      const nextKey = currentRouteKey();
      if (state === policy.STATES.INACTIVE
        || mode !== decision.mode
        || routeKey !== nextKey) {
        activate(decision.mode);
      } else {
        ensureSurface();
        scheduleScan();
      }
      return Object.freeze({ active: true, mode: decision.mode });
    }

    function updateSettings(candidate) {
      settings = candidate || settings;
      return handleLocation();
    }

    function handleDocumentMutations(mutations) {
      if (state === policy.STATES.INACTIVE) {
        if (settings.enabled && settings.hideSearchDiscovery) {
          const hasPanelCandidate = (mutations || []).some((mutation) => [
            ...mutation.addedNodes,
          ].some((node) => {
            const element = isElement(node) ? node : node.parentElement;
            return element && containsSearchSemantic(element);
          }));
          if (hasPanelCandidate) {
            handleLocation();
          }
        }
        return;
      }
      processMutations(mutations);
    }

    function getState() {
      return Object.freeze({
        discoveryCount: [...discoveryRoots].filter(
          (element) => element.isConnected,
        ).length,
        loaderCount: [...loaderNodes].filter(
          (element) => element.isConnected,
        ).length,
        mode,
        state,
      });
    }

    return Object.freeze({
      destroy: deactivate,
      getState,
      handleDocumentMutations,
      handleLocation,
      updateSettings,
    });
  }

  return Object.freeze({ createSearchGuard });
});

