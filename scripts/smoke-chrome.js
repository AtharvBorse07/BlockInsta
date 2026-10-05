"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const extensionDirectory = path.join(projectRoot, "extension");
const manifest = JSON.parse(fs.readFileSync(
  path.join(extensionDirectory, "manifest.json"),
  "utf8",
));
const serviceWorkerPath = manifest.background.service_worker;

function chromeCandidates() {
  const candidates = [process.env.CHROME_PATH];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env.ProgramFiles || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
    );
  }
  return candidates.filter(Boolean);
}

function findChrome() {
  const executable = chromeCandidates().find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error("A Chromium-based browser was not found. Set CHROME_PATH to run this smoke test.");
  }
  return executable;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFile(filePath, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before opening DevTools (code ${child.exitCode}).`);
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's DevTools port.");
}

async function waitForServiceWorker(port, expectedPath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const worker = targets.find((target) => target.type === "service_worker"
      && target.url.endsWith(`/${expectedPath}`));
    if (worker) {
      return worker;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the BlockInsta service worker.");
}

async function waitForTarget(port, targetId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const target = targets.find((entry) => entry.id === targetId);
    if (target) {
      return target;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for the feed smoke-test page.");
}

function sendCdpCommand(webSocketUrl, method, params = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const requestId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for the DevTools ${method} command.`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // The browser can close its socket before acknowledging Browser.close.
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: requestId,
        method,
        params,
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== requestId) {
        return;
      }
      if (message.error) {
        finish(new Error(message.error.message));
        return;
      }
      finish(null, message.result);
    });

    socket.addEventListener("error", () => {
      finish(new Error("Could not connect to Chromium DevTools."));
    });

    socket.addEventListener("close", () => {
      if (method === "Browser.close") {
        finish(null, {});
      } else {
        finish(new Error(`DevTools closed before completing ${method}.`));
      }
    });
  });
}

async function evaluate(webSocketUrl, expression) {
  const message = await sendCdpCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const result = message && message.result;
  if (!result || result.exceptionDetails) {
    throw new Error("Chromium failed to evaluate the DNR smoke check.");
  }
  return result.value;
}

async function stopChrome(child, browserWebSocketUrl) {
  if (child.exitCode !== null) {
    return;
  }
  try {
    if (browserWebSocketUrl) {
      await sendCdpCommand(browserWebSocketUrl, "Browser.close", {}, 3_000);
    }
  } catch {
    child.kill();
  }
  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await delay(50);
  }
  if (child.exitCode === null) {
    child.kill();
  }
}

