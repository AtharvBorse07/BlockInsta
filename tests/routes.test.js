"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("../extension/shared/routes.js");

const ACTIVE = Object.freeze({
  enabled: true,
  blockReelsFeed: true,
  limitIndividualReels: true,
});

test("the exact Reels collection route is blocked across Instagram hosts", () => {
  const blocked = [
    "https://instagram.com/reels",
    "https://www.instagram.com/reels/",
    "https://m.instagram.com/REELS/?source=nav#ignored",
    "http://subdomain.instagram.com/reels//",
    "https://www.instagram.com/r%65els/",
  ];
  blocked.forEach((url) => {
    const result = routes.classifyInstagramUrl(url);
    assert.equal(result.surface, "reels_collection", url);
    assert.equal(result.policy, "block", url);
  });
});

test("unverified plural Reels subroutes fail closed", () => {
  const result = routes.classifyInstagramUrl(
    "https://www.instagram.com/reels/audio/123/",
  );
  assert.equal(result.surface, "unknown_reels");
  assert.equal(result.policy, "block");
});

test("an individual singular Reel is allowed as one item", () => {
  const result = routes.classifyInstagramUrl(
    "https://www.instagram.com/reel/AbC_123-x/?igsh=tracking#comments",
  );
  assert.equal(result.surface, "reel_item");
  assert.equal(result.policy, "allow_one");
  assert.equal(result.itemId, "AbC_123-x");
});

test("useful Instagram surfaces remain allowed", () => {
  const allowed = new Map([
    ["https://www.instagram.com/", "feed"],
    ["https://www.instagram.com/?variant=following", "feed"],
    ["https://www.instagram.com/direct/inbox/", "direct"],
    ["https://www.instagram.com/direct/t/123/", "direct"],
    ["https://www.instagram.com/p/ABC123/", "post"],
    ["https://www.instagram.com/stories/friend/123/", "stories"],
    ["https://www.instagram.com/explore/search/keyword/", "search"],
    ["https://www.instagram.com/explore/", "explore"],
    ["https://www.instagram.com/friend_name/", "profile"],
  ]);
  allowed.forEach((surface, url) => {
    const result = routes.classifyInstagramUrl(url);
    assert.equal(result.surface, surface, url);
    assert.equal(result.policy, "allow", url);
  });
});

test("lookalike and non-web URLs are ignored", () => {
  const ignored = [
    "https://instagram.com.example.com/reels/",
    "https://notinstagram.com/reels/",
    "file:///reels/",
    "javascript:alert(1)",
    "not a url",
  ];
  ignored.forEach((url) => {
    assert.equal(routes.classifyInstagramUrl(url).policy, "ignore", url);
  });
});

test("relative Instagram links use the supplied page URL", () => {
  const result = routes.classifyInstagramUrl(
    "/reel/Shared123/",
    "https://www.instagram.com/direct/inbox/",
  );
  assert.equal(result.itemId, "Shared123");
});

test("the first individual Reel is pinned", () => {
  const classification = routes.classifyInstagramUrl(
    "https://www.instagram.com/reel/FIRST/",
  );
  assert.deepEqual(routes.decideNavigation(classification, null, ACTIVE), {
    action: "allow_one",
    allowedItemId: "FIRST",
  });
});

test("the pinned Reel remains allowed", () => {
  const classification = routes.classifyInstagramUrl(
    "https://www.instagram.com/reel/FIRST/",
  );
  assert.equal(
    routes.decideNavigation(classification, "FIRST", ACTIVE).action,
    "allow_one",
  );
});

test("a second Reel exits the Instagram viewer", () => {
  const classification = routes.classifyInstagramUrl(
    "https://www.instagram.com/reel/SECOND/",
  );
  assert.deepEqual(
    routes.decideNavigation(classification, "FIRST", ACTIVE),
    { action: "exit", allowedItemId: "FIRST", reason: "next_reel" },
  );
});

test("leaving the Reel viewer clears its pinned item", () => {
  const classification = routes.classifyInstagramUrl(
    "https://www.instagram.com/direct/inbox/",
  );
  assert.deepEqual(
    routes.decideNavigation(classification, "FIRST", ACTIVE),
    { action: "allow", allowedItemId: null },
  );
});

test("the master switch bypasses every selective decision", () => {
  const classification = routes.classifyInstagramUrl(
    "https://www.instagram.com/reels/",
  );
  assert.deepEqual(routes.decideNavigation(classification, null, {
    ...ACTIVE,
    enabled: false,
  }), { action: "allow", allowedItemId: null });
});

test("collection and item protections can be evaluated independently", () => {
  const collection = routes.classifyInstagramUrl(
    "https://www.instagram.com/reels/",
  );
  const second = routes.classifyInstagramUrl(
    "https://www.instagram.com/reel/SECOND/",
  );
  assert.equal(routes.decideNavigation(collection, null, {
    ...ACTIVE,
    blockReelsFeed: false,
  }).action, "allow");
  assert.equal(routes.decideNavigation(second, "FIRST", {
    ...ACTIVE,
    limitIndividualReels: false,
  }).action, "allow");
});
