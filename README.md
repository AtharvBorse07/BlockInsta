# BlockInsta

BlockInsta is a privacy-friendly Safari Web Extension that blocks Instagram
website navigation and replaces it with a calm, local reminder page. Blocking
is on after installation. It can be switched off or paused for 5, 15, or 30
minutes from the extension popup.

The MVP targets Safari on iPhone (iOS 15 or later) and keeps the same
WebExtension source loadable in current desktop Chrome and Brave. It blocks the
website in the browser; it cannot block the native Instagram iOS app.

## Privacy and permissions

BlockInsta has no account, backend, analytics, advertising, remote code, or
network requests of its own. Settings remain in `storage.local`. It asks only
for:

- `storage` to remember whether blocking is enabled and the absolute unlock
  deadline;
- `declarativeNetRequest` to redirect Instagram top-level navigation to the
  bundled block page;
- `alarms` to restore blocking at the unlock deadline; and
- host access to `instagram.com` and its subdomains.

The absolute deadline is the source of truth. Startup, popup-open, block-page
open, and alarm handling all normalize expired or damaged settings back to the
safe blocking state.

## Project layout

```text
extension/                 Unpacked WebExtension; manifest.json is at its root
  popup/                   Enable/disable and temporary-unlock controls
  blocked/                 Local redirect destination
  shared/                  Testable settings and blocking decisions
scripts/                   Validation, icon generation, and ZIP packaging
tests/                     Node built-in test suite
dist/                      Generated package (gitignored)
```

No runtime packages or build framework are required. Node.js 20 or newer is
used only for developer scripts and tests.

## Develop and verify

```powershell
npm run icons
npm run check
npm run package
```

`npm run check` syntax-checks every JavaScript file, runs unit tests, and
validates the manifest, least-privilege permissions, static ruleset, packaged
assets, CSP, and absence of remote page assets. `npm run package` writes
`dist/blockinsta-extension-v1.0.0.zip`; `manifest.json` is at the ZIP root.

## Test in Chrome on Windows

1. Run `npm run icons` and `npm run check`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository's `extension` folder.
5. Confirm the BlockInsta popup says **Blocking is active**.
6. Visit `https://www.instagram.com/reels/` and confirm the local block page
   appears.
7. Check that an unrelated site still loads.
8. Exercise the off/on switch, each temporary unlock duration, **Re-enable
   now**, browser restart during an unlock, and expiration after suspension.
9. Inspect the service worker from the extension card and confirm there are no
   errors.

After source changes, choose **Reload** on the extension card. Chrome may cache
the previous ruleset until the extension is reloaded.

## Test in Brave on Windows

Use `brave://extensions` and follow the same steps as Chrome. Select the
`extension` directory when choosing **Load unpacked**.

## Package for Safari and iPhone

An Apple Developer Program membership and App Store Connect access are needed
for TestFlight or App Store distribution. The source and ZIP can be prepared on
Windows; actual iPhone acceptance testing still requires the owner's Apple
account and a device.

1. Run `npm run package` and locate the generated ZIP in `dist`.
2. In App Store Connect, create the app record and bundle identifier for the
   BlockInsta Safari Web Extension container.
3. Open Apple's Safari Web Extension Packager in App Store Connect and upload
   the ZIP. Its root contains `manifest.json` as required.
4. Review compatibility warnings. If the current Safari release requests a
   manifest adjustment, keep any Safari-specific change isolated and retest the
   same source in Chrome and Brave.
5. Complete the app metadata and privacy answers. The correct data-collection
   declaration for this source is that it does not collect data.
6. Distribute a beta with TestFlight and install it on a supported iPhone.
7. On iPhone, enable the extension under **Settings > Apps > Safari >
   Extensions**, allow access to Instagram, and repeat the URL and state test
   matrix below.

Packaging or desktop success is not proof of iPhone compatibility. TestFlight
upload, Safari compatibility review, permission prompts, background suspension,
and real-device behavior are pending until Apple credentials and a device are
available.

## Manual acceptance matrix

Test these URLs while blocking is active:

- `https://instagram.com/`
- `https://www.instagram.com/`
- `https://m.instagram.com/`
- `/reels/`, `/explore/`, `/direct/inbox/`, and a profile path
- a URL containing a query and fragment
- a non-Instagram website, which must remain unaffected

Test a fresh install, explicit disable and re-enable, all unlock durations,
expiration while open and suspended, restart during an unlock, missing or
corrupted local storage, and an extension update. For storage corruption tests,
use the service worker console to write malformed data, then reopen the popup;
blocking should return to the safe default.

## Known scope and design choices

- The static declarative ruleset is toggled as a whole. This is narrower and
  easier to audit than observing browser navigation.
- The extension does not request history, tabs, web-navigation, or all-sites
  access. Consequently, the block page does not retain the original Instagram
  URL; **Go back** returns to browser history (or asks the user to close the tab
  when no history entry exists).
- Background execution may be suspended on iPhone, so the countdown is only a
  display. The persisted Unix timestamp determines whether blocking is active.
- Schedules, counters, custom sites, passwords, native-app blocking, accounts,
  cloud sync, and payments are intentionally outside the MVP.

## License status

The owner has not selected an open-source license. The current `LICENSE` is an
all-rights-reserved placeholder and should be replaced only after that decision
is confirmed.

