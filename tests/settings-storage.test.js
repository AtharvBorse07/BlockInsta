"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../extension/shared/settings.js");
const storage = require("../extension/shared/settings-storage.js");

function createMemoryCompatibility(initialValue) {
  const values = initialValue === undefined
    ? {}
    : { settings: initialValue };
  return {
    values,
    async storageGet() {
      return { ...values };
    },
    async storageSet(nextValues) {
      Object.assign(values, nextValues);
    },
  };
}

test("direct storage reads normalize and persist missing settings", async () => {
  const compatibility = createMemoryCompatibility();
  const store = storage.createSettingsStore(compatibility);
  assert.deepEqual(await store.readNormalized(), settings.DEFAULT_SETTINGS);
  assert.deepEqual(compatibility.values.settings, settings.DEFAULT_SETTINGS);
});

test("direct storage writes remove unknown and malformed fields", async () => {
  const compatibility = createMemoryCompatibility();
  const store = storage.createSettingsStore(compatibility);
  const normalized = await store.writeNormalized({
    schemaVersion: "old",
    enabled: false,
    unexpected: true,
  });
  assert.deepEqual(normalized, {
    ...settings.DEFAULT_SETTINGS,
    enabled: false,
  });
  assert.deepEqual(compatibility.values.settings, normalized);
});

test("direct storage changes only the master enabled switch", async () => {
  const compatibility = createMemoryCompatibility({
    ...settings.DEFAULT_SETTINGS,
    blockReelsFeed: false,
    hideSearchDiscovery: false,
  });
  const store = storage.createSettingsStore(compatibility);
  const normalized = await store.setEnabled(false);
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.blockReelsFeed, false);
  assert.equal(normalized.hideSearchDiscovery, false);
});
