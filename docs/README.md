# Studying a reference extension

These notes explain how the a reference extension Chrome extension (v4.12.16) works. The goal is that a team can later build its **own** downloader from scratch once this one is no longer maintained, without reusing any of its code.

- All descriptions, diagrams and pseudocode are our own. Nothing here is meant to be copied.
- The original is unlicensed (doc 1, "Lineage and licence"), so a rebuild must be clean-room.
- Paths such as `js/…`, `manifest.json` or `css/…` refer to the **original extension at the repository root** (`../../` from this folder). That folder is the reference, not part of the rebuild.
- Every claim was checked against the shipped bundles in `../../js/`, and in places observed live in a logged-in browser in October 2026. Five verification passes reviewed the text (evidence in `verification/`).
- Instagram's private APIs change often, so treat endpoint details as a snapshot. Claims that come only from live observation say so.

## Reading order

| # | Doc | Question it answers |
|---|---|---|
| 1 | [Architecture](01-architecture.md) | What runs where, the two message channels, how the options page works, lineage |
| 2 | [Page integration](02-page-integration.md) | Navigation, the page router, button lifecycle, selectors, reading React's internals |
| 3 | [Instagram data access](03-instagram-data-access.md) | Session values, the post lookup chain, record shapes, profile listing, ID formats |
| 4 | [Download and storage](04-download-and-storage.md) | Save modes, the folder handle, write loop, **file naming and a compatibility checklist** |
| 5 | [Telemetry and privacy](05-telemetry-and-privacy.md) | GA4, Sentry, what data leaves the browser |
| 6 | [Failure modes and lessons](06-failure-modes-and-lessons.md) | What broke, the latent faults, the local patch, how we studied it |
| 7 | [Feature catalogue](07-feature-catalogue.md) | Every button and trigger, and what each one downloads |
| 8 | [Stories and highlights](08-stories-and-highlights.md) | The separate story subsystem and its event bus |
| 9 | [UX surface](09-ux-surface.md) | Toasts, every message text, options UI, theming, browsers |
| 10 | [Dead and legacy code](10-dead-and-legacy-code.md) | What not to copy, and the local files that aren't part of the shipped extension |
| 11 | [Investigation playbook](11-investigation-playbook.md) | Our own console probes for re-checking Instagram's APIs, the extension state and an existing collection |
| — | [Verification evidence](verification/README.md) | Raw agent reports behind docs 1–10, and the claims that were overruled |

**If you only read three:** 4 (to avoid damaging existing collections), 3 (how to get the data), and 6 (what goes wrong). **Before you start building:** run playbook steps 5–6 to check that Instagram's current queries still match doc 3, and step 9 to audit the existing collection.

## One-paragraph summary

The extension runs in two JavaScript worlds on instagram.com.

- **Page world.** A script running as part of Instagram's own page reads its internal state: session tokens, React component props, its module loader and its API client. It tags on-screen media with IDs, and it draws the story buttons.
- **Isolated world.** A content script draws the other buttons. It resolves each post through an ordered chain: Instagram's REST API first, then Instagram's own GraphQL client as a fallback. It picks the largest rendition and saves it. Profile-wide downloads go into a folder the user chose (File System Access API), with dedup by file name. Everything else is a plain browser download.
- **Service worker.** It reports usage to Google Analytics.
- **Sentry.** The service worker and the content script report errors to Sentry.

Almost every failure comes from Instagram changing its internals, made worse by error handling that hides the real cause.

## Local modifications in this folder

The profile "Download All" flow was patched to work again (doc 6). Shipped originals are kept as `js/*.bak` (doc 10). These docs describe the shipped design and point out where the patch differs.
