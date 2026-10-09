# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## What this is

`igd/` is a **clean-room rebuild** of the *a reference extension* browser extension. The original sits at the repository root (`../`) and is unlicensed. v0.6 lives in `extension/` (plain MV3, no build step). It does profile download, single-post download, per-item ⬇ buttons on grid tiles and feed posts, stories and highlights, and a read-only collection check. All saving runs in a side panel (`manager.html`) with a queue. See `README.md` for the requirements and status, and `docs/README.md` for the study notes.

- `extension/naming.js`: file names and dedup keys. It must stay compatible with the old collections, so run `node test/naming.test.js` after any change.
- `extension/page.js`: page-world GraphQL calls (`PolarisProfilePostsQuery`, `PolarisPostRootQuery`, `PolarisAPITopsearchQuery` for username → id, `PolarisProfileStoryHighlightsTrayContentQuery`, `PolarisStoriesV3ReelPageStandaloneQuery`). Each request gets exactly one reply on its port. Never call the story "seen" mutations.
- `extension/naming.js` also holds `routeFromPath`, `shortcodeFromPath`, `parseFileName`, `inferOwner` and `sniffMedia`, so they are unit-tested.
- `extension/collection.js`: `.igd.json` markers, `resolveAccountDir`, and the read-only `checkCollection`. Tested offline against an in-memory folder tree in `test/collection.test.js`.
- Security invariants: the folder handle lives only in the panel's extension-origin IndexedDB, never in instagram.com storage, where page scripts could use it. Treat page-bridge replies as untrusted: the panel runs `itemsFromNode`, which validates usernames, IDs and CDN URLs, and `validJob` checks jobs arriving from content scripts. Every igd button handler requires `event.isTrusted`: page scripts can click our buttons, and the panel's folder is already granted. Live tests therefore can't start jobs with a script `.click()`.
- `extension/manager.js` (side panel): folder, queue, job runner. It asks an Instagram tab to list records (`bridge` → `chrome.tabs.sendMessage`), pinging tabs because ones opened before an igd update have no live script.
- `extension/background.js`: opens the panel, and answers `enqueue` when the panel isn't open.
- `extension/content.js`: buttons, per-item buttons, and the relay panel → page world. It never saves. The buttons find posts through their `/p/` or `/reel/` links (`shortcodeFromPath`), never through Instagram class names. Clicks are handled in the capture phase, so the tile link never navigates.
- `extension/collection.js` is shared by the panel: markers, folder resolution, saving, and the check.

## Clean-room rules

- **Never copy** code, CSS, icons, UI strings or minified fragments from `../js`, `../css`, `../icons` or `docs/verification/`. Write everything from the behaviour described in `docs/`.
- Read the original bundles only to **correct or extend the docs**. Change the docs first, then build from the docs.
- Instagram's own module, operation and endpoint names (`PolarisProfilePostsQuery`, `/api/graphql`, …) describe Instagram, not the extension, so using them is fine.
- `docs/11-investigation-playbook.md` is our own code and may be reused.

## Compatibility with existing collections (do not break)

- Identity: the dedup key is the media **pk** only. Account folders are tied to user IDs by `.igd.json` (`collection.js`, `resolveAccountDir`). Never rename existing folders, and never let two user IDs share a folder.
- Migration rules: report first (🔍 is read-only). Never delete: anything removed goes to `<root>/.igd-trash/<date>/`. Steps that move files need the user's confirmation.

- Layout: `<root>/<username>/<username>_<taken_at>_<id>.<ext>`. The only cleaning step strips `< > : " / \ | ? *`.
- Dedup key: **`pk`**. Never key on the full name, the username, or a name prefix that includes `taken_at`.
- Never overwrite. Open with `create: false` first, because creating and then writing truncates the file.
- Full rules: `docs/04-download-and-storage.md`, section "Compatibility checklist".

## Instagram facts drift

Endpoint and query details in `docs/03` are a snapshot from October 2026. Before relying on them, re-check with playbook steps 3–6, and update the docs when something has changed.
