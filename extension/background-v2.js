"use strict";

importScripts(
  "compatibility.js",
  "shared/settings.js",
  "shared/blocking.js",
);

const compat = globalThis.BlockInstaCompat;
const settingsApi = globalThis.BlockInstaSettings;
const blockingApi = globalThis.BlockInstaBlocking;
const api = compat.api;
const STORAGE_KEY = "settings";

let operationQueue = Promise.resolve();

function serialize(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => undefined);
  return result;
}

async function readNormalizedSettings() {
  const stored = await compat.storageGet([STORAGE_KEY]);
  const candidate = stored ? stored[STORAGE_KEY] : undefined;
  const normalized = settingsApi.normalizeSettings(candidate);

  if (!candidate || !settingsApi.equal(candidate, normalized)) {
    await compat.storageSet({ [STORAGE_KEY]: normalized });
  }

  return normalized;
}

async function setRulesetEnabled(enabled) {
  const enabledRulesets = await compat.getEnabledRulesets();
  const isEnabled = enabledRulesets.includes(blockingApi.RULESET_ID);
  if (isEnabled === enabled) {
    return;
  }

  await compat.updateEnabledRulesets({
    enableRulesetIds: enabled ? [blockingApi.RULESET_ID] : [],
    disableRulesetIds: enabled ? [] : [blockingApi.RULESET_ID],
  });
}

async function applySettings(candidate) {
  const plan = blockingApi.getPlan(candidate);
  await compat.storageSet({ [STORAGE_KEY]: plan.settings });
  await setRulesetEnabled(plan.shouldEnableRuleset);
  return blockingApi.getPublicStatus(plan.settings);
}

async function synchronize() {
  return applySettings(await readNormalizedSettings());
}

async function handleMessage(message) {
  const current = await readNormalizedSettings();

  switch (message && message.type) {
    case "GET_STATUS":
      return applySettings(current);
    case "SET_ENABLED":
      return applySettings(settingsApi.setEnabled(current, message.enabled));
    default:
      throw new Error("Unknown BlockInsta message.");
  }
}

api.runtime.onInstalled.addListener(() => {
  void serialize(() => synchronize());
});

api.runtime.onStartup.addListener(() => {
  void serialize(() => synchronize());
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  serialize(() => handleMessage(message)).then(
    (status) => sendResponse({ ok: true, status }),
    (error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return true;
});

void serialize(() => synchronize());
