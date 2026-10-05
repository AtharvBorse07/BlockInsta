(function initializeRoutes(root, factory) {
  "use strict";

  const routesApi = factory();
  root.BlockInstaRoutes = routesApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = routesApi;
  }
})(globalThis, function createRoutesApi() {
  "use strict";

  const INSTAGRAM_HOST = "instagram.com";

  function isInstagramHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === INSTAGRAM_HOST
      || normalized.endsWith(`.${INSTAGRAM_HOST}`);
  }

  function normalizePathname(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = pathname;
    }

    const collapsed = `/${String(decoded || "").replace(/^\/+|\/+$/g, "")}`
      .replace(/\/{2,}/g, "/");
    return collapsed === "/" ? collapsed : collapsed.replace(/\/+$/g, "");
  }

  function normalizeInstagramUrl(value, baseUrl) {
    let url;
    try {
      url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    } catch {
      return null;
    }

    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || !isInstagramHostname(url.hostname)) {
      return null;
    }

    return Object.freeze({
      hostname: url.hostname.toLowerCase(),
      pathname: normalizePathname(url.pathname),
      search: url.search,
      hash: url.hash,
      href: url.href,
    });
  }

  function result(surface, policy, canonicalPath, itemId = null, reason = null) {
    return Object.freeze({ surface, policy, canonicalPath, itemId, reason });
  }

  function classifyInstagramUrl(value, baseUrl) {
    const normalized = normalizeInstagramUrl(value, baseUrl);
    if (!normalized) {
      return result("not_instagram", "ignore", null);
    }

    const path = normalized.pathname;
    const lowerPath = path.toLowerCase();

    if (lowerPath === "/reels") {
      return result("reels_collection", "block", "/reels/", null,
        "infinite_reels");
    }

    if (lowerPath.startsWith("/reels/")) {
      return result("unknown_reels", "block", path, null,
        "unknown_reels_surface");
    }

    const reelMatch = path.match(/^\/reel\/([A-Za-z0-9_-]+)$/i);
    if (reelMatch) {
      return result("reel_item", "allow_one", path, reelMatch[1]);
    }

    if (lowerPath === "/") {
      return result("feed", "allow", "/");
    }

    if (lowerPath === "/direct" || lowerPath.startsWith("/direct/")) {
      return result("direct", "allow", path);
    }

    if (/^\/p\/[A-Za-z0-9_-]+$/i.test(path)) {
      return result("post", "allow", path);
    }

    if (lowerPath === "/stories" || lowerPath.startsWith("/stories/")) {
      return result("stories", "allow", path);
    }

    if (lowerPath === "/explore/search"
      || lowerPath.startsWith("/explore/search/")) {
      return result("search", "allow", path);
    }

    if (lowerPath === "/explore" || lowerPath.startsWith("/explore/")) {
      return result("explore", "allow", path);
    }

    if (/^\/[^/]+$/.test(path)) {
      return result("profile", "allow", path);
    }

    return result("other", "allow", path);
  }

  function decideNavigation(classification, allowedItemId, candidateSettings) {
    const settings = candidateSettings || {};
    if (!settings.enabled) {
      return Object.freeze({ action: "allow", allowedItemId: null });
    }

    if (classification.policy === "block" && settings.blockReelsFeed) {
      return Object.freeze({
        action: "exit",
        allowedItemId,
        reason: classification.reason || "infinite_reels",
      });
    }

    if (classification.surface === "reel_item"
      && settings.limitIndividualReels) {
      if (allowedItemId && allowedItemId !== classification.itemId) {
        return Object.freeze({
          action: "exit",
          allowedItemId,
          reason: "next_reel",
        });
      }
      return Object.freeze({
        action: "allow_one",
        allowedItemId: classification.itemId,
      });
    }

    return Object.freeze({ action: "allow", allowedItemId: null });
  }

  function getReelShortcode(value, baseUrl) {
    const classification = classifyInstagramUrl(value, baseUrl);
    return classification.surface === "reel_item"
      ? classification.itemId
      : null;
  }

  function isBlockedCollectionRoute(value, baseUrl) {
    return classifyInstagramUrl(value, baseUrl).policy === "block";
  }

  function isAllowedSingleReelRoute(value, baseUrl) {
    return classifyInstagramUrl(value, baseUrl).surface === "reel_item";
  }

  return Object.freeze({
    INSTAGRAM_HOST,
    isInstagramHostname,
    normalizePathname,
    normalizeInstagramUrl,
    classifyInstagramUrl,
    decideNavigation,
    getReelShortcode,
    isBlockedCollectionRoute,
    isAllowedSingleReelRoute,
  });
});
