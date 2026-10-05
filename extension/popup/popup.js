(function initializePopup() {
  "use strict";

  const compat = globalThis.BlockInstaCompat;
  const controller = globalThis.BlockInstaPopupController
    .createPopupController(compat);
  const enabledToggle = document.querySelector("#enabled-toggle");
  const statusPanel = document.querySelector("#status-panel");
  const statusTitle = document.querySelector("#status-title");
  const statusDetail = document.querySelector("#status-detail");
  const errorMessage = document.querySelector("#error-message");
  const INSTAGRAM_ORIGINS = [
    "*://instagram.com/*",
    "*://*.instagram.com/*",
  ];

  let currentStatus = null;
  let permissionGranted = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    enabledToggle.disabled = value;
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  function render() {
    if (!currentStatus) {
      return;
    }

    enabledToggle.checked = currentStatus.enabled;
    if (currentStatus.enabled && permissionGranted === false) {
      statusPanel.dataset.state = "permission_missing";
      statusTitle.textContent = "Instagram access is not granted";
      statusDetail.textContent = "Allow this extension on instagram.com in your browser settings.";
    } else if (currentStatus.enabled) {
      statusPanel.dataset.state = "active";
      statusTitle.textContent = "Endless feeds are blocked";
      statusDetail.textContent = "Home is finite and Search opens without its discovery feed. Messages, profiles, search results, and one deliberately opened Reel remain available.";
    } else {
      statusPanel.dataset.state = "disabled";
      statusTitle.textContent = "Blocking is off";
      statusDetail.textContent = "Instagram's ordinary Home, Search discovery, and Reels experiences are currently available.";
    }
    setBusy(busy);
  }

  async function refreshPermission() {
    try {
      permissionGranted = await compat.permissionsContains({
        origins: INSTAGRAM_ORIGINS,
      });
    } catch {
      permissionGranted = null;
    }
  }

  async function refreshStatus(enabled) {
    clearError();
    setBusy(true);
    try {
      const [status] = await Promise.all([
        typeof enabled === "boolean"
          ? controller.setEnabled(enabled)
          : controller.getStatus(),
        refreshPermission(),
      ]);
      currentStatus = status;
      render();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      render();
    } finally {
      setBusy(false);
    }
  }

  enabledToggle.addEventListener("change", () => {
    void refreshStatus(enabledToggle.checked);
  });

  void refreshStatus();
})();
