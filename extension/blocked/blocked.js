(function initializeBlockedPage() {
  "use strict";

  const title = document.querySelector("#page-title");
  const message = document.querySelector("#page-message");
  const actionNote = document.querySelector("#action-note");
  const reason = new URLSearchParams(window.location.search).get("reason");

  if (reason === "next_reel") {
    title.textContent = "That is the end of this Reel";
    message.textContent = "You can watch one Reel you deliberately opened, but the next Reel would start an endless session.";
  }

  document.querySelector("#back-button").addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
    actionNote.textContent = "You can close this tab when you are ready.";
  });
})();
