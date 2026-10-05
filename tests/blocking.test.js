"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const blocking = require("../extension/shared/blocking.js");

test("active selective settings enable the Reels collection ruleset", () => {
  const plan = blocking.getPlan({
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  });
  assert.equal(plan.status, "active");
  assert.equal(plan.shouldEnableRuleset, true);
});

test("the master switch disables the network ruleset", () => {
  const plan = blocking.getPlan({
    schemaVersion: 5,
    enabled: false,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  });
  assert.equal(plan.status, "disabled");
  assert.equal(plan.shouldEnableRuleset, false);
});

test("the collection option controls only the network ruleset", () => {
  const plan = blocking.getPlan({
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: false,
    hideSearchDiscovery: true,
    limitHomeFeed: true,
    limitIndividualReels: true,
    preferFollowingFeed: true,
  });
  assert.equal(plan.status, "active");
  assert.equal(plan.shouldEnableRuleset, false);
  assert.equal(plan.settings.limitIndividualReels, true);
});

test("public status exposes the selective protections", () => {
  assert.deepEqual(blocking.getPublicStatus({
    schemaVersion: 5,
    enabled: true,
    blockReelsFeed: true,
    hideSearchDiscovery: true,
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
    preferFollowingFeed: true,
    status: "active",
  });
});
