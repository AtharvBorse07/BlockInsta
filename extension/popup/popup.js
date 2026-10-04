(function initializePopup() {
  "use strict";

  const compat = globalThis.BlockInstaCompat;
  const settingsApi = globalThis.BlockInstaSettings;
  const enabledToggle = document.querySelector("#enabled-toggle");
  const statusPanel = document.querySelector("#status-panel");
  const statusTitle = document.querySelector("#status-title");
  const statusDetail = document.querySelector("#status-detail");
  const unlockButtons = [...document.querySelectorAll("[data-unlock-minutes]")];
  const reenableButton = document.querySelector("#reenable-button");
  const errorMessage = document.querySelector("#error-message");

  let currentStatus = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    enabledToggle.disabled = value;
    unlockButtons.forEach((button) => {
      button.disabled = value || (currentStatus && !currentStatus.enabled);
    });
    reenableButton.disabled = value;
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  function render(status) {
    currentStatus = status;
    enabledToggle.checked = status.enabled;
    statusPanel.dataset.state = status.status;

    if (status.status === "active") {
      statusTitle.textContent = "Blocking is active";
      statusDetail.textContent = "Instagram visits will show the block page.";
      reenableButton.hidden = true;
    } else if (status.status === "temporarily_unlocked") {
      statusTitle.textContent = "Temporarily unlocked";
      statusDetail.textContent = `Blocking resumes in ${settingsApi.formatRemaining(
        status.unlockUntil - Date.now(),
      )}.`;
      reenableButton.hidden = false;
    } else {
      statusTitle.textContent = "Blocking is off";
      statusDetail.textContent = "Instagram is currently available.";
      reenableButton.hidden = true;
    }

    setBusy(busy);
  }

  async function send(message) {
    clearError();
    setBusy(true);
    try {
      const response = await compat.sendMessage(message);
      if (!response || !response.ok) {
        throw new Error(response && response.error
          ? response.error
          : "The extension did not respond.");
      }
      render(response.status);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      if (currentStatus) {
        render(currentStatus);
      }
    } finally {
      setBusy(false);
    }
  }

  enabledToggle.addEventListener("change", () => {
    void send({ type: "SET_ENABLED", enabled: enabledToggle.checked });
  });

  unlockButtons.forEach((button) => {
    button.addEventListener("click", () => {
      void send({
        type: "TEMPORARY_UNLOCK",
        minutes: Number(button.dataset.unlockMinutes),
      });
    });
  });

  reenableButton.addEventListener("click", () => {
    void send({ type: "REENABLE_NOW" });
  });

  window.setInterval(() => {
    if (!currentStatus || currentStatus.status !== "temporarily_unlocked") {
      return;
    }

    if (currentStatus.unlockUntil <= Date.now()) {
      void send({ type: "GET_STATUS" });
      return;
    }
    render(currentStatus);
  }, 1000);

  void send({ type: "GET_STATUS" });
})();

