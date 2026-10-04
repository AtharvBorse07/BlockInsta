(function initializeCompatibility(root) {
  "use strict";

  const api = root.browser || root.chrome;
  const usesPromiseNamespace = Boolean(root.browser);

  function requireApi(value, name) {
    if (!value) {
      throw new Error(`Required WebExtension API is unavailable: ${name}`);
    }
    return value;
  }

  function lastRuntimeError() {
    return root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
  }

  function callbackCall(target, methodName, args) {
    return new Promise((resolve, reject) => {
      try {
        target[methodName](...args, (result) => {
          const error = lastRuntimeError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function promiseOrCallbackCall(target, methodName, args) {
    requireApi(target && target[methodName], methodName);
    if (usesPromiseNamespace) {
      return Promise.resolve(target[methodName](...args));
    }
    return callbackCall(target, methodName, args);
  }

  const compatibility = {
    api: requireApi(api, "browser/chrome"),

    storageGet(keys) {
      return promiseOrCallbackCall(api.storage.local, "get", [keys]);
    },

    storageSet(values) {
      return promiseOrCallbackCall(api.storage.local, "set", [values]);
    },

    getEnabledRulesets() {
      return promiseOrCallbackCall(
        api.declarativeNetRequest,
        "getEnabledRulesets",
        [],
      );
    },

    updateEnabledRulesets(options) {
      return promiseOrCallbackCall(
        api.declarativeNetRequest,
        "updateEnabledRulesets",
        [options],
      );
    },

    createAlarm(name, when) {
      requireApi(api.alarms && api.alarms.create, "alarms.create");
      const result = api.alarms.create(name, { when });
      return result && typeof result.then === "function"
        ? result
        : Promise.resolve();
    },

    clearAlarm(name) {
      return promiseOrCallbackCall(api.alarms, "clear", [name]);
    },

    sendMessage(message) {
      return promiseOrCallbackCall(api.runtime, "sendMessage", [message]);
    },
  };

  root.BlockInstaCompat = compatibility;
})(globalThis);

