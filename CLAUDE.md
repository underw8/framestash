# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## What this is

`igd/` is a **clean-room rebuild** of the *a reference extension* browser extension. The original sits at the repository root (`../`) and is unlicensed. v0.2 lives in `extension/` (plain MV3, no build step). It does profile download and single-post download. See `README.md` for the requirements and status, and `docs/README.md` for the study notes.

- `extension/naming.js`: file names and dedup keys. It must stay compatible with the old collections, so run `node test/naming.test.js` after any change.
- `extension/page.js`: page-world GraphQL calls (`PolarisProfilePostsQuery`, `PolarisPostRootQuery`). Each request gets exactly one reply on its port.
- Security invariants: never store the folder handle in instagram.com storage (page scripts could use it). Treat page-bridge replies as untrusted, so `itemsFromNode` validates usernames, IDs and CDN URLs.
- `extension/content.js`: UI, folder handle, download loop.

## Clean-room rules

- **Never copy** code, CSS, icons, UI strings or minified fragments from `../js`, `../css`, `../icons` or `docs/verification/`. Write everything from the behaviour described in `docs/`.
- Read the original bundles only to **correct or extend the docs**. Change the docs first, then build from the docs.
- Instagram's own module, operation and endpoint names (`PolarisProfilePostsQuery`, `/api/graphql`, …) describe Instagram, not the extension, so using them is fine.
- `docs/11-investigation-playbook.md` is our own code and may be reused.

## Compatibility with existing collections (do not break)

- Layout: `<root>/<username>/<username>_<taken_at>_<id>.<ext>`. The only cleaning step strips `< > : " / \ | ? *`.
- Dedup key: **username + `pk`**. Never key on the full name or on a name prefix that includes `taken_at`.
- Never overwrite. Open with `create: false` first, because creating and then writing truncates the file.
- Full rules: `docs/04-download-and-storage.md`, section "Compatibility checklist".

## Instagram facts drift

Endpoint and query details in `docs/03` are a snapshot from October 2026. Before relying on them, re-check with playbook steps 3–6, and update the docs when something has changed.
