(function initializeSettings(root, factory) {
  "use strict";

  const settingsApi = factory();
  root.BlockInstaSettings = settingsApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = settingsApi;
  }
})(globalThis, function createSettingsApi() {
  "use strict";

  const SCHEMA_VERSION = 5;
  const SETTINGS_KEYS = Object.freeze([
    "blockReelsFeed",
    "enabled",
    "hideSearchDiscovery",
    "limitHomeFeed",
    "limitIndividualReels",
    "preferFollowingFeed",
    "schemaVersion",
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function booleanOrDefault(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeSettings(candidate) {
    if (!isRecord(candidate)) {
      return { ...DEFAULT_SETTINGS };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: booleanOrDefault(candidate.enabled, DEFAULT_SETTINGS.enabled),
      blockReelsFeed: booleanOrDefault(
        candidate.blockReelsFeed,
        DEFAULT_SETTINGS.blockReelsFeed,
      ),
      hideSearchDiscovery: candidate.schemaVersion === SCHEMA_VERSION
        ? booleanOrDefault(
          candidate.hideSearchDiscovery,
          DEFAULT_SETTINGS.hideSearchDiscovery,
        )
        : DEFAULT_SETTINGS.hideSearchDiscovery,
      limitHomeFeed: booleanOrDefault(
        candidate.limitHomeFeed,
        DEFAULT_SETTINGS.limitHomeFeed,
      ),
      limitIndividualReels: booleanOrDefault(
        candidate.limitIndividualReels,
        DEFAULT_SETTINGS.limitIndividualReels,
      ),
      preferFollowingFeed: (candidate.schemaVersion === SCHEMA_VERSION
        || candidate.schemaVersion === 4)
        ? booleanOrDefault(
          candidate.preferFollowingFeed,
          DEFAULT_SETTINGS.preferFollowingFeed,
        )
        : DEFAULT_SETTINGS.preferFollowingFeed,
    };
  }

  function equal(left, right) {
    return isRecord(left)
      && Object.keys(left).sort().join(",") === SETTINGS_KEYS.join(",")
      && SETTINGS_KEYS.every((key) => left[key] === right[key]);
  }

  function getStatus(candidate) {
    return normalizeSettings(candidate).enabled ? "active" : "disabled";
  }

  function setEnabled(candidate, enabled) {
    return {
      ...normalizeSettings(candidate),
      enabled: Boolean(enabled),
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    SETTINGS_KEYS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    equal,
    getStatus,
    setEnabled,
  });
});
