"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createZip, listFiles } = require("../scripts/package-extension.js");
const {
  createOrionLayout,
  validateOrionExtension,
} = require("../scripts/orion-build.js");
const {
  assertZipEntries,
  listZipEntries,
} = require("../scripts/package-orion.js");

function withOrionLayout(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "blockinsta-orion-test-"),
  );
  try {
    createOrionLayout(directory);
    callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("Orion manifest has only intended APIs and Instagram access", () => {
  withOrionLayout((directory) => {
    const result = validateOrionExtension(directory);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.manifest.permissions, ["storage"]);
    assert.equal(result.manifest.background, undefined);
    assert.equal(result.manifest.declarative_net_request, undefined);
    assert.deepEqual(result.manifest.host_permissions, [
      "*://instagram.com/*",
      "*://*.instagram.com/*",
    ]);
  });
});

test("Orion layout excludes DNR, background, and browser metadata", () => {
  withOrionLayout((directory) => {
    assert.equal(fs.existsSync(path.join(directory, "rules.json")), false);
    assert.equal(fs.existsSync(path.join(directory, "background-v2.js")), false);
    assert.equal(fs.existsSync(path.join(directory, "_metadata")), false);
  });
});

test("Orion ZIP has a root manifest and only runtime files", () => {
  withOrionLayout((directory) => {
    const files = listFiles(directory);
    const entries = listZipEntries(createZip(files));
    assert.doesNotThrow(() => assertZipEntries(entries));
    assert.equal(entries[0].includes("/manifest.json"), false);
    assert.equal(entries.includes("manifest.json"), true);
    assert.equal(entries.length, files.length);
  });
});