async function runFeedDomSmoke(browserWebSocketUrl, port) {
  const policySource = fs.readFileSync(
    path.join(extensionDirectory, "shared", "feed-policy.js"),
    "utf8",
  );
  const guardSource = fs.readFileSync(
    path.join(extensionDirectory, "content", "feed-guard.js"),
    "utf8",
  );
  const feedCss = fs.readFileSync(
    path.join(extensionDirectory, "content", "instagram.css"),
    "utf8",
  );
  const created = await sendCdpCommand(
    browserWebSocketUrl,
    "Target.createTarget",
    { url: "about:blank" },
  );
  const target = await waitForTarget(port, created.targetId);
  const expression = `(async () => {
    (0, eval)(${JSON.stringify(policySource)});
    (0, eval)(${JSON.stringify(guardSource)});
    const feedStyle = document.createElement("style");
    feedStyle.textContent = ${JSON.stringify(feedCss)};
    document.head.append(feedStyle);

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const settings = {
      enabled: true,
      limitHomeFeed: true,
      preferFollowingFeed: true
    };
    const makeWindow = () => {
      const values = new Map();
      return {
        location: {
          href: "https://www.instagram.com/?variant=following",
          reload() {},
          replace(value) { this.href = value; }
        },
        sessionStorage: {
          getItem(key) { return values.has(key) ? values.get(key) : null; },
          removeItem(key) { values.delete(key); },
          setItem(key, value) { values.set(key, String(value)); }
        },
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window)
      };
    };
    const article = (id, label = "") => \`<article id="\${id}">
      <header><a href="https://www.instagram.com/p/\${id}/">friend</a><span>\${label}</span></header>
      <time datetime="2026-10-04T12:00:00Z"></time>
    </article>\`;
    const settle = async () => {
      await nextFrame();
      await nextFrame();
      await nextFrame();
    };

    document.documentElement.lang = "en";
    document.body.innerHTML = \`<main style="display:grid;grid-template-columns:500px 240px;gap:80px">
      <div id="right-rail" style="grid-column:2;grid-row:1"><span>Suggested for you</span></div>
      <section id="feed-column" style="grid-column:1;grid-row:1">
        \${article("first")}
        \${article("suggested", "Suggested for you")}
        \${article("second")}
        <div id="caught-up"><span>You're all caught up</span><button id="view-older">View older posts</button></div>
        \${article("later")}
        <div role="progressbar" id="spinner"></div>
      </section>
    </main>\`;
    let guard = globalThis.BlockInstaFeedGuard.createFeedGuard({
      window: makeWindow(),
      document
    });
    guard.updateSettings(settings);
    await settle();
    document.querySelector("[data-blockinsta-feed-end]").remove();
    document.querySelector("#feed-column").insertAdjacentHTML(
      "beforeend",
      article("appended-after-rerender"),
    );
    const appendedImmediateDisplay = getComputedStyle(
      document.querySelector("#appended-after-rerender"),
    ).display;
    await settle();
    const markerCase = {
      state: guard.getState(),
      endCards: document.querySelectorAll("[data-blockinsta-feed-end]").length,
      feedColumnMarked: document.querySelector("#feed-column").dataset.blockinstaFeedColumn,
      appendedImmediateDisplay,
      appendedHidden: document.querySelector("#appended-after-rerender").dataset.blockinstaAfterCutoff,
      suggestedHidden: document.querySelector("#suggested").dataset.blockinstaFeedHidden,
      laterHidden: document.querySelector("#later").dataset.blockinstaAfterCutoff,
      firstHidden: document.querySelector("#first").dataset.blockinstaAfterCutoff || null,
      spinnerHidden: document.querySelector("#spinner").dataset.blockinstaAfterCutoff
    };
    guard.destroy();
    markerCase.controlRestored = !document.querySelector("#view-older").hasAttribute("aria-disabled")
      && !document.querySelector("#view-older").hasAttribute("tabindex");

    document.body.innerHTML = \`<main>\${Array.from(
      { length: 26 },
      (_, index) => article(\`post-\${index + 1}\`),
    ).join("")}</main>\`;
    guard = globalThis.BlockInstaFeedGuard.createFeedGuard({
      window: makeWindow(),
      document
    });
    guard.updateSettings(settings);
    await settle();
    const limitCase = {
      state: guard.getState(),
      endCards: document.querySelectorAll("[data-blockinsta-feed-end]").length,
      twentyFifthHidden: document.querySelector("#post-25").dataset.blockinstaAfterCutoff || null,
      twentySixthHidden: document.querySelector("#post-26").dataset.blockinstaAfterCutoff
    };
    guard.destroy();
    return { markerCase, limitCase };
  })()`;
  const result = await evaluate(target.webSocketDebuggerUrl, expression);
  const marker = result.markerCase;
  const limit = result.limitCase;
  const validMarker = marker.state.state === "cutoff_reached"
    && marker.state.cutoffReason === "caught_up"
    && marker.endCards === 1
    && marker.feedColumnMarked === "true"
    && marker.appendedImmediateDisplay === "none"
    && marker.appendedHidden === "true"
    && marker.suggestedHidden === "suggested"
    && marker.laterHidden === "true"
    && marker.firstHidden === null
    && marker.spinnerHidden === "true"
    && marker.controlRestored === true;
  const validLimit = limit.state.state === "cutoff_reached"
    && limit.state.cutoffReason === "local_limit"
    && limit.state.acceptedCount === 25
    && limit.endCards === 1
    && limit.twentyFifthHidden === null
    && limit.twentySixthHidden === "true";
  if (!validMarker || !validLimit) {
    throw new Error(`Chrome feed DOM mismatch: ${JSON.stringify(result)}`);
  }
}

