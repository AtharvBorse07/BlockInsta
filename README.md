# BlockInsta

BlockInsta is a privacy-friendly Safari and Chromium WebExtension that blocks
Instagram's infinite Reels experience, turns Home into a finite feed, and removes
the idle Search/Explore discovery grid without blocking useful Instagram tools.

With blocking enabled:

- Home remains on Instagram's working default feed, removes explicit
  recommendations/advertisements, and ends at its caught-up or recommendations
  boundary. A manually opened Following feed receives the same finite guard.
- Suggested, recommended, and Sponsored feed cards are hidden. If Instagram
  provides no clear boundary, BlockInsta stops after 25 accepted posts.
- The compact Search/Explore landing keeps its native search field but shows no
  recommendation grid. Recent searches, autocomplete, typed results, system
  notices, and selected result pages remain available.
- Direct Messages, profiles, ordinary posts, and stories remain available.
- An individual Reel opened from a message, feed, profile, or direct link may be
  watched.
- The dedicated `/reels/` collection exits to a local BlockInsta page.
- Moving from the deliberately opened Reel to a second Reel is blocked.

"A Reel from a friend" means an individual Reel the user deliberately opens.
BlockInsta does not inspect messages, account relationships, usernames, or the
Instagram friend graph.

## How it works

BlockInsta uses complementary enforcement layers:

1. A narrowly anchored `declarativeNetRequest` rule redirects only direct
   top-level visits to the exact Instagram `/reels` collection route.
2. An Instagram-only content script runs at `document_start` to cover
   single-page-app navigation, hide the dedicated Reels entry, pin one allowed
   Reel shortcode, and stop wheel, swipe, keyboard, link, or route continuation
   into a second Reel.
3. A separate Home-feed controller hides explicit suggestions and
   advertisements, detects semantic caught-up/recommendation boundaries, and
   inserts a local end card. It uses a 25-post fallback so a changed Instagram
   layout cannot silently restore an endless feed. The unreliable undocumented
   `/?variant=following` route is supported when opened manually but is not
   forced automatically.
4. A separate Search controller identifies only the compact `/explore/` or empty
   Search landing's recommendation grid, hides its pagination loader, and leaves
   search-controlled results, statuses, dialogs, and result routes untouched.

The content script is intentionally required for Safari: Safari does not support
the `webNavigation.onHistoryStateUpdated` event used by some Chromium
extensions. It combines capture-phase link handling, Navigation API support
when available, History events, BFCache handling, DOM observation, and a small
location guard.

The extension never blocks or rewrites Instagram media, GraphQL, XHR, or other
shared data endpoints because those requests also support messages and allowed
content.

## Privacy and permissions

BlockInsta has no account, backend, analytics, advertising, telemetry, remote
code, or extension-owned network requests. Settings remain in `storage.local`.

It requests only:

- `storage`, for the local enabled state and selective-protection settings;
- `declarativeNetRequestWithHostAccess`, to redirect the exact Reels collection
  route; and
- host access limited to `instagram.com` and its subdomains, so the content
  script and redirect can operate there.

It does not request browser history, tabs, cookies, all-sites access, or access
to unrelated websites. Safari users must grant the extension website access to
Instagram; the popup reports when that access is missing where the browser API
exposes the state.

See [PRIVACY.md](PRIVACY.md) for the complete policy.

## Project layout

```text
extension/                 Unpacked WebExtension; manifest.json is at its root
  content/                 Reel, finite Home, and blank Search controllers
  shared/                  Testable settings, route, feed, and Search policy
  popup/                   Master selective-blocking control and status
  blocked/                 Local exit page for infinite/next Reel attempts
scripts/                   Validation, icon generation, and ZIP packaging
tests/                     Node built-in policy and manifest tests
dist/                      Generated package (gitignored)
```

No runtime packages or build framework are required. Node.js 20 or newer is
used only for developer scripts and tests.

## Develop and verify

```powershell
npm run icons
npm run check
npm run smoke:chromium
npm run package
```

`npm run check` syntax-checks JavaScript, runs the route/settings/ruleset tests,
and validates the manifest, permissions, content-script registration, static
rule, packaged assets, CSP, and absence of remote page assets.

`npm run smoke:chromium` launches a supported Chromium-based browser with an
isolated temporary profile. It asks the real browser DNR engine to prove that
only the intended `/reels/` test URLs match, then exercises caught-up and
25-post Home cutoffs plus blank-Search transitions against synthetic DOM fixtures
in the real browser engine.
Set `CHROME_PATH` to choose a specific compatible test browser. Current branded
Chrome builds no longer accept command-line unpacked extensions, so the script
prefers Edge or Brave on Windows when available.

`npm run package` writes `dist/blockinsta-extension-v2.2.0.zip`, with
`manifest.json` at the ZIP root. Browser-generated `extension/_metadata` is
excluded from the package without deleting the local folder.

