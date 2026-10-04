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

async function readNormalizedSettings(now = Date.now()) {
  const stored = await compat.storageGet([STORAGE_KEY]);
  const candidate = stored ? stored[STORAGE_KEY] : undefined;
  const normalized = settingsApi.normalizeSettings(candidate, now);

  if (!candidate || !settingsApi.equal(candidate, normalized)) {
    await compat.storageSet({ [STORAGE_KEY]: normalized });
  }

  return normalized;
}

async function saveSettings(settings) {
  await compat.storageSet({ [STORAGE_KEY]: settings });
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

async function applySettings(candidate, now = Date.now()) {
  const plan = blockingApi.getPlan(candidate, now);
  await saveSettings(plan.settings);
  await setRulesetEnabled(plan.shouldEnableRuleset);
  await compat.clearAlarm(blockingApi.EXPIRATION_ALARM);

  if (plan.alarmAt !== null) {
    await compat.createAlarm(blockingApi.EXPIRATION_ALARM, plan.alarmAt);
  }

  return blockingApi.getPublicStatus(plan.settings, now);
}

async function synchronize(now = Date.now()) {
  const settings = await readNormalizedSettings(now);
  return applySettings(settings, now);
}

async function handleMessage(message) {
  const now = Date.now();
  const current = await readNormalizedSettings(now);

  switch (message && message.type) {
    case "GET_STATUS":
      return applySettings(current, now);
    case "SET_ENABLED":
      return applySettings(
        settingsApi.setEnabled(current, message.enabled, now),
        now,
      );
    case "TEMPORARY_UNLOCK":
      return applySettings(
        settingsApi.startTemporaryUnlock(current, message.minutes, now),
        now,
      );
    case "REENABLE_NOW":
      return applySettings(settingsApi.reenableNow(current, now), now);
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

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === blockingApi.EXPIRATION_ALARM) {
    void serialize(() => synchronize());
  }
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

