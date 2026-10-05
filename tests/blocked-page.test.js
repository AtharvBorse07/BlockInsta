"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const blockedDirectory = path.resolve(__dirname, "..", "extension", "blocked");
const blockedHtml = fs.readFileSync(path.join(blockedDirectory, "blocked.html"), "utf8");
const blockedScript = fs.readFileSync(path.join(blockedDirectory, "blocked.js"), "utf8");

test("blocked-page exits are native links to allowed Instagram destinations", () => {
  const destinations = [
    ["messages-link", "https://www.instagram.com/direct/inbox/"],
    ["following-link", "https://www.instagram.com/?variant=following"],
    ["home-link", "https://www.instagram.com/"],
  ];

  for (const [id, url] of destinations) {
    assert.match(blockedHtml, new RegExp(`<a\\s+id="${id}"[^>]+href="${url.replace(/[.?]/g, "\\$&")}"`));
  }

  assert.doesNotMatch(blockedScript, /window\.location\.assign/);
});
