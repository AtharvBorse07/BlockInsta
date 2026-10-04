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
  const EXPIRATION_ALARM = "blockinsta-unlock-expired";

  function getPlan(candidate, now = Date.now()) {
    const normalized = settingsApi.normalizeSettings(candidate, now);
    const status = settingsApi.getStatus(normalized, now);
    return {
      settings: normalized,
      status,
      shouldEnableRuleset: status === "active",
      alarmAt: status === "temporarily_unlocked"
        ? normalized.unlockUntil
        : null,
    };
  }

  function getPublicStatus(candidate, now = Date.now()) {
    const plan = getPlan(candidate, now);
    return {
      schemaVersion: plan.settings.schemaVersion,
      enabled: plan.settings.enabled,
      unlockUntil: plan.settings.unlockUntil,
      status: plan.status,
      remainingMs: settingsApi.getRemainingMs(plan.settings, now),
      now,
    };
  }

  function isInstagramUrl(value) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      return (url.protocol === "https:" || url.protocol === "http:")
        && (hostname === "instagram.com" || hostname.endsWith(".instagram.com"));
    } catch {
      return false;
    }
  }

  return Object.freeze({
    RULESET_ID,
    EXPIRATION_ALARM,
    getPlan,
    getPublicStatus,
    isInstagramUrl,
  });
});

