"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateExtension } = require("../scripts/validate-extension.js");

const extensionDirectory = path.resolve(__dirname, "..", "extension");

test("manifest and static redirect rule meet the security baseline", () => {
  const result = validateExtension(extensionDirectory);
  assert.deepEqual(result.errors, []);
});

test("background does not access the removed alarms API", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(extensionDirectory, "manifest.json"),
    "utf8",
  ));
  const backgroundPath = manifest.background.service_worker;
  const background = fs.readFileSync(
    path.join(extensionDirectory, backgroundPath),
    "utf8",
  );

  assert.equal(backgroundPath, "background-v2.js");
  assert.equal(manifest.permissions.includes("alarms"), false);
  assert.doesNotMatch(background, /\b(?:api|chrome|browser)\.alarms\b|\bonAlarm\b/);
});

