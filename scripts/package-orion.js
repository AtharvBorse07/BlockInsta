"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createZip, listFiles } = require("./package-extension.js");
const {
  createOrionLayout,
  validateOrionExtension,
} = require("./orion-build.js");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist");

function listZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset <= buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push(buffer.subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assertZipEntries(entries) {
  if (!entries.includes("manifest.json")) {
    throw new Error("Orion ZIP does not contain manifest.json at its root.");
  }
  const forbidden = entries.filter((entry) => (
    entry === "background-v2.js"
    || entry === "rules.json"
    || entry.startsWith("_metadata/")
    || entry.startsWith("tests/")
    || entry.startsWith("scripts/")
    || entry.includes("research")
  ));
  if (forbidden.length > 0) {
    throw new Error(`Orion ZIP contains forbidden entries: ${forbidden.join(", ")}`);
  }
}

function packageOrion() {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "blockinsta-orion-package-"),
  );
  try {
    createOrionLayout(temporaryDirectory);
    const validation = validateOrionExtension(temporaryDirectory);
    if (validation.errors.length > 0) {
      throw new Error(
        `Orion extension validation failed:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`,
      );
    }

    const files = listFiles(temporaryDirectory);
    const archive = createZip(files);
    const entries = listZipEntries(archive);
    assertZipEntries(entries);
    if (entries.length !== files.length) {
      throw new Error("Orion ZIP entry count does not match its source layout.");
    }

    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(
      outputDirectory,
      `blockinsta-orion-v${validation.manifest.version}.zip`,
    );
    fs.writeFileSync(outputPath, archive);
    process.stdout.write(
      `Created ${path.relative(projectRoot, outputPath)} with ${entries.length} validated root-relative files.\n`,
    );
    return outputPath;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  packageOrion();
}

module.exports = {
  assertZipEntries,
  listZipEntries,
  packageOrion,
};
