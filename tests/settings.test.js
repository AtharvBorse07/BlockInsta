"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../extension/shared/settings.js");

test("missing settings return safe selective-blocking defaults", () => {
  assert.deepEqual(settings.normalizeSettings(undefined), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });
});

test("version 1 state preserves enabled and removes temporary unlock", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 1,
    enabled: false,
    unlockUntil: Date.now() + 60_000,
  }), {
    schemaVersion: 5,
    enabled: false,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });
});

test("version 2 state preserves Reels choices and enables finite Home defaults", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 2,
    enabled: true,
    blockReelsFeed: false,
    limitIndividualReels: false,
  }), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: false,
    preferFollowingFeed: false,
  });
});

test("version 3 state disables the unreliable automatic Following route", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 3,
    enabled: true,
    blockReelsFeed: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  }), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });
});

test("version 4 settings migrate to Search protection without losing choices", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 4,
    enabled: true,
    blockReelsFeed: false,
    limitHomeFeed: false,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  }), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: true,
    limitHomeFeed: false,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  });
});

test("malformed fields are replaced by safe values", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: "old",
    enabled: "yes",
    blockReelsFeed: 0,
    limitIndividualReels: null,
    unexpected: true,
  }), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });
});

test("valid selective settings are preserved", () => {
  assert.deepEqual(settings.normalizeSettings({
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: false,
    limitHomeFeed: false,
    limitIndividualReels: false,
    preferFollowingFeed: false,
  }), {
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: false,
    limitHomeFeed: false,
    limitIndividualReels: false,
    preferFollowingFeed: false,
  });
});

test("unknown stored fields are removed during normalization", () => {
  const candidate = {
    ...settings.DEFAULT_SETTINGS,
    unexpected: "remove me",
  };
  const normalized = settings.normalizeSettings(candidate);
  assert.equal(settings.equal(candidate, normalized), false);
  assert.deepEqual(Object.keys(normalized).sort(), settings.SETTINGS_KEYS);
});

test("setEnabled changes only the master switch", () => {
  assert.deepEqual(settings.setEnabled({
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: false,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  }, false), {
    schemaVersion: 5,
    enabled: false,
    blockReelsFeed: false,
    hideSearchDiscovery: false,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: false,
  });
});

test("status is active only when the master switch is enabled", () => {
  assert.equal(settings.getStatus({ enabled: true }), "active");
  assert.equal(settings.getStatus({ enabled: false }), "disabled");
});
