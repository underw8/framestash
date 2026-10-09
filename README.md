# igd: our Instagram downloader (clean-room rebuild)

This folder is our own replacement for *a reference extension* v4.12.16, written from scratch. The original extension sits at the repository root (`../`) **as a reference only**. Nothing from it is copied into this folder.

**Status:** igd downloads profiles, single posts, grid and feed items, stories and highlights into an existing collection. All saving happens in an **igd side panel**, which holds the folder once for every tab and runs a **download queue**. The extension is in `extension/`; history and test results are in the git log. Study notes are in `docs/`.

## Using igd

1. **Install.** Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `igd/extension/`. Pin igd to the toolbar. The old extension can stay installed; the two don't share storage or buttons.
2. **Choose the folder.** Click the igd icon to open the **side panel**, then **Choose** and pick the **root** folder of your collection: the one that contains the account folders, e.g. `IG`. It's remembered across tabs and restarts. After a browser restart, one click on **Allow access** restores it.
   - **Queue profiles:** paste usernames or profile URLs, one per line. Choose Posts and/or Stories & highlights, then **Add to queue**. A re-run of a profile that was fully listed before stops after 12 posts in a row you already have; turn on **List every post** to force a full pass. An interrupted profile run continues from the page where it stopped; **List every post** starts over from the top. Jobs run one after another, using any open, logged-in Instagram tab. The running job has a **Stop** button and queued jobs a **Remove** button; files already saved are kept.
   - **Check collection:** a read-only report, shown in the panel. It lists duplicates, empty files, saved error pages, unrecognised names, and accounts split across folders.
   - **Closing the panel pauses the queue.** Queued and interrupted jobs come back when it reopens; any igd button in Instagram reopens it. A restarted profile job continues listing from the page where it stopped; files already saved are skipped.
3. **Download from Instagram.** igd adds buttons in the bottom-right corner, above Instagram's Messages button:
   - **Profile:** **Download @user** saves every post. **Stories** saves the active stories plus every highlight.
   - **Post or reel page** (`/p/…`, `/reel/…`, `/reels/…`): **Save post** saves every slide into `<root>/<owner>/`.
   - **Story page** (`/stories/<user>/`) or **highlight page** (`/stories/highlights/<id>/`): saves those stories. Stories go to `<root>/<user>/stories/`. Downloading never marks a story as seen.
   - **Grid tiles and home-feed posts:** a round download button appears on hover and saves that post without opening it.
   - **Magnifier icon:** runs the collection check. **Panel icon:** opens the side panel.

   Every button sends a job to the panel's queue, opening the panel first if it's closed, and the status card shows the job's progress.
4. **Re-run any time.** A job run again only fetches what's missing. A profile re-run stops listing after 12 already-saved posts in a row (pinned posts aside), once a previous run of it listed to the end; posts deleted from disk below that point come back only with **List every post**. An interrupted profile (Stop, closed panel, error) picks up its listing where it stopped instead of starting again from page 1. Failed items are listed in the panel's DevTools console.
5. **After updating igd**, reload open Instagram tabs. Chrome only adds the new scripts to pages loaded after the update, and igd tells you when this is needed.

## What it does

The numbers in brackets point to the study notes in `docs/`.

- **Data:** lists posts and stories with Instagram's own GraphQL queries, from the page world. Query IDs, tokens and query flags are read at runtime, never hardcoded [3].
- **Naming:** files are named exactly like the old tool's: `<root>/<username>/<username>_<taken_at>_<id>.<ext>` [4].
- **Duplicates:** media already present is skipped, matched on the media **pk** alone. A pk is unique across Instagram, so this survives renames and every old name format.
- **Account folders** are tied to their owner's **user ID** through a hidden `.igd.json`, written the first time igd saves there.
  - A renamed account keeps its old folder. Folders are never renamed, and new usernames are recorded as aliases.
  - Old folders without the file are recognised from the `_<ownerId>` in their file names.
  - A folder is never shared by two accounts. If a username now belongs to someone else, that account gets `<username>_<userId>/`.
