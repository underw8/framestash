# igd: our Instagram downloader (clean-room rebuild)

This folder is our own replacement for *a reference extension* v4.12.16, written from scratch. The original extension sits at the repository root (`../`) **as a reference only**. Nothing from it is copied into this folder.

**Status:** v0.4: profile, single-post, grid/feed-item, story and highlight downloads, all saving into an existing collection (`extension/`). Live-tested on 8 October 2026:
  - A profile the old tool had already downloaded: **new 0 · already had 25 · failed 0**. Nothing was written to disk.
  - A new 49-post profile, 5 pages: **new 167 · failed 0** (138 JPG + 29 MP4, 155 MB). Every file is non-empty, has real JPEG/MP4 header bytes, and parses back to a unique key.
  - The same profile run again: **new 0 · already had 167**.
  - v0.2, single post (8-slide carousel already saved by the profile run): **new 0 · already had 8**. Then two profiles reached inside the app in the same tab, with one folder pick: **already had 167** and **already had 25**.
  - v0.3:
    - Profile grid: 12/12 tiles got a button. A tile save reported **already had 8**, and the page didn't navigate.
    - Home feed: buttons sit on the media, clear of the "…" menu, and each resolves to that post's own owner.
    - Explore: 4/4 tiles got a button. Pressing it doesn't open the post.
    - Feed and explore posts were resolved but not saved, to keep unrelated accounts out of the collection.
  - v0.4:
    - **⬇ Stories** on a profile with 3 highlights (4 items): **new 4**. Running it again: **already had 4**. The highlight page's **Save highlight** then reported **already had 2**.
    - Active stories of an account with no visible posts resolved to 4 items with their own IDs. They were not saved, and the account still shows "not seen" in the tray. Study notes: `docs/`.

## Using v0.4

1. Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `igd/extension/`. The old extension can stay installed; the two don't share storage or buttons.
2. Open a profile, for example `https://www.instagram.com/<user>/`, and a **⬇ Download @user** button appears in the bottom-right corner, above Instagram's Messages button. On a post or reel page (`/p/…`, `/reel/…`, `/reels/…`) the button is **⬇ Save post** instead, and saves every slide into `<root>/<owner>/`.
   Grid tiles (profile, tagged, explore, saved) and home-feed posts get a round **⬇** button when you hover them. It saves that post, exactly like **Save post**, without opening it.
   Stories:
   - On a profile, **⬇ Stories** saves the active stories plus every highlight.
   - On `/stories/<user>/`, **Save @user's stories** saves the active stories.
   - On `/stories/highlights/<id>/`, **Save highlight** saves that highlight.
   - All of these go to `<root>/<user>/stories/`. Each story keeps its own ID in the file name, so a story that is also in a highlight is saved once.
   - Downloading never marks stories as seen.
3. On the first click in a tab, pick the **root** folder of your collection (the one that contains the account folders, e.g. `IG`). The folder is remembered for that tab: moving between profiles and posts inside Instagram needs no new pick, but a new tab or a reload does. The 📁 button changes it.
4. The status line shows progress: page, new, already had, failed. Failed items are listed in the DevTools console. Running it again only fetches what's missing.

What it does, and which doc each rule comes from:
- Lists posts with Instagram's own profile-posts GraphQL query, from the page world [3].
- Names files exactly like the old tool [4] and skips any media already present, matched on **username + pk** [4].
- Never overwrites a non-empty file. Creates a file only after a successful, status-checked download, so failures leave nothing behind [6].
- Writes each page as it arrives, waits 1.5 s between pages, and backs off 60 / 120 / 300 s on HTTP 429 [3, 6].
- Keeps the folder only in the extension's isolated memory. Anything stored on instagram.com could be read, and used to write into your collection, by any script on the page [6]. Re-asks if the folder was moved or deleted.
- Treats replies from the page as untrusted, because any page script can answer them. Only Instagram-shaped usernames and IDs and Instagram CDN URLs are accepted.
- No telemetry, no host permissions, no web-accessible resources [5].

Not yet: current-slide-only saving, a multi-profile queue, DASH video quality, per-highlight subfolders. A future version could hold the folder in an extension page, so one pick is shared across tabs.

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
