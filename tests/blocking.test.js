"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const blocking = require("../extension/shared/blocking.js");

const NOW = Date.UTC(2026, 9, 4, 18, 0, 0);

test("active settings enable the static ruleset", () => {
  const plan = blocking.getPlan({ enabled: true, unlockUntil: null }, NOW);
  assert.equal(plan.status, "active");
  assert.equal(plan.shouldEnableRuleset, true);
  assert.equal(plan.alarmAt, null);
});

test("explicit disable turns off the ruleset without an alarm", () => {
  const plan = blocking.getPlan({ enabled: false, unlockUntil: null }, NOW);
  assert.equal(plan.status, "disabled");
  assert.equal(plan.shouldEnableRuleset, false);
  assert.equal(plan.alarmAt, null);
});

test("active temporary unlock disables rules and schedules expiration", () => {
  const unlockUntil = NOW + 5 * 60 * 1000;
  const plan = blocking.getPlan({ enabled: true, unlockUntil }, NOW);
  assert.equal(plan.status, "temporarily_unlocked");
  assert.equal(plan.shouldEnableRuleset, false);
  assert.equal(plan.alarmAt, unlockUntil);
});

test("expired temporary unlock safely enables blocking", () => {
  const plan = blocking.getPlan({
    enabled: true,
    unlockUntil: NOW - 60_000,
  }, NOW);
  assert.equal(plan.status, "active");
  assert.equal(plan.settings.unlockUntil, null);
  assert.equal(plan.shouldEnableRuleset, true);
});

test("Instagram URL matcher covers root, paths, queries, and subdomains", () => {
  const blockedUrls = [
    "https://instagram.com/",
    "https://www.instagram.com/reels/",
    "https://m.instagram.com/explore/?source=test#top",
    "http://subdomain.instagram.com/direct/inbox/",
    "https://www.instagram.com/example_user/",
  ];
  blockedUrls.forEach((url) => assert.equal(blocking.isInstagramUrl(url), true, url));
});

test("Instagram URL matcher does not overreach", () => {
  const allowedUrls = [
    "https://example.com/",
    "https://instagram.com.example.com/",
    "https://notinstagram.com/",
    "file:///instagram.com",
    "not a url",
  ];
  allowedUrls.forEach((url) => assert.equal(blocking.isInstagramUrl(url), false, url));
});

