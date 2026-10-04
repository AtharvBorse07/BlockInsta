(function initializeBlockedPage() {
  "use strict";

  const compat = globalThis.BlockInstaCompat;
  const settingsApi = globalThis.BlockInstaSettings;
  const activeActions = document.querySelector("#active-actions");
  const unlockedActions = document.querySelector("#unlocked-actions");
  const unlockedLabel = document.querySelector("#unlocked-label");
  const countdown = document.querySelector("#countdown");
  const actionNote = document.querySelector("#action-note");
  const errorMessage = document.querySelector("#error-message");
  const unlockButtons = [...document.querySelectorAll("[data-unlock-minutes]")];
  const backButtons = [
    document.querySelector("#back-button"),
    document.querySelector("#unlocked-back-button"),
  ];
  const reenableButton = document.querySelector("#reenable-button");

  let currentStatus = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    unlockButtons.forEach((button) => {
      button.disabled = value;
    });
    reenableButton.disabled = value;
  }

  function render(status) {
    currentStatus = status;
    const unlocked = status.status !== "active";
    activeActions.hidden = unlocked;
    unlockedActions.hidden = !unlocked;

    if (status.status === "temporarily_unlocked") {
      unlockedLabel.textContent = "Temporarily unlocked";
      countdown.textContent = settingsApi.formatRemaining(
        status.unlockUntil - Date.now(),
      );
    } else if (status.status === "disabled") {
      unlockedLabel.textContent = "Blocking is off";
      countdown.textContent = "Off";
    }
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.close();
    actionNote.textContent = "You can close this tab when you’re ready.";
  }

  async function send(message) {
    errorMessage.hidden = true;
    errorMessage.textContent = "";
    setBusy(true);
    try {
      const response = await compat.sendMessage(message);
      if (!response || !response.ok) {
        throw new Error(response && response.error
          ? response.error
          : "The extension did not respond.");
      }
      render(response.status);
      return response.status;
    } catch (error) {
      errorMessage.textContent = error instanceof Error ? error.message : String(error);
      errorMessage.hidden = false;
      return null;
    } finally {
      setBusy(false);
    }
  }

  backButtons.forEach((button) => button.addEventListener("click", goBack));

  unlockButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const status = await send({
        type: "TEMPORARY_UNLOCK",
        minutes: Number(button.dataset.unlockMinutes),
      });
      if (status) {
        actionNote.textContent = "Instagram is available until the timer ends.";
      }
    });
  });

  reenableButton.addEventListener("click", async () => {
    const status = await send({ type: "REENABLE_NOW" });
    if (status) {
      actionNote.textContent = "Blocking is active again.";
    }
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

