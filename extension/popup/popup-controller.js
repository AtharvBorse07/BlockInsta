(function initializePopupController(root, factory) {
  "use strict";

  let settingsStorageApi = root.BlockInstaSettingsStorage;
  let blockingApi = root.BlockInstaBlocking;
  if (typeof require === "function") {
    settingsStorageApi ||= require("../shared/settings-storage.js");
    blockingApi ||= require("../shared/blocking.js");
  }

  const controllerApi = factory(settingsStorageApi, blockingApi);
  root.BlockInstaPopupController = controllerApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = controllerApi;
  }
})(globalThis, function createPopupControllerApi(
  settingsStorageApi,
  blockingApi,
) {
  "use strict";

  function createPopupController(compatibility) {
    const store = settingsStorageApi.createSettingsStore(compatibility);

    async function getStatus() {
      return blockingApi.getPublicStatus(await store.readNormalized());
    }

    async function setEnabled(enabled) {
      const settings = await store.setEnabled(enabled);
      try {
        await compatibility.sendMessage({ type: "SYNC_SETTINGS" });
      } catch {
        // Orion may not provide a background message target. Storage is authoritative.
      }
      return blockingApi.getPublicStatus(settings);
    }

    return Object.freeze({ getStatus, setEnabled });
  }

  return Object.freeze({ createPopupController });
});
