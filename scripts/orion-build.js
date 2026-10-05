"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const extensionDirectory = path.join(projectRoot, "extension");
const orionDirectory = path.join(projectRoot, "orion");
const excludedExtensionPaths = new Set([
  "_metadata",
  "background-v2.js",
  "manifest.json",
  "rules.json",
]);

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function createOrionLayout(targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.cpSync(extensionDirectory, targetDirectory, {
    recursive: true,
    filter(source) {
      const relativePath = normalizeRelative(
        path.relative(extensionDirectory, source),
      );
      if (!relativePath) {
        return true;
      }
      const topLevel = relativePath.split("/")[0];
      return !excludedExtensionPaths.has(topLevel)
        && path.basename(relativePath) !== ".DS_Store";
    },
  });
  fs.copyFileSync(
    path.join(orionDirectory, "manifest.json"),
    path.join(targetDirectory, "manifest.json"),
  );
  fs.copyFileSync(
    path.join(orionDirectory, "orion.js"),
    path.join(targetDirectory, "orion.js"),
  );
  return targetDirectory;
}

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.basename(filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateOrionExtension(targetDirectory) {
  const errors = [];
  const manifest = readJson(path.join(targetDirectory, "manifest.json"), errors);
  if (!manifest) {
    return { errors, manifest: null };
  }

  const expect = (condition, message) => {
    if (!condition) {
      errors.push(message);
    }
  };
  const expectedHosts = new Set([
    "*://instagram.com/*",
    "*://*.instagram.com/*",
  ]);
  const actualHosts = new Set(manifest.host_permissions || []);
  const permissions = new Set(manifest.permissions || []);

  expect(manifest.manifest_version === 3, "Orion manifest_version must be 3.");
  expect(manifest.name === "BlockInsta for Orion",
    "Orion extension name must identify the Orion build.");
  expect(permissions.size === 1 && permissions.has("storage"),
    "Orion permissions must contain only storage.");
  expect(actualHosts.size === expectedHosts.size
    && [...expectedHosts].every((host) => actualHosts.has(host)),
  "Orion host access must be limited to Instagram and its subdomains.");
  expect(!manifest.background, "The Orion manifest must not register a background worker.");
  expect(!manifest.declarative_net_request,
    "The Orion manifest must not register Declarative Net Request rules.");
  expect(!JSON.stringify(manifest).includes("declarativeNetRequest"),
    "The Orion manifest must not request Declarative Net Request permission.");
  expect(!JSON.stringify(manifest).includes("<all_urls>"),
    "The Orion manifest must not request all-sites access.");

  const contentScript = (manifest.content_scripts || []).find(
    (entry) => (entry.js || []).includes("content/instagram.js"),
  );
  expect(Boolean(contentScript), "The Orion Instagram content script is required.");
  expect(Boolean(contentScript
    && contentScript.run_at === "document_start"
    && contentScript.all_frames === false),
  "The Orion guard must run at document_start in the top frame.");
  if (contentScript) {
    const scripts = contentScript.js || [];
    const expectedPrefix = [
      "orion.js",
      "compatibility.js",
      "shared/settings.js",
      "shared/settings-storage.js",
      "shared/routes.js",
    ];
    expect(expectedPrefix.every((script, index) => scripts[index] === script),
      "Orion compatibility, storage, and route modules must load first.");
  }

  const referencedFiles = [
    manifest.action && manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...(manifest.web_accessible_resources || []).flatMap(
      (resource) => resource.resources || [],
    ),
    ...(manifest.content_scripts || []).flatMap(
      (entry) => [...(entry.js || []), ...(entry.css || [])],
    ),
  ].filter(Boolean);
  for (const relativePath of referencedFiles) {
    expect(fs.existsSync(path.join(targetDirectory, relativePath)),
      `Orion manifest references missing file: ${relativePath}`);
  }

  for (const forbidden of ["_metadata", "background-v2.js", "rules.json"]) {
    expect(!fs.existsSync(path.join(targetDirectory, forbidden)),
      `Orion layout contains forbidden path: ${forbidden}`);
  }

  const popupHtml = fs.readFileSync(
    path.join(targetDirectory, "popup", "popup.html"),
    "utf8",
  );
  expect(popupHtml.includes("shared/settings-storage.js")
    && popupHtml.includes("popup-controller.js"),
  "The Orion popup must load the direct-storage fallback.");
  const csp = manifest.content_security_policy
    && manifest.content_security_policy.extension_pages;
  expect(typeof csp === "string" && csp.includes("script-src 'self'")
    && csp.includes("object-src 'none'"),
  "The Orion CSP must restrict scripts to self and objects to none.");

  return { errors, manifest };
}

module.exports = {
  createOrionLayout,
  validateOrionExtension,
};
