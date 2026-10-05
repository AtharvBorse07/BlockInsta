# BlockInsta Privacy Policy

Effective date: October 5, 2026

BlockInsta does not collect, transmit, sell, or share personal information. It
has no account system, analytics, advertising, telemetry, crash-reporting
service, remote code, or backend server.

The extension stores only these settings in the browser's local extension
storage:

- whether selective blocking is enabled;
- whether the infinite Reels collection is blocked;
- whether an individual Reel is limited to one item;
- whether the Home feed is finite; and
- whether Home should prefer Instagram's Following view; and
- whether the idle Search/Explore discovery grid is hidden.

The extension does not store the Reel being viewed. Its in-page one-Reel state
exists only in that page's memory and is discarded when the page closes or
navigates away.

BlockInsta does not read or retain message text, usernames, friend/follower
relationships, credentials, cookies, browsing history, photos, videos, or
captions. The content script examines Instagram URL paths, link destinations,
semantic labels such as caught-up, suggestion, and Sponsored markers, semantic
page structure, Search input empty/active state, and media playback state locally
only as needed to distinguish blocked experiences from allowed Instagram
features. Search text may be read ephemerally to distinguish an empty landing
from active search, but it is never retained, logged, or transmitted.

Feed post identities may be held in the current page's memory while classifying
DOM nodes and are discarded on refresh or navigation. They are not written to
extension storage. An ephemeral session timestamp may be used to prevent an
Instagram Following-route failure from creating a redirect loop; it contains no
account or content data.

Website access is limited to `instagram.com` and its subdomains. This access is
used to:

- redirect the exact top-level `/reels/` collection route to a bundled local
  page;
- detect Instagram's client-side route changes;
- hide or disable dedicated/continuation Reels navigation;
- pause and mute a blocked Reel immediately before leaving Instagram;
- prefer Instagram's Following view on Home;
- hide explicit suggestions/advertisements and content beyond the finite feed
  boundary; and
- hide the idle Search/Explore discovery grid and its pagination loader while
  preserving search controls, results, and system notices.

No inspected value leaves the user's device. BlockInsta makes no
extension-owned network requests. It does not block broad Instagram media or API
requests because those endpoints may also support Messages, Following, posts,
and the one permitted Reel.

Removing the extension removes its browser-managed local data according to the
browser's normal extension-removal behavior.

This policy applies to the source in this repository. Any future feature that
changes data handling must update this policy before release.
