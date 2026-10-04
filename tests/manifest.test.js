"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { validateExtension } = require("../scripts/validate-extension.js");

test("manifest and static redirect rule meet the security baseline", () => {
  const extensionDirectory = path.resolve(__dirname, "..", "extension");
  const result = validateExtension(extensionDirectory);
  assert.deepEqual(result.errors, []);
});

