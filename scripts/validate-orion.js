"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createOrionLayout,
  validateOrionExtension,
} = require("./orion-build.js");

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "blockinsta-orion-validate-"),
);

try {
  createOrionLayout(temporaryDirectory);
  const validation = validateOrionExtension(temporaryDirectory);
  if (validation.errors.length > 0) {
    process.stderr.write(
      `${validation.errors.map((error) => `- ${error}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Orion manifest, permissions, fallbacks, assets, and CSP are valid.\n",
    );
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
