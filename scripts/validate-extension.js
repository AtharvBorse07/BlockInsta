"use strict";

const fs = require("node:fs");
const path = require("node:path");

const defaultExtensionDirectory = path.resolve(__dirname, "..", "extension");

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.basename(filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateExtension(extensionDirectory = defaultExtensionDirectory) {
  const errors = [];
  const manifestPath = path.join(extensionDirectory, "manifest.json");
  const manifest = readJson(manifestPath, errors);

  if (!manifest) {
    return { errors, manifest: null, rules: null };
  }

  const expect = (condition, message) => {
    if (!condition) {
      errors.push(message);
    }
  };

  expect(manifest.manifest_version === 3, "manifest_version must be 3.");
  expect(manifest.name === "BlockInsta", "Extension name must be BlockInsta.");
  expect(typeof manifest.description === "string"
    && manifest.description.length <= 132,
  "Manifest description must fit the 132-character WebExtension limit.");
  expect(Boolean(manifest.background && manifest.background.service_worker),
    "A background service worker is required.");

  const permissions = new Set(manifest.permissions || []);
  const expectedPermissions = [
    "storage",
    "declarativeNetRequestWithHostAccess",
  ];
  expect(permissions.size === expectedPermissions.length
    && expectedPermissions.every((permission) => permissions.has(permission)),
  "Permissions must be limited to storage and declarativeNetRequestWithHostAccess.");

  const expectedHosts = new Set([
    "*://instagram.com/*",
    "*://*.instagram.com/*",
  ]);
  const actualHosts = new Set(manifest.host_permissions || []);
  expect(actualHosts.size === expectedHosts.size
    && [...expectedHosts].every((host) => actualHosts.has(host)),
  "Host permissions must be limited to instagram.com and its subdomains.");
  expect(!JSON.stringify(manifest).includes("<all_urls>"),
    "The extension must never request <all_urls>.");

  const ruleResource = manifest.declarative_net_request
    && manifest.declarative_net_request.rule_resources
    && manifest.declarative_net_request.rule_resources.find(
      (resource) => resource.id === "instagram_rules",
    );
  expect(Boolean(ruleResource), "The instagram_rules static ruleset is required.");
  expect(Boolean(ruleResource && ruleResource.enabled),
    "The Instagram ruleset must be enabled on installation.");

  let rules = null;
  if (ruleResource) {
    rules = readJson(path.join(extensionDirectory, ruleResource.path), errors);
  }
  const redirectRule = Array.isArray(rules)
    ? rules.find((rule) => rule.id === 1)
    : null;
  expect(Boolean(redirectRule), "Blocking rule 1 is required.");
  expect(Boolean(redirectRule
    && redirectRule.action
    && redirectRule.action.type === "redirect"
    && redirectRule.action.redirect.extensionPath === "/blocked/blocked.html"),
  "Blocking rule must redirect to /blocked/blocked.html.");
  expect(Boolean(redirectRule
    && redirectRule.condition
    && redirectRule.condition.regexFilter
      === "^https?://([a-z0-9-]+\\.)*instagram\\.com/reels/?(\\?.*)?$"
    && redirectRule.condition.isUrlFilterCaseSensitive === false),
  "Blocking rule must match only the exact Instagram Reels collection route.");
  expect(Boolean(redirectRule
    && Array.isArray(redirectRule.condition.resourceTypes)
    && redirectRule.condition.resourceTypes.length === 1
    && redirectRule.condition.resourceTypes[0] === "main_frame"),
  "Blocking rule must affect top-level navigation only.");

  const instagramContentScript = (manifest.content_scripts || []).find(
    (entry) => (entry.js || []).includes("content/instagram.js"),
  );
  expect(Boolean(instagramContentScript),
    "The Instagram content script is required for SPA navigation.");
  expect(Boolean(instagramContentScript
    && instagramContentScript.run_at === "document_start"
    && instagramContentScript.all_frames === false),
  "The Instagram content script must run at document_start in the top frame.");
  expect(Boolean(instagramContentScript
    && (instagramContentScript.js || []).includes("shared/routes.js")
    && (instagramContentScript.js || []).includes("shared/feed-policy.js")
    && (instagramContentScript.js || []).includes("content/feed-guard.js")
    && (instagramContentScript.js || []).includes("shared/search-policy.js")
    && (instagramContentScript.js || []).includes("content/search-guard.js")
    && (instagramContentScript.css || []).includes("content/instagram.css")),
  "The Instagram content script must include route/feed/search policies, both guards, and early CSS.");

  if (instagramContentScript) {
    const scripts = instagramContentScript.js || [];
    expect(scripts.indexOf("shared/feed-policy.js")
      < scripts.indexOf("content/feed-guard.js")
      && scripts.indexOf("content/feed-guard.js")
        < scripts.indexOf("shared/search-policy.js")
      && scripts.indexOf("shared/search-policy.js")
        < scripts.indexOf("content/search-guard.js")
      && scripts.indexOf("content/search-guard.js")
        < scripts.indexOf("content/instagram.js"),
    "Feed/Search policies and guards must load before the Instagram controller.");

    const feedGuardPath = path.join(extensionDirectory, "content", "feed-guard.js");
    if (fs.existsSync(feedGuardPath)) {
      const feedGuardSource = fs.readFileSync(feedGuardPath, "utf8");
      expect(!/\b(?:fetch|XMLHttpRequest)\s*\(/.test(feedGuardSource),
        "The feed guard must not intercept or issue Instagram API requests.");
    }

    const searchGuardPath = path.join(
      extensionDirectory,
      "content",
      "search-guard.js",
    );
    if (fs.existsSync(searchGuardPath)) {
      const searchGuardSource = fs.readFileSync(searchGuardPath, "utf8");
      expect(!/\b(?:fetch|XMLHttpRequest)\s*\(/.test(searchGuardSource),
        "The Search guard must not intercept or issue Instagram API requests.");
    }
  }

  const referencedFiles = [
    manifest.background && manifest.background.service_worker,
    manifest.action && manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...(manifest.declarative_net_request?.rule_resources || []).map(
      (resource) => resource.path,
    ),
    ...(manifest.web_accessible_resources || []).flatMap(
      (resource) => resource.resources || [],
    ),
    ...(manifest.content_scripts || []).flatMap(
      (entry) => [...(entry.js || []), ...(entry.css || [])],
    ),
  ].filter(Boolean);

  for (const relativePath of referencedFiles) {
    expect(fs.existsSync(path.join(extensionDirectory, relativePath)),
      `Manifest references missing file: ${relativePath}`);
  }

  const csp = manifest.content_security_policy
    && manifest.content_security_policy.extension_pages;
  expect(typeof csp === "string" && csp.includes("script-src 'self'")
    && csp.includes("object-src 'none'"),
  "Content Security Policy must restrict scripts to self and objects to none.");

  for (const directory of ["popup", "blocked"]) {
    const htmlFiles = fs.readdirSync(path.join(extensionDirectory, directory))
      .filter((file) => file.endsWith(".html"));
    for (const htmlFile of htmlFiles) {
      const html = fs.readFileSync(
        path.join(extensionDirectory, directory, htmlFile),
        "utf8",
      );
      expect(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
        `${directory}/${htmlFile} contains an inline script.`);
      expect(!/<(?:img|script|link)[^>]+(?:src|href)=["']https?:/i.test(html),
        `${directory}/${htmlFile} loads a remote asset.`);
    }
  }

  return { errors, manifest, rules };
}

if (require.main === module) {
  const result = validateExtension();
  if (result.errors.length > 0) {
    process.stderr.write(`${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Manifest, permissions, rules, assets, and CSP are valid.\n");
  }
}

module.exports = { validateExtension };

