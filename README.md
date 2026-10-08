# igd: our Instagram downloader (clean-room rebuild)

This folder is our own replacement for *a reference extension* v4.12.16, written from scratch. The original extension sits at the repository root (`../`) **as a reference only**. Nothing from it is copied into this folder.

**Status:** v0.1: profile download into an existing collection (`extension/`). Live-tested on 8 October 2026:
  - A profile the old tool had already downloaded: **new 0 · already had 25 · failed 0**. Nothing was written to disk.
  - A new 49-post profile, 5 pages: **new 167 · failed 0** (138 JPG + 29 MP4, 155 MB). Every file is non-empty, has real JPEG/MP4 header bytes, and parses back to a unique key.
  - The same profile run again: **new 0 · already had 167**. Study notes: `docs/`.

## Using v0.1

1. Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `igd/extension/`. The old extension can stay installed; the two don't share storage or buttons.
2. Open a profile, for example `https://www.instagram.com/<user>/`. A **⬇ Download @user** button appears in the bottom-left corner.
3. On the first click, pick the **root** folder of your collection (the one that contains the account folders, e.g. `IG`). The 📁 button changes it later.
4. The status line shows progress: page, new, already had, failed. Failed items are listed in the DevTools console. Running it again only fetches what's missing.

What it does, and which doc each rule comes from:
- Lists posts with Instagram's own profile-posts GraphQL query, from the page world [3].
- Names files exactly like the old tool [4] and skips any media already present, matched on **username + pk** [4].
- Never overwrites a non-empty file. Creates a file only after a successful, status-checked download, so failures leave nothing behind [6].
- Writes each page as it arrives, waits 1.5 s between pages, and backs off 60 / 120 / 300 s on HTTP 429 [3, 6].
- Re-asks for the folder if the saved one was moved or deleted [6].
- No telemetry, no host permissions, no web-accessible resources [5].

Not in v0.1: single posts, carousels, reels, stories, highlights, tagged posts of other users, DASH video quality.

## Checks

```bash
node igd/test/naming.test.js     # naming + dedup-key rules vs old-tool file names
```

## Layout

```text
tdi/                    original extension (reference, unlicensed, not ours)
├── js/ css/ icons/     shipped bundles, plus a local patch and *.bak originals
└── igd/                ← our rebuild
    ├── extension/      v0.1 MV3 extension (load unpacked)
    ├── test/           node checks
    ├── docs/           how the original works, what broke, how to probe Instagram
    │   └── verification/   evidence behind the docs
    ├── README.md       this file
    └── CLAUDE.md       ground rules for working here
```

## What the rebuild must do

Taken from the study notes; the doc number is in brackets.

**Hard requirement: keep existing collections safe** [4]
- Write into the same root folder layout: `<root>/<username>/<username>_<taken_at>_<id>.<ext>`.
- Never overwrite a file. Count a file as already downloaded by **username + `pk`**, ignoring the timestamp, the `_owner` suffix and the extension.
- Leave the 0-byte files, `.error.txt` files and possibly-corrupt files the old tool left behind as they are. Report them; don't delete them.
- Before the first real run, audit the collection with playbook step 9 [11].

**Feature parity**, at least what people actually used [7, 8]
- Profile download into a chosen folder, with incremental re-runs.
- Single post, current carousel slide, whole carousel, grid hover, reels.
- Stories and highlights (current and all).

**Avoid the original's faults** [6]
- Check the HTTP status, redirects and content type before parsing or saving.
- Treat cosmetic calls as optional. Make every bridge request get a reply. Use one message channel, with an origin check.
- Check that a stored folder still exists. Write each page of posts as it arrives and keep a cursor so an interrupted run can resume.
- Show every failure in the UI. Add backoff on 429.

**Data access** [3]
- Make the requests Instagram's own UI makes (currently `POST /api/graphql`), from the page world.
- Read query IDs and tokens at runtime; never hardcode them.
- Normalise every record to one shape keyed by `pk` before naming files.

**Privacy** [5]
- Telemetry is opt-in, or there is none.
- No page HTML or URLs in error reports.
- Expose web-accessible resources to instagram.com only.

## Decisions so far

- Plain MV3, hand-written, with no build step.
- Build order: profile download first (done in v0.1), then single post and carousel, then stories.
- When Instagram changes something, re-run playbook steps 5–6 [11] and update doc 3 before changing code.
