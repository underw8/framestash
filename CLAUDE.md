# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## What this is

`igd/` is a **clean-room rebuild** of the *a reference extension* browser extension. The original sits at the repository root (`../`) and is unlicensed. The extension lives in `extension/` (plain MV3, no build step; the version is in `manifest.json`). See `README.md` for features and `docs/README.md` for the study notes.

- `extension/naming.js`: pure helpers shared by the content script and panel, unit-tested in `test/naming.test.js`:
  - file names, dedup keys, `parseFileName`, `inferOwner`, `sniffMedia`
  - `itemsFromNode`, which validates records
  - `routeFromPath`, `shortcodeFromPath`, `queueEntry`

  Naming must stay compatible with the old collections; run the test after any change.
- `extension/collection.js`: `.igd.json` markers, `resolveAccountDir`, saving, and the read-only `checkCollection`. Used by the panel; tested offline against an in-memory folder tree in `test/collection.test.js`.
- `extension/pacer.js`: pure pacing and circuit-breaker rules (jitter, settings, hourly/daily budget, reply classification, cool-down growth), tested in `test/pacer.test.js`. `manager.js` sends every bridge call through `paceApi` and every download through `paceCdn`; a block signal holds the whole queue instead of retrying, and login/challenge holds wait for the user's Resume.
- `extension/page.js`: page-world GraphQL calls (`PolarisProfilePostsQuery`, `PolarisPostRootQuery`, `PolarisAPITopsearchQuery` for username → id, `PolarisProfileStoryHighlightsTrayContentQuery`, `PolarisStoriesV3ReelPageStandaloneQuery`).
  - Query flags ("provided variables") are read from each query's definition.
  - Each request gets exactly one reply on its port.
  - Each reply carries `requests` (GraphQL requests made) for the budget, and Instagram's JSON block replies are passed through as `login` / `checkpoint` / `spam` flags.
  - Never call the story "seen" mutations.
- `extension/manager.js` (side panel): folder, queue, job runner. It asks an Instagram tab to list records (`bridge` → `chrome.tabs.sendMessage`). It pings tabs first, because tabs opened before an igd update have no live script.
- `extension/background.js`: every job goes through it. It calls `sidePanel.open` before awaiting anything, because that needs the user's click. Then it forwards the job to the panel, or holds it until the panel asks (`managerReady`).
- `extension/content.js`: buttons, per-item buttons, the relay from panel to page world, and placement next to Instagram's Messages button. It never saves. Posts are found through their `/p/` or `/reel/` links (`shortcodeFromPath`), never through Instagram class names. Clicks are handled in the capture phase, so the tile link never navigates.

**Security invariants:**
- The folder handle lives only in the panel's extension-origin IndexedDB, never in instagram.com storage, where page scripts could use it.
- Page-bridge replies are untrusted, so `itemsFromNode` validates them.
- The panel accepts jobs only from the background, with the tab URL as Chrome reports it, and checks them with `validJob`.
- Every igd button handler requires `event.isTrusted`: page scripts can click our buttons, and the panel's folder is already granted. Live tests therefore can't start jobs with a script `.click()`.

## Task workflow

`TASKS.md` lists open work. The `igd-task` workflow (`.claude/workflows/igd-task.js`) handles one task per run: pick, plan, build, review, then one commit, with the status set to `needs-check` plus the user's live checks. Keep the task format: a `## T<n> · title` heading, then `status` / `why` / `done when` bullets.

## Clean-room rules

- **Never copy** code, CSS, icons, UI strings or minified fragments from `../js`, `../css`, `../icons` or `docs/verification/`. Write everything from the behaviour described in `docs/`.
- Read the original bundles only to **correct or extend the docs**. Change the docs first, then build from the docs.
- Instagram's own module, operation and endpoint names (`PolarisProfilePostsQuery`, `/api/graphql`, …) describe Instagram, not the extension, so using them is fine.
- `docs/11-investigation-playbook.md` is our own code and may be reused.

## Compatibility with existing collections (do not break)

- Layout: `<root>/<username>/<username>_<taken_at>_<id>.<ext>`. The only cleaning step strips `< > : " / \ | ? *`.
- Dedup key: **`pk`**. Never key on the full name, the username, or a name prefix that includes `taken_at`.
- Account folders are tied to user IDs by `.igd.json` (`resolveAccountDir`). Never rename existing folders, and never let two user IDs share a folder.
- Never overwrite. Open with `create: false` first, because creating and then writing truncates the file.
- Migration rules: report first (the collection check is read-only). Never delete: anything removed goes to `<root>/.igd-trash/<date>/`. Steps that move files need the user's confirmation.
- Full rules: `docs/04-download-and-storage.md`, section "Compatibility checklist".

## Instagram facts drift

Endpoint and query details in `docs/03` are a snapshot from October 2026. Before relying on them, re-check with playbook steps 3–6, and update the docs when something has changed.
