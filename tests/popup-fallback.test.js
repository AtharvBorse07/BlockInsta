"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../extension/shared/settings.js");
const popup = require("../extension/popup/popup-controller.js");

function createCompatibility() {
  const values = { settings: { ...settings.DEFAULT_SETTINGS } };
  return {
    values,
    async storageGet() {
      return { ...values };
    },
    async storageSet(nextValues) {
      Object.assign(values, nextValues);
    },
    async sendMessage() {
      throw new Error("No background message target");
    },
  };
}

test("popup master switch works when background messaging is unavailable", async () => {
  const compatibility = createCompatibility();
  const controller = popup.createPopupController(compatibility);
  assert.equal((await controller.getStatus()).enabled, true);
  const status = await controller.setEnabled(false);
  assert.equal(status.enabled, false);
  assert.equal(status.status, "disabled");
  assert.equal(compatibility.values.settings.enabled, false);
});