## Test in Chrome or Brave on Windows

1. Run `npm run check`.
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository's `extension` folder.
5. Reload the extension after each source change.
6. Open Instagram Home and confirm followed-account posts remain, explicit
   suggestions/Sponsored cards are hidden, and the feed ends at the caught-up
   boundary or after 25 accepted posts.
7. Visit `https://www.instagram.com/reels/` and confirm the local exit page
   appears.
8. Open one singular `/reel/{shortcode}/` link and confirm it plays.
9. Try wheel, trackpad, keyboard paging, next controls, and recommendations;
   none may display a second Reel.
10. Turn blocking off in the popup and confirm the full Reels experience returns.
11. Confirm ordinary algorithmic Home also returns while blocking is off.
12. Turn blocking on again and confirm selective enforcement resumes.
13. Open the compact Search/Explore landing and confirm the search field remains
    usable while the recommendation grid and its loader are absent.
14. Focus, type, clear, and select search results; results and system messages
    must remain visible, and clearing must return to a blank landing.

The exact one-Reel behavior depends on Instagram's current DOM and experiments.
Tests on the owner's authenticated account are required; URL unit tests cannot
prove Instagram's live viewer behavior.

## Package and test in Safari on iPhone

An Apple Developer Program membership and App Store Connect access are needed
for TestFlight or App Store distribution.

1. Run `npm run package`.
2. Upload the generated ZIP through Apple's Safari Web Extension Packager in
   App Store Connect, with `manifest.json` at the ZIP root.
3. Review and resolve every compatibility warning.
4. Distribute a TestFlight build and install it on the iPhone.
5. Enable BlockInsta in **Settings > Apps > Safari > Extensions**.
6. Grant website access to Instagram.
7. Repeat the manual matrix below with touch gestures on a real device.

Desktop or packaging success is not proof of iPhone behavior. Real-device
testing is required before claiming that Instagram's current viewer is fully
contained.

## Manual acceptance matrix

Verify all of these entry paths:

- typed, pasted, bookmarked, refreshed, Back, and Forward navigation to
  `/reels/`;
- the Reels navigation entry from an already open Instagram document;
- one individual Reel opened from Direct, Home/Following, a profile, and an
  external direct link;
- Direct inbox and threads, including Reel previews;
- profiles, `/p/` posts, stories, typed search results, and unrelated websites.

On Home/Following, verify:

- Stories and Notes remain usable;
- explicit Suggested, Recommended, Sponsored, and account-suggestion units are
  hidden from the vertical feed;
- the local end card appears at Instagram's caught-up/recommendation transition;
- a missing transition triggers the honest 25-post fallback;
- waiting, scrolling, Page Down, End, and touch gestures reveal nothing after
  the end card; and
- refresh starts a new finite session.

On the compact Search/Explore landing, verify:

- the native search input remains visible, focusable, and editable;
- the idle recommendation grid, skeletons, and loader are absent;
- focus with an empty value may show Instagram's recent-search UI;
- typing, paste, clear, and available input methods preserve autocomplete,
  results, loading/no-results, and safety/system messages;
- opened profiles, posts, and one permitted Reel follow their existing rules;
- clearing the query returns to the blank landing without a discovery flash; and
- turning BlockInsta off restores the ordinary grid without a page reload.

From the one permitted Reel, try:

- touch swipe, mouse wheel, and trackpad;
- Arrow keys, Page Up/Down, Home, End, and Space;
- next/previous controls and recommendations;
- autoplay completion, browser history, and route changes.

The first Reel must remain usable, including comments and ordinary controls,
but no tested action may display a second Reel. Also test fresh install,
version-1 settings migration, blocking off/on, missing Safari site permission,
browser restart, BFCache restoration, desktop/narrow layouts, and at least one
non-English locale if Instagram's current selectors require labels.

## Known limitations

- BlockInsta affects Instagram's website in browsers that support the extension;
  it cannot block the native Instagram iOS app.
- Instagram does not publish a stable web-route or DOM contract. A/B tests or UI
  updates can require selector maintenance.
- Search discovery hiding deliberately fails open if the extension cannot
  distinguish the discovery owner from search results with high confidence.
- The undocumented `/?variant=following` web route can be unavailable. The exit
  page therefore also offers Messages, plain Home, and Back, while the Home-feed
  controller falls back to DOM filtering and the local post limit.
- Instagram's caught-up marker reflects Instagram's ranking state; BlockInsta
  does not claim that every followed-account post was displayed.
- If the user denies or revokes Instagram website access, the browser prevents
  the extension from enforcing the content guard.
- Singular `/reel/{shortcode}/` is the verified policy shape. Unknown plural
  `/reels/...` subroutes fail closed until they are deliberately classified.

## License status

The owner has not selected an open-source license. `LICENSE` remains an
all-rights-reserved placeholder until that decision is made.