- **Writing:** never overwrites a non-empty file. A file is created only after a successful, status-checked download, so failures leave nothing behind. The 0-byte, `.error.txt` and corrupt files the old tool left are reported by the check, never deleted [6].
- **Pacing:** each page of posts is written as it arrives. One pacer in the panel spaces every Instagram request 3–6 s apart, CDN downloads 0.3–1 s apart and jobs 30–90 s apart (all jittered), takes a 5–10 min break about every 150 requests, and keeps to a budget of 200 requests per hour and 1,500 per day that survives restarts. All of these are settings in the panel [3].
- **Circuit breaker:** a 429, a "please wait" / feedback_required reply, or a reply that isn't the expected data holds the whole queue for 30 min, doubling on each repeated trip (capped at 24 h). A login or checkpoint/challenge reply holds it until you click Resume [3, 6].
- **Pause:** Pause queue halts the running job at its next request or download and starts nothing new until you click Resume. The pause survives closing the panel and restarting Chrome; a profile job then continues from its saved listing position.
- **Security:**
  - The folder handle is stored only in the panel's own extension storage, which pages on instagram.com can't reach [6].
  - Instagram tabs only list posts and stories. The panel validates every record and does all fetching and writing.
  - Replies from the page are untrusted: only Instagram-shaped usernames and IDs, and Instagram CDN URLs, are accepted.
  - igd buttons respond only to real user clicks (`isTrusted`), so page scripts can't trigger downloads.
- **Privacy:** no telemetry and no web-accessible resources [5]. Permissions are `sidePanel`, plus host access to instagram.com and Instagram's CDN so the panel can fetch media.

**Not yet:**
- saving only the current carousel slide
- resuming an interrupted profile run from where it stopped
- DASH video quality
- per-highlight subfolders

**When Instagram changes something,** re-run playbook steps 5–6 (`docs/11`) and update `docs/03` before changing code.

## Working on tasks

Open work lives in `TASKS.md`. The saved workflow `igd-task` (`.claude/workflows/igd-task.js`) takes **one task per run**:

1. **Pick:** it needs a clean working tree. It takes the task you name (e.g. `T2`), or the first one with status `todo`.
2. **Plan:** a short design against `CLAUDE.md` and `docs/`.
3. **Build:** the change, plus tests.
4. **Review:** security, collection-compatibility and correctness reviews, with up to two reviewed fix rounds.
5. **Finish:** one commit. The task is set to `needs-check`, with the live checks only you can do (reloads, real clicks, folder picks).

Start it in Claude Code by asking it to run the `igd-task` workflow, optionally naming the task.

## Look and feel

- **In-page buttons and status card:** they read Instagram's own theme variables, so they follow its light and dark modes. They match its floating Messages button: raised surface, hairline edge, shadow, pill shape and the `--hover-overlay` hover.
- **Side panel:** modelled on Instagram's Settings pages (measured live), following the system light or dark setting.
- **Wordmark igd.:** heavy sans-serif with a warm-to-violet gradient dot.
  - The toolbar icon is a near-black rounded square, so it isn't mistaken for Instagram's app icon.
  - Icons are stroke SVGs drawn for igd.
  - The logo sources are in `design/`; `render-icons.sh` rebuilds the PNGs. `wordmark.svg` is the brand master; the panel draws the wordmark in CSS.

## Checks

```bash
node igd/test/naming.test.js       # naming, dedup keys, routing, owner inference, file sniffing, queue entries
node igd/test/collection.test.js   # folder resolution (renames, reused usernames, conflicts) and the collection check
node igd/test/pacer.test.js        # pacing, budgets, block-signal classification and cool-downs
```

## Layout

```text
tdi/                    original extension (reference, unlicensed, not ours)
├── js/ css/ icons/     shipped bundles, plus a local patch and *.bak originals
└── igd/                ← our rebuild
    ├── extension/      the MV3 extension (load unpacked)
    ├── design/         logo sources + render-icons.sh
    ├── test/           node checks
    ├── docs/           how the original works, what broke, how to probe Instagram
    │   └── verification/   evidence behind the docs
    ├── TASKS.md        open work, consumed by the igd-task workflow
    ├── .claude/workflows/igd-task.js
    ├── README.md       this file
    └── CLAUDE.md       ground rules for working here
```
