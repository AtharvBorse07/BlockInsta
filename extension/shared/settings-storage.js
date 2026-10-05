(function initializeSettingsStorage(root, factory) {
  "use strict";

  let settingsApi = root.BlockInstaSettings;
  if (!settingsApi && typeof require === "function") {
    settingsApi = require("./settings.js");
  }

  const storageApi = factory(settingsApi);
  root.BlockInstaSettingsStorage = storageApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = storageApi;
  }
})(globalThis, function createSettingsStorageApi(settingsApi) {
  "use strict";

  const STORAGE_KEY = "settings";

  function createSettingsStore(compatibility) {
    async function readNormalized() {
      const stored = await compatibility.storageGet([STORAGE_KEY]);
      const candidate = stored ? stored[STORAGE_KEY] : undefined;
      const normalized = settingsApi.normalizeSettings(candidate);

      if (!candidate || !settingsApi.equal(candidate, normalized)) {
        await compatibility.storageSet({ [STORAGE_KEY]: normalized });
      }

      return normalized;
    }

    async function writeNormalized(candidate) {
      const normalized = settingsApi.normalizeSettings(candidate);
      await compatibility.storageSet({ [STORAGE_KEY]: normalized });
      return normalized;
    }

    async function setEnabled(enabled) {
      const current = await readNormalized();
      return writeNormalized(settingsApi.setEnabled(current, enabled));
    }

    return Object.freeze({
      readNormalized,
      setEnabled,
      writeNormalized,
    });
  }

  return Object.freeze({ STORAGE_KEY, createSettingsStore });
});
