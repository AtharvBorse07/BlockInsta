(function initializeCompatibility(root) {
  "use strict";

  const api = root.browser || root.chrome || {};
  const usesPromiseNamespace = Boolean(root.browser);

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
    if (!target || typeof target[methodName] !== "function") {
      return Promise.reject(new Error(
        `WebExtension API is unavailable: ${methodName}`,
      ));
    }
    if (usesPromiseNamespace) {
      return Promise.resolve(target[methodName](...args));
    }
    return callbackCall(target, methodName, args);
  }

  const compatibility = {
    api,

    storageGet(keys) {
      return promiseOrCallbackCall(api.storage && api.storage.local, "get", [keys]);
    },

    storageSet(values) {
      return promiseOrCallbackCall(api.storage && api.storage.local, "set", [values]);
    },

    permissionsContains(options) {
      if (!api.permissions || !api.permissions.contains) {
        return Promise.resolve(null);
      }
      return promiseOrCallbackCall(api.permissions, "contains", [options]);
    },

    getEnabledRulesets() {
      if (!api.declarativeNetRequest
        || typeof api.declarativeNetRequest.getEnabledRulesets !== "function") {
        return Promise.resolve([]);
      }
      return promiseOrCallbackCall(
        api.declarativeNetRequest,
        "getEnabledRulesets",
        [],
      );
    },

    updateEnabledRulesets(options) {
      if (!api.declarativeNetRequest
        || typeof api.declarativeNetRequest.updateEnabledRulesets !== "function") {
        return Promise.resolve(false);
      }
      return promiseOrCallbackCall(
        api.declarativeNetRequest,
        "updateEnabledRulesets",
        [options],
      );
    },

    sendMessage(message) {
      return promiseOrCallbackCall(api.runtime, "sendMessage", [message]);
    },

    runtimeGetURL(path) {
      if (!api.runtime || typeof api.runtime.getURL !== "function") {
        return null;
      }
      try {
        return api.runtime.getURL(path);
      } catch {
        return null;
      }
    },
  };

  root.BlockInstaCompat = compatibility;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = compatibility;
  }
})(globalThis);

