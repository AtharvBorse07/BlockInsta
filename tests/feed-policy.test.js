"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../extension/shared/feed-policy.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "fixtures",
  "instagram-feed",
  "policy-cases.json",
), "utf8"));

test("bare Home prefers Following exactly once", () => {
  const settings = {
    enabled: true,
    limitHomeFeed: true,
    preferFollowingFeed: true,
  };
  assert.deepEqual(policy.decideFeedRoute(
    "https://www.instagram.com/",
    settings,
    false,
  ), {
    action: "replace",
    mode: "home_bare",
    target: "https://www.instagram.com/?variant=following",
  });
  assert.equal(policy.decideFeedRoute(
    "https://www.instagram.com/?variant=following",
    settings,
    false,
  ).action, "observe");
  assert.equal(policy.decideFeedRoute(
    "https://www.instagram.com/",
    settings,
    true,
  ).action, "observe");
});

test("feed routing never affects other Instagram surfaces", () => {
  const settings = {
    enabled: true,
    limitHomeFeed: true,
    preferFollowingFeed: true,
  };
  const urls = [
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/friend/",
    "https://www.instagram.com/p/Post123/",
    "https://www.instagram.com/reel/Reel123/",
    "https://www.instagram.com/explore/",
  ];
  urls.forEach((url) => {
    assert.equal(policy.decideFeedRoute(url, settings).action, "ignore", url);
  });
});

test("Home URLs with unrelated queries use DOM fallback without redirecting", () => {
  const decision = policy.decideFeedRoute(
    "https://www.instagram.com/?utm_source=bookmark",
    { enabled: true, limitHomeFeed: true, preferFollowingFeed: true },
  );
  assert.equal(decision.action, "observe");
  assert.equal(decision.mode, "home");
});

test("the master and feed switches independently disable Home enforcement", () => {
  const base = {
    enabled: true,
    limitHomeFeed: true,
    preferFollowingFeed: true,
  };
  assert.equal(policy.decideFeedRoute("https://www.instagram.com/", {
    ...base,
    enabled: false,
  }).action, "ignore");
  assert.equal(policy.decideFeedRoute("https://www.instagram.com/", {
    ...base,
    limitHomeFeed: false,
  }).action, "ignore");
  assert.equal(policy.decideFeedRoute("https://www.instagram.com/", {
    ...base,
    preferFollowingFeed: false,
  }).action, "observe");
});

for (const fixture of fixtures) {
  test(`feed policy: ${fixture.name}`, () => {
    const result = policy.classifyObservation(fixture.input);
    assert.equal(result.action, fixture.action);
    assert.equal(result.reason, fixture.reason);
  });
}

test("localized feed signals include English and Spanish", () => {
  assert.equal(policy.classifyTexts("You're all caught up", "en-US").caughtUp, true);
  assert.equal(policy.classifyTexts("Publicaciones sugeridas", "es").recommendation, true);
  assert.equal(policy.classifyTexts("Patrocinado", "es-MX").sponsored, true);
  assert.equal(policy.classifyTexts("A normal caption mentioning an ad campaign", "en").sponsored, false);
});

test("post identity handles post and Reel permalinks without retaining queries", () => {
  assert.equal(policy.getPostIdentity("/p/Post_123/?source=feed"), "p:Post_123");
  assert.equal(policy.getPostIdentity("/reel/Reel-123/"), "reel:Reel-123");
  assert.equal(policy.getPostIdentity("/friend/"), null);
});

test("cutoff copy states the observed reason honestly", () => {
  assert.match(policy.getEndCopy("caught_up"), /Instagram's caught-up point/);
  assert.match(policy.getEndCopy("recommendations"), /could verify/);
  assert.match(policy.getEndCopy("local_limit", 25), /after 25 viewed posts/);
});
