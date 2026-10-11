# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Framestash is a Chrome extension that downloads Instagram profiles, posts, stories and highlights into a local collection. The extension lives in `extension/` (plain MV3, no build step; the version is in `manifest.json`). See `README.md` for features and `docs/README.md` for the specs. Before 1.0.1 it was called igd: `.igd.json` markers are still read as a fallback, and the panel copies its old IndexedDB `"igd"` into `"framestash"` once.

- `extension/naming.js`: pure helpers shared by the content script and panel, unit-tested in `test/naming.test.js`:
  - file names, dedup keys, `parseFileName`, `inferOwner`, `sniffMedia`
  - `itemsFromNode`, which validates records
  - `routeFromPath`, `shortcodeFromPath`
  - queue helpers: `queueEntry`, `unfinished`, `clearQueue`, `visibleJobs`
  - profile-listing helpers for early stop and resume: `pinnedFlags`, `stopListing`, `resumeFrom`, `cursorRecord`, `startOverShown`

  Naming must stay compatible with existing collections; run the test after any change.
- `extension/collection.js`: `.framestash.json` markers, `resolveAccountDir`, saving, and the read-only `checkCollection`. Used by the panel; tested offline against an in-memory folder tree in `test/collection.test.js`.
- `extension/pacer.js`: pure pacing and circuit-breaker rules (jitter, the rest after a job scaled by its request count, settings, hourly/daily budget, reply classification, cool-down growth), tested in `test/pacer.test.js`. `manager.js` sends every bridge call through `paceApi` and every download through `paceCdn`; a block signal holds the whole queue instead of retrying, and login/challenge holds wait for the user's Resume. Pause is one more manual hold (`pauseHold`/`resumeHold`) that keeps any running timed hold for after Resume.
- `extension/page.js`: page-world GraphQL calls (`PolarisProfilePostsQuery`, `PolarisPostRootQuery`, `PolarisAPITopsearchQuery` for username → id, `PolarisProfileStoryHighlightsTrayContentQuery`, `PolarisStoriesV3ReelPageStandaloneQuery`).
- `extension/manager.js` (side panel): folder, queue, job runner. It asks an Instagram tab to list records (`bridge` → `chrome.tabs.sendMessage`). It pings tabs first, because tabs opened before a Framestash update have no live script. `pump()` waits for the first-run notice (`kv("accepted")`).
- `extension/background.js`: every job goes through it. It calls `sidePanel.open` before awaiting anything, because that needs the user's click. Then it forwards the job to the panel, or holds it until the panel asks (`managerReady`). Each open panel holds a `panel:<windowId>` port, so the in-page panel button can close an open panel (`closePanel`) instead of opening it.
- `extension/content.js`: the Download, Stories and panel buttons, grid-tile buttons, the download icon in post and reel action rows, the relay from panel to page world, and placement next to Instagram's Messages button.

Path-scoped rules in `.claude/rules/` load with the files they cover; agents in `.claude/agents/` run the fs-task steps.

**Security invariants:**
- The folder handle lives only in the panel's extension-origin IndexedDB, never in instagram.com storage, where page scripts could use it.
- Page-bridge replies are untrusted, so `itemsFromNode` validates them.
- The panel accepts jobs only from the background, with the tab URL as Chrome reports it, and checks them with `validJob`.
- Every Framestash button handler requires `event.isTrusted`: page scripts can click our buttons, and the panel's folder is already granted. Live tests therefore can't start jobs with a script `.click()`.

## Task workflow

`TASKS.md` lists open work. The `fs-task` workflow (`.claude/workflows/fs-task.js`) handles one task per run: pick, plan, build, review, then one commit, with the status set to `needs-check` plus the user's live checks. `fs-tasks` runs several tasks in order. Keep the task format: a `## T<n> · title` heading, then `status` / `why` / `done when` bullets.

Run workflows by `scriptPath` (`.claude/workflows/<name>.js` under this repo); a session started outside this folder can't find them by name.

## Checks

No build step. After any change, run from the repo root:

```bash
node test/naming.test.js && node test/collection.test.js && node test/pacer.test.js
for f in extension/*.js; do node --check "$f"; done
```

## Compatibility with existing collections (do not break)

- Layout: `<root>/<username>/<username>_<taken_at>_<id>.<ext>`. The only cleaning step strips `< > : " / \ | ? *`.
- Dedup key: **`pk`** only, never the full name, the username, or a prefix that includes `taken_at`.
- Account folders are tied to user IDs by `.framestash.json` (`resolveAccountDir`). Never rename existing folders, and never let two user IDs share a folder.
- Never overwrite: open with `create: false` first; creating then writing truncates.
- Migration rules: report first (the collection check is read-only). Never delete: anything removed goes to `<root>/.framestash-trash/<date>/`. Steps that move files need the user's confirmation.
- Full rules: `docs/collection-format.md`.

## Instagram facts drift

Endpoint and query details in `docs/instagram-api.md` are a snapshot from October 2026. Before relying on them, re-check with `docs/playbook.md` steps 1–5, and update the docs when something has changed.