async function runSearchDomSmoke(browserWebSocketUrl, port) {
  const policySource = fs.readFileSync(
    path.join(extensionDirectory, "shared", "search-policy.js"),
    "utf8",
  );
  const guardSource = fs.readFileSync(
    path.join(extensionDirectory, "content", "search-guard.js"),
    "utf8",
  );
  const searchCss = fs.readFileSync(
    path.join(extensionDirectory, "content", "instagram.css"),
    "utf8",
  );
  const created = await sendCdpCommand(
    browserWebSocketUrl,
    "Target.createTarget",
    { url: "about:blank" },
  );
  const target = await waitForTarget(port, created.targetId);
  const expression = `(async () => {
    (0, eval)(${JSON.stringify(policySource)});
    (0, eval)(${JSON.stringify(guardSource)});
    const searchStyle = document.createElement("style");
    searchStyle.textContent = ${JSON.stringify(searchCss)};
    document.head.append(searchStyle);

    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const settle = async () => {
      await nextFrame();
      await nextFrame();
      await nextFrame();
    };
    const location = { href: "https://www.instagram.com/explore/" };
    const fakeWindow = {
      location,
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window)
    };
    const settings = { enabled: true, hideSearchDiscovery: true };
    const guard = globalThis.BlockInstaSearchGuard.createSearchGuard({
      window: fakeWindow,
      document
    });
    guard.updateSettings(settings);

    document.body.innerHTML = \`<main id="search-main" style="height:800px;display:flex;flex-direction:column;justify-content:center">
      <header role="search">
        <input id="search-input" type="search" aria-label="Search" aria-controls="results">
      </header>
      <section id="discovery">
        <a href="https://www.instagram.com/p/Idle1/"><img alt=""></a>
        <a href="https://www.instagram.com/reel/Idle2/"><img alt=""></a>
        <a href="https://www.instagram.com/p/Idle3/"><img alt=""></a>
        <a href="https://www.instagram.com/p/Idle4/"><img alt=""></a>
      </section>
      <div id="discovery-loader" role="progressbar"></div>
      <div id="results" role="listbox" hidden>
        <a role="option" href="https://www.instagram.com/fake_account/">fake account</a>
      </div>
      <div id="status" role="status" hidden>No results</div>
      <div role="dialog" id="viewer">
        <a href="https://www.instagram.com/p/Dialog1/">dialog post</a>
        <a href="https://www.instagram.com/p/Dialog2/">dialog post</a>
        <a href="https://www.instagram.com/p/Dialog3/">dialog post</a>
      </div>
    </main>\`;
    const main = document.querySelector("#search-main");
    const discovery = document.querySelector("#discovery");
    const loader = document.querySelector("#discovery-loader");
    const input = document.querySelector("#search-input");
    const results = document.querySelector("#results");
    const status = document.querySelector("#status");
    const viewer = document.querySelector("#viewer");
    guard.handleDocumentMutations([{
      target: document.body,
      addedNodes: [main]
    }]);
    const initial = {
      immediateDisplay: getComputedStyle(discovery).display,
      inputDisplay: getComputedStyle(input).display,
      loaderDisplay: getComputedStyle(loader).display,
      mainJustifyContent: getComputedStyle(main).justifyContent,
      viewerMarked: viewer.hasAttribute("data-blockinsta-search-discovery")
    };
    await settle();
    initial.state = guard.getState();

    results.hidden = false;
    input.focus();
    await settle();
    const focused = {
      discoveryDisplay: getComputedStyle(discovery).display,
      resultsDisplay: getComputedStyle(results).display,
      state: guard.getState()
    };

    input.value = "cats";
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "cats"
    }));
    await settle();
    const typed = {
      discoveryDisplay: getComputedStyle(discovery).display,
      resultsDisplay: getComputedStyle(results).display,
      state: guard.getState()
    };

    results.hidden = true;
    status.hidden = false;
    input.setAttribute("aria-controls", "discovery");
    discovery.append(document.createElement("span"));
    await settle();
    const reusedForResults = {
      display: getComputedStyle(discovery).display,
      marked: discovery.hasAttribute("data-blockinsta-search-discovery"),
      statusDisplay: getComputedStyle(status).display
    };

    status.hidden = true;
    input.value = "";
    input.setAttribute("aria-controls", "results");
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward"
    }));
    input.blur();
    await settle();
    const cleared = {
      display: getComputedStyle(discovery).display,
      marked: discovery.dataset.blockinstaSearchDiscovery,
      state: guard.getState()
    };

    status.hidden = false;
    await settle();
    const systemState = {
      discoveryDisplay: getComputedStyle(discovery).display,
      statusDisplay: getComputedStyle(status).display
    };

    guard.updateSettings({ enabled: false, hideSearchDiscovery: true });
    const disabled = {
      display: getComputedStyle(discovery).display,
      mainJustifyContent: getComputedStyle(main).justifyContent,
      marked: discovery.hasAttribute("data-blockinsta-search-discovery"),
      rootEnabled: document.documentElement.hasAttribute(
        "data-blockinsta-hide-search-discovery",
      )
    };

    status.hidden = true;
    guard.updateSettings(settings);
    await settle();
    const reenabled = {
      display: getComputedStyle(discovery).display,
      state: guard.getState()
    };

    location.href = "https://www.instagram.com/direct/inbox/";
    guard.handleLocation();
    const routeExit = {
      display: getComputedStyle(discovery).display,
      mainJustifyContent: getComputedStyle(main).justifyContent,
      state: guard.getState(),
      rootEnabled: document.documentElement.hasAttribute(
        "data-blockinsta-hide-search-discovery",
      )
    };
    guard.destroy();
    return {
      cleared,
      disabled,
      focused,
      initial,
      reenabled,
      reusedForResults,
      routeExit,
      systemState,
      typed
    };
  })()`;
  const result = await evaluate(target.webSocketDebuggerUrl, expression);
  const valid = result.initial.immediateDisplay === "none"
    && result.initial.inputDisplay !== "none"
    && result.initial.loaderDisplay === "none"
    && result.initial.mainJustifyContent === "flex-start"
    && result.initial.viewerMarked === false
    && result.initial.state.state === "discovery_hidden"
    && result.initial.state.discoveryCount === 1
    && result.focused.discoveryDisplay === "none"
    && result.focused.resultsDisplay !== "none"
    && result.focused.state.state === "search_active"
    && result.typed.discoveryDisplay === "none"
    && result.typed.resultsDisplay !== "none"
    && result.typed.state.state === "search_active"
    && result.reusedForResults.display !== "none"
    && result.reusedForResults.marked === false
    && result.reusedForResults.statusDisplay !== "none"
    && result.cleared.display === "none"
    && result.cleared.marked === "true"
    && result.cleared.state.state === "discovery_hidden"
    && result.systemState.discoveryDisplay === "none"
    && result.systemState.statusDisplay !== "none"
    && result.disabled.display !== "none"
    && result.disabled.mainJustifyContent === "center"
    && result.disabled.marked === false
    && result.disabled.rootEnabled === false
    && result.reenabled.display === "none"
    && result.reenabled.state.state === "discovery_hidden"
    && result.routeExit.display !== "none"
    && result.routeExit.mainJustifyContent === "center"
    && result.routeExit.state.state === "inactive"
    && result.routeExit.rootEnabled === false;
  if (!valid) {
    throw new Error(`Chrome Search DOM mismatch: ${JSON.stringify(result)}`);
  }
}

