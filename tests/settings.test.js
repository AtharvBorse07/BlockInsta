"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../extension/shared/settings.js");

const NOW = Date.UTC(2026, 9, 4, 18, 0, 0);

test("missing settings return safe blocking defaults", () => {
  assert.deepEqual(settings.normalizeSettings(undefined, NOW), {
    schemaVersion: 1,
    enabled: true,
    unlockUntil: null,
  });
});

test("malformed fields are replaced by safe values", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: "old",
    enabled: "yes",
    unlockUntil: "later",
    unexpected: true,
  }, NOW), {
    schemaVersion: 1,
    enabled: true,
    unlockUntil: null,
  });
});

test("unknown stored fields are removed during normalization", () => {
  const candidate = {
    schemaVersion: 1,
    enabled: true,
    unlockUntil: null,
    unexpected: "remove me",
  };
  const normalized = settings.normalizeSettings(candidate, NOW);
  assert.equal(settings.equal(candidate, normalized), false);
  assert.deepEqual(Object.keys(normalized).sort(), [
    "enabled",
    "schemaVersion",
    "unlockUntil",
  ]);
});

test("a future absolute unlock timestamp is preserved", () => {
  const unlockUntil = NOW + 15 * 60 * 1000;
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 0,
    enabled: true,
    unlockUntil,
  }, NOW), {
    schemaVersion: 1,
    enabled: true,
    unlockUntil,
  });
});

test("an expired unlock is cleared immediately", () => {
  const normalized = settings.normalizeSettings({
    schemaVersion: 1,
    enabled: true,
    unlockUntil: NOW - 1,
  }, NOW);
  assert.equal(normalized.unlockUntil, null);
  assert.equal(settings.getStatus(normalized, NOW), "active");
});

test("explicitly disabled blocking cannot retain an unlock", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 1,
    enabled: false,
    unlockUntil: NOW + 30 * 60 * 1000,
  }, NOW), {
    schemaVersion: 1,
    enabled: false,
    unlockUntil: null,
  });
});

test("temporary unlock uses an absolute timestamp", () => {
  const result = settings.startTemporaryUnlock(
    settings.DEFAULT_SETTINGS,
    15,
    NOW,
  );
  assert.equal(result.enabled, true);
  assert.equal(result.unlockUntil, NOW + 15 * 60 * 1000);
});

test("unsupported unlock durations are rejected", () => {
  assert.throws(
    () => settings.startTemporaryUnlock(settings.DEFAULT_SETTINGS, 10, NOW),
    /5, 15, or 30/,
  );
});

test("countdown formatting rounds up partial seconds", () => {
  assert.equal(settings.formatRemaining(60_001), "1:01");
  assert.equal(settings.formatRemaining(0), "0:00");
});

