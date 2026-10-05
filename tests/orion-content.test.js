"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const routes = require("../extension/shared/routes.js");

const contentSource = fs.readFileSync(
  path.resolve(__dirname, "..", "extension", "content", "instagram.js"),
  "utf8",
);
const contentCss = fs.readFileSync(
  path.resolve(__dirname, "..", "extension", "content", "instagram.css"),
  "utf8",
);

test("Orion collection policy handles direct, query, trailing, and SPA URLs", () => {
  const blocked = [
    "https://www.instagram.com/reels",
    "https://www.instagram.com/reels/",
    "https://m.instagram.com/reels/?source=spa",
    "https://instagram.com/REELS?next=1#viewer",
  ];
  blocked.forEach((url) => assert.equal(
    routes.isBlockedCollectionRoute(url),
    true,
    url,
  ));
  assert.equal(routes.isBlockedCollectionRoute(
    "https://www.instagram.com/reel/Allowed123/",
  ), false);
  assert.equal(routes.isBlockedCollectionRoute(
    "https://instagram.com.example.com/reels/",
  ), false);
});

test("content guard covers SPA, Back/Forward, BFCache, and visibility refresh", () => {
  assert.match(contentSource, /addEventListener\("popstate"/);
  assert.match(contentSource, /addEventListener\("pageshow"/);
  assert.match(contentSource, /addEventListener\("visibilitychange"/);
  assert.match(contentSource, /window\.navigation\.addEventListener\("navigate"/);
  assert.match(contentSource, /refreshSettings\(true\)/);
  assert.match(contentSource, /SETTINGS_CHECK_MS = 5000/);
});

test("touch continuation is actively intercepted without disabling controls", () => {
  assert.match(
    contentSource,
    /addEventListener\("touchmove", stopPaging, \{[\s\S]*?passive: false/,
  );
  assert.match(contentSource, /isEditable\(element\)/);
  assert.match(contentSource, /isIndependentlyScrollable\(element\)/);
});

test("missing extension-page URLs have an accessible inline fallback", () => {
  assert.match(contentSource, /compat\.runtimeGetURL/);
  assert.match(contentSource, /renderInlineBlockedPage/);
  assert.match(contentSource, /aria-labelledby/);
  assert.match(contentSource, /Open Messages/);
  assert.match(contentSource, /Open Home/);
  assert.match(contentCss, /data-blockinsta-inline-blocked/);
  assert.match(contentCss, /prefers-color-scheme: dark/);
});

test("feed end card stays within narrow mobile viewports", () => {
  assert.match(contentCss, /\.blockinsta-feed-end\s*\{[\s\S]*?box-sizing: border-box !important/);
  assert.match(contentCss, /max-width: min\(470px, calc\(100vw - 24px\)\) !important/);
  assert.match(contentCss, /@media \(max-width: 480px\)/);
  assert.match(contentCss, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(contentCss, /min-height: 46px !important/);
});