async function main() {
  const executable = findChrome();
  const profileDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "blockinsta-chrome-smoke-"),
  );
  const activePortPath = path.join(profileDirectory, "DevToolsActivePort");
  const child = spawn(executable, [
    "--headless=new",
    "--disable-background-mode",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-extensions-except=" + extensionDirectory,
    "--disable-gpu",
    "--load-extension=" + extensionDirectory,
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profileDirectory,
    "about:blank",
  ], {
    stdio: "ignore",
    windowsHide: true,
  });
  let browserWebSocketUrl = null;

  try {
    await waitForFile(activePortPath, child);
    const [port, browserPath] = fs.readFileSync(activePortPath, "utf8")
      .trim()
      .split(/\r?\n/);
    browserWebSocketUrl = `ws://127.0.0.1:${port}${browserPath}`;
    const worker = await waitForServiceWorker(port, serviceWorkerPath);
    await evaluate(worker.webSocketDebuggerUrl, "1 + 1");
    const cases = [
      ["https://www.instagram.com/reels/", true],
      ["https://www.instagram.com/reels/?source=nav", true],
      ["https://www.instagram.com/", false],
      ["https://www.instagram.com/?variant=following", false],
      ["https://www.instagram.com/direct/inbox/", false],
      ["https://www.instagram.com/reel/Shared123/", false],
    ];
    const expression = `(async () => {
      const cases = ${JSON.stringify(cases)};
      const results = [];
      for (const [url, expected] of cases) {
        const outcome = await chrome.declarativeNetRequest.testMatchOutcome({
          url,
          type: "main_frame"
        });
        results.push({ url, expected, matched: outcome.matchedRules.length > 0 });
      }
      return results;
    })()`;
    const results = await evaluate(worker.webSocketDebuggerUrl, expression);
    const failures = results.filter((entry) => entry.matched !== entry.expected);
    if (failures.length > 0) {
      throw new Error(`Chrome DNR mismatch: ${JSON.stringify(failures)}`);
    }
    await runFeedDomSmoke(browserWebSocketUrl, port);
    await runSearchDomSmoke(browserWebSocketUrl, port);
    process.stdout.write(
      "Chromium verified the Reels rule, finite Home cutoff, and blank Search landing.\n",
    );
  } finally {
    await stopChrome(child, browserWebSocketUrl);
    fs.rmSync(profileDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
