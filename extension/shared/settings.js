(function initializeSettings(root, factory) {
  "use strict";

  const settingsApi = factory();
  root.BlockInstaSettings = settingsApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = settingsApi;
  }
})(globalThis, function createSettingsApi() {
  "use strict";

  const SCHEMA_VERSION = 1;
  const VALID_UNLOCK_MINUTES = Object.freeze([5, 15, 30]);
  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    unlockUntil: null,
  });

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeSettings(candidate, now = Date.now()) {
    if (!isRecord(candidate)) {
      return { ...DEFAULT_SETTINGS };
    }

    const enabled = typeof candidate.enabled === "boolean"
      ? candidate.enabled
      : DEFAULT_SETTINGS.enabled;
    const validUnlock = Number.isFinite(candidate.unlockUntil)
      && candidate.unlockUntil > now;

    return {
      schemaVersion: SCHEMA_VERSION,
      enabled,
      unlockUntil: enabled && validUnlock
        ? Math.trunc(candidate.unlockUntil)
        : null,
    };
  }

  function equal(left, right) {
    const expectedKeys = ["enabled", "schemaVersion", "unlockUntil"];
    return isRecord(left)
      && Object.keys(left).sort().join(",") === expectedKeys.join(",")
      && left.schemaVersion === right.schemaVersion
      && left.enabled === right.enabled
      && left.unlockUntil === right.unlockUntil;
  }

  function getStatus(candidate, now = Date.now()) {
    const settings = normalizeSettings(candidate, now);
    if (!settings.enabled) {
      return "disabled";
    }
    if (settings.unlockUntil !== null && settings.unlockUntil > now) {
      return "temporarily_unlocked";
    }
    return "active";
  }

  function getRemainingMs(candidate, now = Date.now()) {
    const settings = normalizeSettings(candidate, now);
    return settings.unlockUntil === null
      ? 0
      : Math.max(0, settings.unlockUntil - now);
  }

  function setEnabled(candidate, enabled, now = Date.now()) {
    const settings = normalizeSettings(candidate, now);
    return {
      ...settings,
      enabled: Boolean(enabled),
      unlockUntil: null,
    };
  }

  function startTemporaryUnlock(candidate, minutes, now = Date.now()) {
    if (!VALID_UNLOCK_MINUTES.includes(minutes)) {
      throw new RangeError("Unlock duration must be 5, 15, or 30 minutes.");
    }

    const settings = normalizeSettings(candidate, now);
    return {
      ...settings,
      enabled: true,
      unlockUntil: now + minutes * 60 * 1000,
    };
  }

  function reenableNow(candidate, now = Date.now()) {
    const settings = normalizeSettings(candidate, now);
    return {
      ...settings,
      enabled: true,
      unlockUntil: null,
    };
  }

  function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  return Object.freeze({
    SCHEMA_VERSION,
    VALID_UNLOCK_MINUTES,
    DEFAULT_SETTINGS,
    normalizeSettings,
    equal,
    getStatus,
    getRemainingMs,
    setEnabled,
    startTemporaryUnlock,
    reenableNow,
    formatRemaining,
  });
});

