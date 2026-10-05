"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../extension/shared/search-policy.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "fixtures",
  "instagram-search",
  "policy-cases.json",
), "utf8"));

test("only Search/Explore landing routes are discovery candidates", () => {
  const cases = new Map([
    ["https://www.instagram.com/explore/", "explore_landing"],
    ["https://m.instagram.com/EXPLORE//", "explore_landing"],
    ["https://www.instagram.com/explore/search/", "search_landing"],
    ["https://www.instagram.com/explore/search/cats/", "search_results"],
    ["https://www.instagram.com/explore/tags/cats/", "other"],
    ["https://www.instagram.com/explore/locations/1/", "other"],
    ["https://www.instagram.com/direct/inbox/", "other"],
    ["https://instagram.com.example.com/explore/", "other"],
  ]);
  cases.forEach((mode, url) => {
    assert.equal(policy.getSearchMode(url), mode, url);
  });
});

test("route observation respects the feature and master switches", () => {
  const active = { enabled: true, hideSearchDiscovery: true };
  assert.deepEqual(policy.decideSearchRoute(
    "https://www.instagram.com/explore/",
    active,
  ), { action: "observe", mode: "explore_landing" });
  assert.equal(policy.decideSearchRoute(
    "https://www.instagram.com/explore/search/cats/",
    active,
  ).action, "ignore");
  assert.equal(policy.decideSearchRoute(
    "https://www.instagram.com/",
    active,
    true,
  ).mode, "search_panel");
  assert.equal(policy.decideSearchRoute(
    "https://www.instagram.com/explore/",
    { ...active, enabled: false },
  ).action, "ignore");
  assert.equal(policy.decideSearchRoute(
    "https://www.instagram.com/explore/",
    { ...active, hideSearchDiscovery: false },
  ).action, "ignore");
});

for (const fixture of fixtures) {
  test(`search policy: ${fixture.name}`, () => {
    const result = policy.classifyObservation(fixture.input);
    assert.equal(result.action, fixture.action);
    assert.equal(result.reason, fixture.reason);
  });
}

test("search activity includes focus, composition, queries, and result owners", () => {
  assert.equal(policy.isSearchActive({ inputFocused: true }), true);
  assert.equal(policy.isSearchActive({ composing: true }), true);
  assert.equal(policy.isSearchActive({ queryActive: true }), true);
  assert.equal(policy.isSearchActive({ searchOwnerVisible: true }), true);
  assert.equal(policy.isSearchActive({}), false);
});

test("search state transitions are explicit and reversible", () => {
  assert.equal(policy.nextState("inactive", "locate"), "locating");
  assert.equal(policy.nextState("locating", "hide"), "discovery_hidden");
  assert.equal(policy.nextState("discovery_hidden", "search"), "search_active");
  assert.equal(policy.nextState("search_active", "ambiguous"), "ambiguous");
  assert.equal(policy.nextState("ambiguous", "deactivate"), "inactive");
});

