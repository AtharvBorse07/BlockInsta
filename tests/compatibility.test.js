"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const compatibilitySource = fs.readFileSync(
  path.resolve(__dirname, "..", "extension", "compatibility.js"),
  "utf8",
);

function loadCompatibility(candidate = {}) {
  const context = vm.createContext({
    ...candidate,
    Error,
    Promise,
  });
  context.globalThis = context;
  vm.runInContext(compatibilitySource, context);
  return context.BlockInstaCompat;
}

test("missing Declarative Net Request is a safe no-op", async () => {
  const compatibility = loadCompatibility({ chrome: { runtime: {} } });
  assert.equal((await compatibility.getEnabledRulesets()).length, 0);
  assert.equal(await compatibility.updateEnabledRulesets({}), false);
});

test("missing runtime messaging and extension URLs are detected", async () => {
  const compatibility = loadCompatibility({ chrome: {} });
  assert.equal(compatibility.runtimeGetURL("blocked/blocked.html"), null);
  await assert.rejects(
    compatibility.sendMessage({ type: "GET_STATUS" }),
    /WebExtension API is unavailable: sendMessage/,
  );
});
