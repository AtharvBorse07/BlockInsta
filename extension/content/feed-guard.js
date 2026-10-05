(function initializeFeedGuard(root, factory) {
  "use strict";

  root.BlockInstaFeedGuard = factory(root.BlockInstaFeedPolicy);
})(globalThis, function createFeedGuardApi(policy) {
  "use strict";

  const ROUTE_ATTEMPT_KEY = "blockinstaFollowingRouteAttempt";
  const ROUTE_ATTEMPT_WINDOW_MS = 15_000;
  const STARTUP_TIMEOUT_MS = 12_000;
  const VIEWED_RATIO = 0.5;
  const VIEWED_DWELL_MS = 500;
  const DEBUG = false;

  function createFeedGuard(options = {}) {
    if (!policy) {
      throw new Error("BlockInsta feed policy is unavailable.");
    }

    const win = options.window || window;
    const doc = options.document || document;
    const html = doc.documentElement;
    const requestFrame = options.requestAnimationFrame
      || win.requestAnimationFrame.bind(win);
    const createObserver = options.createObserver
      || ((callback) => new MutationObserver(callback));
    const IntersectionObserverType = options.IntersectionObserver
      || win.IntersectionObserver
      || doc.defaultView?.IntersectionObserver
      || globalThis.IntersectionObserver;
    const createViewObserver = options.createViewObserver
      || (IntersectionObserverType
        ? ((callback, observerOptions) => new IntersectionObserverType(
          callback,
          observerOptions,
        ))
        : null);
    const viewedDwellMs = Math.max(
      0,
      Number.isFinite(options.viewedDwellMs)
        ? options.viewedDwellMs
        : VIEWED_DWELL_MS,
    );

    let settings = {
      enabled: false,
      limitHomeFeed: false,
      preferFollowingFeed: false,
    };
    let state = policy.STATES.INACTIVE;
    let mode = "other";
    let routeKey = null;
    let attemptedThisDocument = false;
    let feedContainer = null;
    let feedColumn = null;
    let feedObserver = null;
    let scanScheduled = false;
    let fullScanNeeded = false;
    let startupTimer = null;
    let acceptedCount = 0;
    let cutoffReason = null;
    let cutoffAnchor = null;
    let cutoffPlacement = null;
    let cutoffHost = null;
    let endCard = null;
    let unavailableCard = null;
    let pendingRoots = new Set();
    let acceptedIds = new Set();
    let articleRecords = new WeakMap();
    let viewObserver = null;
    let viewStates = new WeakMap();
    let observedArticles = new Set();

    function debug(code) {
      if (DEBUG) {
        console.debug("[BlockInsta feed]", code);
      }
    }

    function readRouteAttempt() {
      try {
        const attemptedAt = Number(win.sessionStorage.getItem(ROUTE_ATTEMPT_KEY));
        return Number.isFinite(attemptedAt)
          && Date.now() - attemptedAt < ROUTE_ATTEMPT_WINDOW_MS;
      } catch {
        return false;
      }
    }

    function writeRouteAttempt() {
      try {
        win.sessionStorage.setItem(ROUTE_ATTEMPT_KEY, String(Date.now()));
      } catch {
        // Routing still works when site storage is unavailable.
      }
    }

    function clearRouteAttempt() {
      try {
        win.sessionStorage.removeItem(ROUTE_ATTEMPT_KEY);
      } catch {
        // No cleanup is required when site storage is unavailable.
      }
    }

    function currentRouteKey() {
      try {
        const url = new URL(win.location.href);
        return `${url.pathname}${url.search}`;
      } catch {
        return win.location.href;
      }
    }

    function isExcluded(element) {
      return Boolean(element && element.closest(
        "[role='dialog'], [aria-modal='true'], aside, [role='complementary']",
      ));
    }

    function isFeedArticle(element) {
      return Boolean(element
        && element.matches("article")
        && feedContainer
        && feedContainer.contains(element)
        && (!feedColumn || feedColumn.contains(element))
        && !isExcluded(element));
    }

    function clearClassification(element) {
      delete element.dataset.blockinstaFeedHidden;
      delete element.dataset.blockinstaAfterCutoff;
      delete element.dataset.blockinstaFeedClassified;
      delete element.dataset.blockinstaFeedAccepted;
      delete element.dataset.blockinstaPostId;
      element.removeAttribute("aria-hidden");
    }

    function clearOwnedMarkup() {
      if (feedObserver) {
        feedObserver.disconnect();
        feedObserver = null;
      }
      clearViewTracking();
      if (feedColumn) {
        delete feedColumn.dataset.blockinstaFeedColumn;
        feedColumn = null;
      }
      doc.querySelectorAll("[data-blockinsta-cutoff-host]").forEach((element) => {
        delete element.dataset.blockinstaCutoffHost;
      });
      cutoffHost = null;
      feedContainer = null;
      doc.querySelectorAll(
        "[data-blockinsta-feed-hidden], [data-blockinsta-after-cutoff], [data-blockinsta-feed-classified], [data-blockinsta-feed-accepted], [data-blockinsta-post-id]",
      ).forEach(clearClassification);
      doc.querySelectorAll("[data-blockinsta-disabled-control]").forEach((control) => {
        const previousAriaDisabled = control.dataset.blockinstaPreviousAriaDisabled;
        const previousTabindex = control.dataset.blockinstaPreviousTabindex;
        if (previousAriaDisabled === "__missing__") {
          control.removeAttribute("aria-disabled");
        } else {
          control.setAttribute("aria-disabled", previousAriaDisabled);
        }
        if (previousTabindex === "__missing__") {
          control.removeAttribute("tabindex");
        } else {
          control.setAttribute("tabindex", previousTabindex);
        }
        delete control.dataset.blockinstaDisabledControl;
        delete control.dataset.blockinstaPreviousAriaDisabled;
        delete control.dataset.blockinstaPreviousTabindex;
      });
      if (endCard) {
        endCard.remove();
        endCard = null;
      }
      if (unavailableCard) {
        unavailableCard.remove();
        unavailableCard = null;
      }
      delete html.dataset.blockinstaLimitHome;
      delete html.dataset.blockinstaFeedState;
    }

    function clearStartupTimer() {
      if (startupTimer !== null) {
        win.clearTimeout(startupTimer);
        startupTimer = null;
      }
    }

    function cancelViewDwell(article, unobserve = false) {
      const viewState = viewStates.get(article);
      if (viewState?.timer !== null && viewState?.timer !== undefined) {
        win.clearTimeout(viewState.timer);
      }
      if (viewState) {
        viewState.timer = null;
        viewState.visible = false;
      }
      if (unobserve && observedArticles.has(article)) {
        viewObserver?.unobserve(article);
        observedArticles.delete(article);
        viewStates.delete(article);
      }
    }

    function clearViewTracking() {
      for (const article of observedArticles) {
        cancelViewDwell(article);
      }
      viewObserver?.disconnect();
      viewObserver = null;
      observedArticles.clear();
    }

    function scheduleViewedArticle(article) {
      if (state !== policy.STATES.SEEKING_BOUNDARY
        || !isFeedArticle(article)
        || article.dataset.blockinstaFeedHidden
        || article.dataset.blockinstaAfterCutoff) {
        return;
      }
      let viewState = viewStates.get(article);
      if (!viewState) {
        viewState = { timer: null, visible: true };
        viewStates.set(article, viewState);
      }
      viewState.visible = true;
      if (viewState.timer !== null) {
        return;
      }
      const finish = () => {
        viewState.timer = null;
        if (!viewState.visible
          || state !== policy.STATES.SEEKING_BOUNDARY
          || !article.isConnected
          || !isFeedArticle(article)) {
          return;
        }
        recordViewedArticle(article);
      };
      if (viewedDwellMs === 0) {
        finish();
      } else {
        viewState.timer = win.setTimeout(finish, viewedDwellMs);
      }
    }

    function handleViewEntries(entries) {
      for (const entry of entries) {
        const article = entry.target;
        if (!observedArticles.has(article)) {
          continue;
        }
        const box = entry.boundingClientRect;
        const visibleBox = entry.intersectionRect;
        const rootBox = entry.rootBounds;
        const normalizedRatio = box && visibleBox && rootBox
          ? (visibleBox.width * visibleBox.height) / (
            Math.min(box.width, rootBox.width) * Math.min(box.height, rootBox.height)
          )
          : entry.intersectionRatio;
        if (entry.isIntersecting && normalizedRatio >= VIEWED_RATIO) {
          scheduleViewedArticle(article);
        } else {
          cancelViewDwell(article);
        }
      }
    }

    function ensureViewObserver() {
      if (!viewObserver && createViewObserver) {
        viewObserver = createViewObserver(handleViewEntries, {
          threshold: Array.from({ length: 11 }, (_, index) => index / 10),
        });
      }
      return viewObserver;
    }

    function isMeaningfullyVisible(article) {
      const box = article.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        return false;
      }
      const viewportWidth = win.innerWidth
        || doc.defaultView?.innerWidth
        || doc.documentElement.clientWidth;
      const viewportHeight = win.innerHeight
        || doc.defaultView?.innerHeight
        || doc.documentElement.clientHeight;
      const visibleWidth = Math.max(
        0,
        Math.min(box.right, viewportWidth) - Math.max(box.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(box.bottom, viewportHeight) - Math.max(box.top, 0),
      );
      const relevantWidth = Math.min(box.width, viewportWidth);
      const relevantHeight = Math.min(box.height, viewportHeight);
      return (visibleWidth * visibleHeight) / (relevantWidth * relevantHeight)
        >= VIEWED_RATIO;
    }

    function observeArticle(article) {
      if (state !== policy.STATES.SEEKING_BOUNDARY
        || observedArticles.has(article)) {
        return;
      }
      observedArticles.add(article);
      viewStates.set(article, { timer: null, visible: false });
      const observer = ensureViewObserver();
      if (observer) {
        observer.observe(article);
      } else if (isMeaningfullyVisible(article)) {
        scheduleViewedArticle(article);
      }
    }

    function stopObservingTree(scope) {
      for (const article of collectArticles(scope)) {
        cancelViewDwell(article, true);
      }
    }

    function resetSession() {
      clearStartupTimer();
      clearOwnedMarkup();
      acceptedCount = 0;
      cutoffReason = null;
      cutoffAnchor = null;
      cutoffPlacement = null;
      pendingRoots = new Set();
      acceptedIds = new Set();
      articleRecords = new WeakMap();
      viewStates = new WeakMap();
      observedArticles = new Set();
      state = policy.STATES.SEEKING_BOUNDARY;
      html.dataset.blockinstaLimitHome = "true";
      html.dataset.blockinstaFeedState = state;
      startupTimer = win.setTimeout(checkStartupState, STARTUP_TIMEOUT_MS);
    }

    function deactivate() {
      clearStartupTimer();
      clearOwnedMarkup();
      state = policy.nextState(state, "deactivate");
      mode = "other";
      routeKey = null;
      attemptedThisDocument = false;
      acceptedCount = 0;
      cutoffReason = null;
      cutoffAnchor = null;
      cutoffPlacement = null;
      pendingRoots.clear();
      acceptedIds.clear();
      articleRecords = new WeakMap();
      debug("inactive");
    }

    function findFeedContainer() {
      const candidate = doc.querySelector("main, [role='main']");
      return candidate && !isExcluded(candidate) ? candidate : null;
    }

    function attachFeedObserver(candidate) {
      if (!candidate || candidate === feedContainer) {
        return;
      }
      if (feedObserver) {
        feedObserver.disconnect();
      }
      if (feedColumn) {
        delete feedColumn.dataset.blockinstaFeedColumn;
        feedColumn = null;
      }
      feedContainer = candidate;
      feedObserver = createObserver((mutations) => {
        if (state === policy.STATES.CUTOFF_REACHED) {
          updateFeedColumnMarker();
          restoreEndCard();
          markCutoffTail();
        }
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            const element = mutation.target instanceof Element
              ? mutation.target
              : null;
            if (element) {
              if (state === policy.STATES.CUTOFF_REACHED) {
                markAddedAfterCutoff(element);
              }
              pendingRoots.add(element);
            }
          }
          for (const node of mutation.addedNodes) {
            const element = node instanceof Element
              ? node
              : node.parentElement;
            if (element) {
              if (state === policy.STATES.CUTOFF_REACHED) {
                markAddedAfterCutoff(element);
              }
              pendingRoots.add(element);
            }
          }
          for (const node of mutation.removedNodes) {
            const element = node instanceof Element ? node : node.parentElement;
            if (element) {
              stopObservingTree(element);
            }
          }
        }
        scheduleScan();
      });
      feedObserver.observe(feedContainer, {
        attributeFilter: ["aria-busy", "datetime", "href"],
        attributes: true,
        childList: true,
        subtree: true,
      });
      fullScanNeeded = true;
    }

    function ensureFeedContainer() {
      if (feedContainer && feedContainer.isConnected) {
        return true;
      }
      const candidate = findFeedContainer();
      if (!candidate) {
        return false;
      }
      attachFeedObserver(candidate);
      return true;
    }

    function eligibleArticles(scope = feedContainer) {
      return collectArticles(scope).filter((article) => feedContainer
        && feedContainer.contains(article)
        && !isExcluded(article));
    }

    function updateFeedColumnMarker() {
      const articles = eligibleArticles();
      if (articles.length === 0) {
        return;
      }

      let candidate = articles[0].parentElement;
      while (candidate
        && candidate !== feedContainer
        && !articles.every((article) => candidate.contains(article))) {
        candidate = candidate.parentElement;
      }
      if (!candidate) {
        candidate = feedContainer;
      }

      // Include the stable central-feed wrapper so React can add sibling cards
      // without exposing them before the observer classifies them.
      while (candidate.parentElement
        && candidate.parentElement !== feedContainer
        && eligibleArticles(candidate.parentElement).length === articles.length) {
        candidate = candidate.parentElement;
      }

      if (candidate === feedColumn) {
        return;
      }
      if (feedColumn) {
        delete feedColumn.dataset.blockinstaFeedColumn;
      }
      feedColumn = candidate;
      feedColumn.dataset.blockinstaFeedColumn = "true";
    }

    function shortText(element) {
      if (!element) {
        return "";
      }
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        return ariaLabel;
      }
      if (element.childElementCount > 2) {
        return "";
      }
      const text = element.textContent || "";
      return text.length <= 160 ? text : "";
    }

    function language() {
      return doc.documentElement.lang || "en";
    }

    function signalElements(scope) {
      const elements = [];
      if (scope instanceof Element) {
        elements.push(scope);
      }
      if (scope && typeof scope.querySelectorAll === "function") {
        elements.push(...scope.querySelectorAll(
          "h1, h2, h3, [role='heading'], span, [aria-label]",
        ));
      }
      return [...new Set(elements)];
    }

    function isFeedColumnSignal(element) {
      const articles = eligibleArticles();
      const firstArticle = articles[0];
      if (!firstArticle) {
        return false;
      }

      const articleBox = firstArticle.getBoundingClientRect();
      const signalBox = element.getBoundingClientRect();
      const hasLayout = articleBox.width > 0 && signalBox.width > 0;
      if (hasLayout) {
        const signalCenter = signalBox.left + (signalBox.width / 2);
        return signalCenter >= articleBox.left - 64
          && signalCenter <= articleBox.right + 64;
      }

      return Boolean(feedColumn
        && feedColumn.contains(element)
        && (element === firstArticle || nodeIsAfter(firstArticle, element)));
    }

    function findBoundary(scope) {
      const candidates = [];
      for (const element of signalElements(scope)) {
        if (!feedContainer.contains(element)
          || isExcluded(element)
          || element.closest("article")
          || !isFeedColumnSignal(element)) {
          continue;
        }
        const signals = policy.classifyTexts(shortText(element), language());
        if (signals.caughtUp) {
          candidates.push({
            element,
            reason: policy.CUTOFF_REASONS.CAUGHT_UP,
          });
        } else if (signals.recommendation) {
          candidates.push({
            element,
            reason: policy.CUTOFF_REASONS.RECOMMENDATIONS,
          });
        } else if (signals.error) {
          showUnavailable("Instagram could not load the feed. Refresh to try again or open Messages.");
        }
      }
      candidates.sort((left, right) => {
        const position = left.element.compareDocumentPosition(right.element);
        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      return candidates[0] || null;
    }

    function boundaryBlock(element) {
      const semantic = element.closest("section, [role='region']");
      if (semantic
        && feedContainer.contains(semantic)
        && semantic.querySelectorAll("article").length === 0) {
        return semantic;
      }
      let block = element;
      for (let depth = 0; depth < 3; depth += 1) {
        const parent = block.parentElement;
        if (!parent || parent === feedContainer
          || parent.querySelector("article")) {
          break;
        }
        block = parent;
      }
      return block;
    }

    function nodeIsAfter(reference, candidate) {
      return Boolean(reference && candidate
        && reference !== candidate
        && (reference.compareDocumentPosition(candidate)
          & Node.DOCUMENT_POSITION_FOLLOWING));
    }

    function markHidden(element, reason) {
      if (element.matches?.("article")) {
        cancelViewDwell(element);
      }
      element.dataset.blockinstaFeedHidden = reason;
      element.dataset.blockinstaFeedClassified = "true";
      delete element.dataset.blockinstaFeedAccepted;
      element.setAttribute("aria-hidden", "true");
    }

    function markAllowed(element) {
      delete element.dataset.blockinstaFeedHidden;
      delete element.dataset.blockinstaAfterCutoff;
      element.dataset.blockinstaFeedClassified = "true";
      delete element.dataset.blockinstaFeedAccepted;
      element.removeAttribute("aria-hidden");
    }

    function markAccepted(element) {
      markAllowed(element);
      element.dataset.blockinstaFeedAccepted = "true";
      const stop = feedColumn || feedContainer;
      for (let parent = element.parentElement;
        parent && parent !== stop && parent !== feedContainer;
        parent = parent.parentElement) {
        if (parent.dataset.blockinstaAfterCutoff) {
          delete parent.dataset.blockinstaAfterCutoff;
          parent.removeAttribute("aria-hidden");
        }
      }
      if (state === policy.STATES.CUTOFF_REACHED
        && cutoffReason === policy.CUTOFF_REASONS.LOCAL_LIMIT
        && endCard?.isConnected) {
        const host = endCard.parentElement;
        let branch = element;
        while (branch.parentElement && branch.parentElement !== host) {
          branch = branch.parentElement;
        }
        if (branch.parentElement === host && nodeIsAfter(endCard, branch)) {
          host.insertBefore(endCard, branch.nextSibling);
          cutoffAnchor = branch;
          cutoffPlacement = "after";
        }
      }
    }

    function markAfterCutoff(element) {
      if (!element || element === endCard || element.contains(endCard)) {
        return;
      }
      if (element.matches?.("article")) {
        cancelViewDwell(element);
      }
      element.dataset.blockinstaAfterCutoff = "true";
      element.dataset.blockinstaFeedClassified = "true";
      delete element.dataset.blockinstaFeedAccepted;
      element.setAttribute("aria-hidden", "true");
    }

    function cutoffTailBranch(element) {
      const cutoffScope = feedColumn && feedColumn.contains(endCard)
        ? feedColumn
        : cutoffHost;
      if (!element
        || !cutoffScope
        || !endCard
        || !endCard.isConnected
        || !cutoffScope.contains(element)
        || !nodeIsAfter(endCard, element)) {
        return null;
      }
      let branch = element;
      while (branch.parentElement
        && branch.parentElement !== cutoffScope
        && !branch.parentElement.contains(endCard)) {
        branch = branch.parentElement;
      }
      return branch.parentElement
        && branch.parentElement.contains(endCard)
        && !branch.contains(endCard)
        ? branch
        : null;
    }

    function markCutoffTail() {
      if (!endCard || !endCard.isConnected) {
        return;
      }
      const nextHost = endCard.parentElement;
      if (cutoffHost && cutoffHost !== nextHost) {
        delete cutoffHost.dataset.blockinstaCutoffHost;
      }
      cutoffHost = nextHost;
      cutoffHost.dataset.blockinstaCutoffHost = "true";
      const cutoffScope = feedColumn && feedColumn.contains(endCard)
        ? feedColumn
        : cutoffHost;
      for (let path = endCard; path && path !== cutoffScope; path = path.parentElement) {
        for (let sibling = path.nextElementSibling; sibling;) {
          const nextSibling = sibling.nextElementSibling;
          const articles = collectArticles(sibling).filter(isFeedArticle);
          const hasAcceptedArticle = articles.some((article) => {
            const identity = articleStableKey(article, articleRecords.get(article));
            return Boolean(identity && acceptedIds.has(identity));
          });
          if (hasAcceptedArticle) {
            for (const article of articles) {
              const identity = articleStableKey(article, articleRecords.get(article));
              if (identity && acceptedIds.has(identity)) {
                markAccepted(article);
              } else {
                markAfterCutoff(article);
              }
            }
          } else {
            markAfterCutoff(sibling);
          }
          sibling = nextSibling;
        }
      }
    }

    function markAddedAfterCutoff(element) {
      const tailBranch = cutoffTailBranch(element);
      const articles = collectArticles(element);
      let containsAcceptedArticle = false;
      for (const article of articles) {
        if (!isFeedArticle(article)) {
          continue;
        }
        const identity = articleStableKey(article, articleRecords.get(article));
        if (identity && acceptedIds.has(identity)) {
          containsAcceptedArticle = true;
          markAccepted(article);
        } else {
          markAfterCutoff(article);
        }
      }
      if (tailBranch && !containsAcceptedArticle) {
        markAfterCutoff(tailBranch);
      }
      if (element.matches?.("[role='progressbar']")
        && nodeIsAfter(endCard, element)) {
        markAfterCutoff(element);
      }
      for (const progress of element.querySelectorAll?.("[role='progressbar']") || []) {
        if (nodeIsAfter(endCard, progress)) {
          markAfterCutoff(progress);
        }
      }
    }

    function createEndCard(reason) {
      const card = doc.createElement("section");
      card.className = "blockinsta-feed-end";
      card.dataset.blockinstaFeedEnd = "true";
      card.setAttribute("aria-labelledby", "blockinsta-feed-end-title");

      const eyebrow = doc.createElement("p");
      eyebrow.className = "blockinsta-feed-end__eyebrow";
      eyebrow.textContent = "BlockInsta";

      const title = doc.createElement("h2");
      title.id = "blockinsta-feed-end-title";
      title.textContent = "Your feed ends here";

      const message = doc.createElement("p");
      message.className = "blockinsta-feed-end__message";
      message.textContent = policy.getEndCopy(reason);

      const actions = doc.createElement("div");
      actions.className = "blockinsta-feed-end__actions";

      const refresh = doc.createElement("button");
      refresh.type = "button";
      refresh.textContent = "Refresh for new posts";
      refresh.addEventListener("click", () => win.location.reload());

      const messages = doc.createElement("a");
      messages.href = "https://www.instagram.com/direct/inbox/";
      messages.textContent = "Open Messages";

      actions.append(refresh, messages);
      card.append(eyebrow, title, message, actions);
      return card;
    }

    function disableOlderPostActions(scope) {
      if (!scope || typeof scope.querySelectorAll !== "function") {
        return;
      }
      scope.querySelectorAll("a[href], button, [role='button']").forEach((control) => {
        if (!control.dataset.blockinstaDisabledControl) {
          control.dataset.blockinstaDisabledControl = "true";
          control.dataset.blockinstaPreviousAriaDisabled = control.hasAttribute("aria-disabled")
            ? control.getAttribute("aria-disabled")
            : "__missing__";
          control.dataset.blockinstaPreviousTabindex = control.hasAttribute("tabindex")
            ? control.getAttribute("tabindex")
            : "__missing__";
        }
        control.setAttribute("aria-disabled", "true");
        control.setAttribute("tabindex", "-1");
      });
    }

    function applyCutoffToExistingNodes(boundary, placement) {
      const reference = endCard || boundary;
      (feedColumn || feedContainer).querySelectorAll("article, [role='progressbar']")
        .forEach((element) => {
          if (placement === "after" && element.matches("article")) {
            const identity = articleStableKey(element, articleRecords.get(element));
            if (identity && acceptedIds.has(identity)) {
              markAccepted(element);
            } else {
              markAfterCutoff(element);
            }
            return;
          }
          const shouldHide = placement === "after"
            ? nodeIsAfter(boundary, element)
            : element === boundary || nodeIsAfter(reference, element);
          if (shouldHide) {
            markAfterCutoff(element);
          } else if (placement === "before"
            && element.matches("article")
            && !element.dataset.blockinstaFeedHidden) {
            const identity = articleStableKey(element, articleRecords.get(element));
            if (identity) {
              acceptedIds.add(identity);
            }
            markAccepted(element);
          }
        });
    }

    function establishCutoff(reason, anchor, placement) {
      if (state === policy.STATES.CUTOFF_REACHED || !anchor || !anchor.isConnected) {
        return;
      }
      const block = placement === "before" ? boundaryBlock(anchor) : anchor;
      state = policy.nextState(state, "cutoff");
      cutoffReason = reason;
      cutoffAnchor = block;
      cutoffPlacement = placement;
      html.dataset.blockinstaFeedState = state;

      endCard = createEndCard(reason);
      if (placement === "before") {
        block.parentElement.insertBefore(endCard, block);
        disableOlderPostActions(block);
        markAfterCutoff(block);
      } else {
        block.parentElement.insertBefore(endCard, block.nextSibling);
      }
      applyCutoffToExistingNodes(block, placement);
      markCutoffTail();
      clearViewTracking();
      clearStartupTimer();
      debug(`cutoff:${reason}`);
    }

    function findLastAcceptedArticle() {
      if (!feedContainer) {
        return null;
      }
      let last = null;
      for (const article of collectArticles(feedContainer)) {
        const identity = articleStableKey(article, articleRecords.get(article));
        if (identity && acceptedIds.has(identity)) {
          last = article;
        }
      }
      return last;
    }

    function restoreEndCard() {
      if (state !== policy.STATES.CUTOFF_REACHED
        || !feedContainer
        || (endCard && endCard.isConnected)) {
        return;
      }
      endCard = createEndCard(cutoffReason);
      if (cutoffAnchor && cutoffAnchor.isConnected) {
        if (cutoffPlacement === "before") {
          cutoffAnchor.parentElement.insertBefore(endCard, cutoffAnchor);
        } else {
          cutoffAnchor.parentElement.insertBefore(endCard, cutoffAnchor.nextSibling);
        }
        markCutoffTail();
        return;
      }
      const lastAccepted = findLastAcceptedArticle();
      if (lastAccepted) {
        lastAccepted.parentElement.insertBefore(endCard, lastAccepted.nextSibling);
      } else {
        feedContainer.append(endCard);
      }
      markCutoffTail();
    }

    function collectArticleTexts(article) {
      const header = article.querySelector("header") || article.firstElementChild;
      if (!header) {
        return [];
      }
      return signalElements(header)
        .map(shortText)
        .filter(Boolean)
        .slice(0, 80);
    }

    function articleIdentity(article) {
      for (const anchor of article.querySelectorAll("a[href]")) {
        const identity = policy.getPostIdentity(anchor.href, win.location.href);
        if (identity) {
          return identity;
        }
      }
      return null;
    }

    function normalizedResourceIdentity(value) {
      if (!value || String(value).startsWith("blob:")) {
        return "";
      }
      try {
        const url = new URL(value, win.location.href);
        return `${url.hostname}${url.pathname}`;
      } catch {
        return "";
      }
    }

    function articleAuthor(article) {
      const header = article.querySelector("header") || article.firstElementChild;
      for (const anchor of header?.querySelectorAll?.("a[href]") || []) {
        try {
          const path = new URL(anchor.href, win.location.href).pathname;
          const match = path.match(/^\/([^/]+)\/?$/);
          if (match && !["p", "reel", "reels", "explore", "direct"].includes(
            match[1].toLowerCase(),
          )) {
            return match[1].toLowerCase();
          }
        } catch {
          // Other stable post signals may still be available.
        }
      }
      return "";
    }

    function articleFallbackIdentity(article) {
      const author = articleAuthor(article);
      const timestamp = article.querySelector("time")?.getAttribute("datetime") || "";
      const media = article.querySelector("video[poster], video[src], img[src]");
      const mediaIdentity = normalizedResourceIdentity(
        media?.getAttribute("poster")
          || media?.currentSrc
          || media?.getAttribute("src"),
      );
      if (author && timestamp) {
        return `fallback:${author}|${timestamp}`;
      }
      if (author && mediaIdentity) {
        return `fallback:${author}|${mediaIdentity}`;
      }
      if (timestamp && mediaIdentity) {
        return `fallback:${timestamp}|${mediaIdentity}`;
      }
      return null;
    }

    function articleStableKey(article, previous) {
      const canonical = articleIdentity(article);
      const fallback = articleFallbackIdentity(article);
      if (canonical) {
        if (previous?.identity?.startsWith("fallback:")
          && fallback === previous.identity
          && previous.identity !== canonical
          && acceptedIds.delete(previous.identity)) {
          acceptedIds.add(canonical);
        }
        return canonical;
      }
      return fallback;
    }

    function articleFingerprint(article, identity, signals) {
      const timestamp = article.querySelector("time")?.getAttribute("datetime") || "";
      return [
        identity || "unknown",
        timestamp,
        signals.sponsored ? "sponsored" : "",
        signals.recommendation ? "suggested" : "",
      ].join("|");
    }

    function acceptArticle(identity) {
      if (!identity || acceptedIds.has(identity)) {
        return false;
      }
      acceptedIds.add(identity);
      acceptedCount += 1;
      return true;
    }

    function recordViewedArticle(article) {
      if (state !== policy.STATES.SEEKING_BOUNDARY || !isFeedArticle(article)) {
        return;
      }
      const signals = policy.classifyTexts(collectArticleTexts(article), language());
      if (signals.sponsored || signals.recommendation) {
        classifyArticle(article);
        return;
      }
      const previous = articleRecords.get(article);
      const identity = articleStableKey(article, previous);
      if (!identity) {
        return;
      }
      const newlyAccepted = acceptArticle(identity);
      markAccepted(article);
      articleRecords.set(article, {
        accepted: true,
        fingerprint: articleFingerprint(article, identity, signals),
        identity,
      });
      if (newlyAccepted && acceptedCount >= policy.FALLBACK_POST_LIMIT) {
        establishCutoff(
          policy.CUTOFF_REASONS.LOCAL_LIMIT,
          article,
          "after",
        );
      }
    }

    function classifyArticle(article) {
      if (!isFeedArticle(article)) {
        return;
      }
      const cutoffAlreadyReached = state === policy.STATES.CUTOFF_REACHED;
      const previous = articleRecords.get(article);
      const identity = articleStableKey(article, previous);
      const signals = policy.classifyTexts(collectArticleTexts(article), language());
      const fingerprint = articleFingerprint(article, identity, signals);
      if (previous
        && previous.fingerprint === fingerprint
        && article.dataset.blockinstaFeedClassified === "true") {
        const accepted = Boolean(identity && acceptedIds.has(identity));
        if (cutoffAlreadyReached) {
          if (accepted) {
            markAccepted(article);
          }
        } else if (!accepted && !article.dataset.blockinstaFeedHidden) {
          observeArticle(article);
        }
        return;
      }
      const acceptedBeforeChange = Boolean(identity && acceptedIds.has(identity));
      clearClassification(article);
      if (identity) {
        article.dataset.blockinstaPostId = identity;
      }

      const decision = policy.classifyObservation({
        inFeed: true,
        article: true,
        sponsored: signals.sponsored,
        suggested: signals.recommendation,
        acceptedCount,
      });

      if (decision.action === "hide") {
        markHidden(article, decision.reason);
        articleRecords.set(article, {
          accepted: false,
          fingerprint,
          identity,
        });
        return;
      }

      if (cutoffAlreadyReached) {
        if (acceptedBeforeChange) {
          markAccepted(article);
        } else {
          markAfterCutoff(article);
        }
        articleRecords.set(article, {
          accepted: acceptedBeforeChange,
          fingerprint,
          identity,
        });
        return;
      }

      if (acceptedBeforeChange) {
        markAccepted(article);
      } else {
        markAllowed(article);
        observeArticle(article);
        if (viewStates.get(article)?.visible) {
          scheduleViewedArticle(article);
        }
      }
      articleRecords.set(article, {
        accepted: acceptedBeforeChange,
        fingerprint,
        identity,
      });
    }

    function collectArticles(scope) {
      const articles = [];
      if (scope instanceof Element) {
        const containingArticle = scope.matches("article")
          ? scope
          : scope.closest("article");
        if (containingArticle) {
          articles.push(containingArticle);
        }
      }
      if (scope && typeof scope.querySelectorAll === "function") {
        articles.push(...scope.querySelectorAll("article"));
      }
      return [...new Set(articles)].sort((left, right) => {
        const position = left.compareDocumentPosition(right);
        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    }

    function removeUnavailableCard() {
      if (unavailableCard) {
        unavailableCard.remove();
        unavailableCard = null;
      }
      if (state === policy.STATES.FEED_UNAVAILABLE) {
        state = policy.nextState(state, "available");
        html.dataset.blockinstaFeedState = state;
      }
    }

    function showUnavailable(message) {
      if (!feedContainer || state === policy.STATES.CUTOFF_REACHED) {
        return;
      }
      state = policy.nextState(state, "unavailable");
      html.dataset.blockinstaFeedState = state;
      if (!unavailableCard) {
        unavailableCard = doc.createElement("section");
        unavailableCard.className = "blockinsta-feed-end blockinsta-feed-status";
        unavailableCard.dataset.blockinstaFeedStatus = "true";
        unavailableCard.setAttribute("role", "status");

        const title = doc.createElement("h2");
        title.textContent = "Following feed unavailable";
        const detail = doc.createElement("p");
        detail.className = "blockinsta-feed-end__message";
        const actions = doc.createElement("div");
        actions.className = "blockinsta-feed-end__actions";
        const refresh = doc.createElement("button");
        refresh.type = "button";
        refresh.textContent = "Refresh";
        refresh.addEventListener("click", () => win.location.reload());
        const messages = doc.createElement("a");
        messages.href = "https://www.instagram.com/direct/inbox/";
        messages.textContent = "Open Messages";
        actions.append(refresh, messages);
        unavailableCard.append(title, detail, actions);
        feedContainer.prepend(unavailableCard);
      }
      unavailableCard.querySelector(".blockinsta-feed-end__message").textContent = message;
    }

    function checkStartupState() {
      startupTimer = null;
      if (state !== policy.STATES.SEEKING_BOUNDARY || !ensureFeedContainer()) {
        return;
      }
      const hasArticle = feedContainer.querySelector("article");
      const isLoading = feedContainer.querySelector(
        "[role='progressbar'], [aria-busy='true']",
      );
      if (!hasArticle && !isLoading) {
        if (mode === "following") {
          state = policy.nextState(state, "route");
          html.dataset.blockinstaFeedState = state;
          const fallback = new URL(win.location.href);
          fallback.pathname = "/";
          fallback.search = "?blockinsta=fallback";
          fallback.hash = "";
          win.location.replace(fallback.href);
          return;
        }
        showUnavailable("BlockInsta could not verify Instagram's Home feed. Refresh to try again or open Messages.");
      }
    }

    function runScan() {
      scanScheduled = false;
      if (state === policy.STATES.INACTIVE
        || state === policy.STATES.ROUTING
        || !ensureFeedContainer()) {
        return;
      }
      updateFeedColumnMarker();
      restoreEndCard();

      const roots = fullScanNeeded || pendingRoots.size === 0
        ? [feedContainer]
        : [...pendingRoots].filter((element) => element.isConnected);
      fullScanNeeded = false;
      pendingRoots.clear();

      for (const scope of roots) {
        const boundary = state === policy.STATES.CUTOFF_REACHED
          ? null
          : findBoundary(scope);
        const articles = collectArticles(scope);
        if (boundary) {
          for (const article of articles) {
            if (nodeIsAfter(boundary.element, article)) {
              break;
            }
            classifyArticle(article);
            if (state === policy.STATES.CUTOFF_REACHED) {
              break;
            }
          }
          if (state !== policy.STATES.CUTOFF_REACHED) {
            establishCutoff(boundary.reason, boundary.element, "before");
          }
        }
        for (const article of articles) {
          classifyArticle(article);
        }
      }

      if (acceptedCount > 0) {
        removeUnavailableCard();
      }
    }

    function scheduleScan(rootNode) {
      if (rootNode instanceof Element) {
        pendingRoots.add(rootNode);
      }
      if (scanScheduled || state === policy.STATES.INACTIVE) {
        return;
      }
      scanScheduled = true;
      requestFrame(runScan);
    }

    function handleLocation() {
      const recentAttempt = attemptedThisDocument || readRouteAttempt();
      const decision = policy.decideFeedRoute(
        win.location.href,
        settings,
        recentAttempt,
      );

      if (decision.action === "ignore") {
        if (state !== policy.STATES.INACTIVE) {
          deactivate();
        }
        return Object.freeze({ routed: false, mode: decision.mode });
      }

      if (decision.action === "replace") {
        attemptedThisDocument = true;
        writeRouteAttempt();
        state = policy.nextState(state, "route");
        html.dataset.blockinstaFeedState = state;
        debug("route:following");
        win.location.replace(decision.target);
        return Object.freeze({ routed: true, mode: decision.mode });
      }

      if (decision.mode === "following") {
        attemptedThisDocument = true;
        clearRouteAttempt();
      } else if (recentAttempt) {
        attemptedThisDocument = true;
        clearRouteAttempt();
      }

      const nextRouteKey = currentRouteKey();
      if (state === policy.STATES.INACTIVE || routeKey !== nextRouteKey) {
        routeKey = nextRouteKey;
        mode = decision.mode;
        resetSession();
      }
      ensureFeedContainer();
      scheduleScan();
      return Object.freeze({ routed: false, mode: decision.mode });
    }

    function updateSettings(candidate) {
      settings = candidate || settings;
      return handleLocation();
    }

    function handleDocumentMutations(mutations) {
      if (state === policy.STATES.INACTIVE) {
        return;
      }
      if (!feedContainer || !feedContainer.isConnected) {
        feedContainer = null;
        ensureFeedContainer();
        fullScanNeeded = true;
      }
      if (!feedContainer) {
        return;
      }
      if (state === policy.STATES.CUTOFF_REACHED) {
        updateFeedColumnMarker();
        restoreEndCard();
        markCutoffTail();
      }
      for (const mutation of mutations || []) {
        if (mutation.type === "attributes") {
          const element = mutation.target instanceof Element
            ? mutation.target
            : null;
          if (element && feedContainer.contains(element)) {
            if (state === policy.STATES.CUTOFF_REACHED) {
              markAddedAfterCutoff(element);
            }
            pendingRoots.add(element);
          }
        }
        for (const node of mutation.addedNodes || []) {
          const element = node instanceof Element ? node : node.parentElement;
          if (element && feedContainer.contains(element)) {
            if (state === policy.STATES.CUTOFF_REACHED) {
              markAddedAfterCutoff(element);
            }
            pendingRoots.add(element);
          }
        }
        for (const node of mutation.removedNodes || []) {
          const element = node instanceof Element ? node : node.parentElement;
          if (element) {
            stopObservingTree(element);
          }
        }
      }
      scheduleScan();
    }

    function getState() {
      return Object.freeze({
        acceptedCount,
        cutoffReason,
        mode,
        state,
      });
    }

    return Object.freeze({
      getState,
      handleDocumentMutations,
      handleLocation,
      updateSettings,
      destroy: deactivate,
    });
  }

  return Object.freeze({ createFeedGuard });
});
