# BlockInsta for Orion on iPhone

BlockInsta for Orion is a file-based WebExtension build of BlockInsta for Orion
Browser on iOS and iPadOS. It keeps Instagram Home finite, removes the idle
Search/Explore discovery grid, blocks the endless `/reels/` collection, and
permits one deliberately opened individual Reel.

This edition does not require an Apple Developer Program membership. It is
installed directly in Orion as a file-based extension.

## Compatibility design and limitations

Orion's iOS WebExtension support is preliminary and supports fewer APIs than a
desktop Chromium browser. The Orion build therefore:

- requests only `storage` and access to Instagram;
- has no background service worker;
- has no Declarative Net Request permission or ruleset;
- treats `storage.local` as the source of truth for the popup and content guard;
- detects storage changes and also refreshes settings after navigation, BFCache
  restoration, visibility changes, and on a bounded five-second fallback;
- blocks the Reels collection in the content script; and
- renders its own blocking interface inside the tab if extension pages are not
  dependable.

The build cannot affect the native Instagram app. Instagram's routes and DOM
are not a stable public API, so Instagram experiments can require maintenance.
Search discovery removal deliberately fails open when the page cannot be
classified confidently.

Automated and desktop tests do not prove behavior on a physical iPhone. Do not
describe this build as fully iPhone-compatible until the manual device matrix
below passes in the installed Orion version.

Official references:

- [Orion iOS and iPadOS Web Extension Support](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html)
- [Installing Orion](https://help.kagi.com/orion/getting-started/installing-orion.html)
- [Troubleshooting Extension Issues](https://help.kagi.com/orion/support-and-community/troubleshooting/troubleshooting-extension-issues.html)

## Build and verify

Install Node.js 20 or newer, open PowerShell in this repository, and run:

```powershell
npm run lint
npm test
npm run validate
npm run package:orion
```

The last command writes:

```text
dist/blockinsta-orion-v2.2.0.zip
```

The packager validates that `manifest.json` is at the ZIP root and that the
archive has no background worker, DNR rules, browser metadata, tests, research,
or development scripts. The ordinary Chrome/Safari package remains available
through `npm run package` and is not overwritten.

## Transfer the extension to an iPhone

Move the generated ZIP to the iPhone's Files app using iCloud Drive, AirDrop,
Finder, or another local file-transfer method. Keep the ZIP. As a fallback,
long-press it in Files and choose **Uncompress** so the extracted folder is also
available to Orion's file picker.

Do not upload the archive to a public file host. The build is intended for
local installation.

## Install in Orion

Orion's labels can change between releases. The current Kagi instructions use
this workflow on iPhone:

1. Install **Orion Browser by Kagi** from the iOS App Store.
2. Open Orion and tap the three-dot menu in the bottom-right corner.
3. Tap **Settings**.
4. Find the Extensions settings group and enable support for **Chrome
   Extensions**. This build uses a Chrome-style Manifest V3 manifest.
5. Return to the three-dot menu and tap **Extensions**.
6. Tap the **+** button.
7. Choose the file-based or install-from-file option.
8. Select `blockinsta-orion-v2.2.0.zip` in Files.
9. If that Orion release does not accept a ZIP, choose the extracted folder
   whose top level contains `manifest.json`.
10. Confirm the installation and enable BlockInsta in the Extensions list.
11. Open `https://www.instagram.com/` and sign in normally.
12. If Orion asks whether BlockInsta may access Instagram, choose **Allow**.
    If no prompt appears, open BlockInsta in the Extensions list and set its
    website access for `instagram.com` to **Allow**, when that control is
    exposed by the installed Orion version.

The project does not require an Apple developer account, Xcode conversion,
TestFlight, or App Store Connect for this file-based workflow.

## Open the popup and use the master switch

1. Tap Orion's three-dot menu.
2. Tap **Extensions**.
3. Tap **BlockInsta for Orion** or its action button.
4. Use **Block endless Instagram** to turn every BlockInsta protection on or
   off.

The switch writes directly to `storage.local`. A background worker is not
required. With blocking off, revisit or refresh Instagram if the current page
was already replaced by the blocked interface.

## Physical-iPhone acceptance tests

Run these tests while signed in to the account normally used on the device.

### Reels collection

- Type, paste, bookmark, and refresh `https://www.instagram.com/reels/`.
- Repeat with a query string and without the trailing slash.
- Open Instagram's Reels navigation link.
- Use browser Back and Forward to return to the collection.
- Confirm the BlockInsta interface appears with Back, Messages, and Home.
- Turn the popup switch off and confirm the route is no longer blocked.

### One individual Reel

- Turn blocking on.
- Open one `/reel/{shortcode}/` from Direct, Home, a profile, and an external
  link. Confirm that the deliberately opened Reel plays.
- Try vertical swipes, long drags, keyboard controls if a keyboard is attached,
  next/previous controls, recommendations, autoplay completion, Back/Forward,
  and route changes.
- Confirm no second Reel appears.
- Confirm comments and normal controls inside the first Reel remain usable.
- Leave the viewer, open a different Reel deliberately, and confirm the pinned
  state reset.
- Confirm Reel previews inside Direct messages remain usable.

### Home

- Confirm Stories and Notes remain usable.
- Confirm explicit Suggested, Recommended, Sponsored, and account-suggestion
  units are hidden.
- Confirm the local end card appears at Instagram's caught-up or recommendation
  boundary, or after 25 accepted posts when no boundary is detectable.
- Wait and swipe beyond the end card; no additional feed posts should appear.
- Confirm Messages, profiles, ordinary `/p/` posts, and stories still open.

### Search and Explore

- Open the compact Search/Explore landing.
- Confirm the search input remains visible while the idle media grid and its
  loader are absent.
- Focus, type, paste, clear, and select results.
- Confirm recent searches, autocomplete, typed results, loading/no-result
  states, safety messages, profiles, and posts remain visible.
- Confirm ambiguous content fails open instead of hiding useful results.

Also test a fresh install, an app relaunch, a browser restart, a tab restored
from BFCache, light and dark mode, a narrow portrait viewport, landscape, and at
least one non-English Instagram locale.

## Collect diagnostic information

Record the Orion version, iOS version, exact Instagram URL, whether the popup
switch was on, the entry path used, and a screen recording or screenshot.

Kagi's extension troubleshooting guide asks for errors from the extension
popup and active tab, plus the extension store URL and a precise description.
This file-based build has no store URL and no background script; report the ZIP
version instead. If the installed iOS build offers **Show Debug Log** or an
extension console in its advanced/debug settings, enable it, reproduce the
problem once, and copy the BlockInsta, popup, and active-tab messages.

Orion's documented `Tools > Extensions > Console` workflow is a macOS workflow.
If the iPhone release exposes no extension console, install the same ZIP in
Orion on macOS, reproduce the closest equivalent behavior, and collect popup
and active-tab console errors there. Pair those logs with the iPhone recording;
macOS logs are useful but are not a substitute for the physical-device result.

Do not include Instagram passwords, session cookies, private Direct messages,
or other account data in a bug report.

## Disable or uninstall

1. Tap Orion's three-dot menu.
2. Tap **Extensions**.
3. Find **BlockInsta for Orion**.
4. Toggle it off to disable it temporarily, or choose the remove/uninstall
   control to delete it.
5. Reload any open Instagram tabs.

Kagi documents disable and uninstall controls in the same Extensions management
area used for file-based installation.
