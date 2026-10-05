(function initializeBlocking(root, factory) {
  "use strict";

  let settingsApi = root.BlockInstaSettings;
  if (!settingsApi && typeof require === "function") {
    settingsApi = require("./settings.js");
  }

  const blockingApi = factory(settingsApi);
  root.BlockInstaBlocking = blockingApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = blockingApi;
  }
})(globalThis, function createBlockingApi(settingsApi) {
  "use strict";

  const RULESET_ID = "instagram_rules";

  function getPlan(candidate) {
    const settings = settingsApi.normalizeSettings(candidate);
    return {
      settings,
      status: settingsApi.getStatus(settings),
      shouldEnableRuleset: settings.enabled && settings.blockReelsFeed,
    };
  }

  function getPublicStatus(candidate) {
    const plan = getPlan(candidate);
    return {
      schemaVersion: plan.settings.schemaVersion,
      enabled: plan.settings.enabled,
      blockReelsFeed: plan.settings.blockReelsFeed,
      hideSearchDiscovery: plan.settings.hideSearchDiscovery,
      limitHomeFeed: plan.settings.limitHomeFeed,
      limitIndividualReels: plan.settings.limitIndividualReels,
      preferFollowingFeed: plan.settings.preferFollowingFeed,
      status: plan.status,
    };
  }

  return Object.freeze({
    RULESET_ID,
    getPlan,
    getPublicStatus,
  });
});
