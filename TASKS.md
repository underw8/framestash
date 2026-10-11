# Tasks

Work list for Framestash. The `fs-task` workflow (`.claude/workflows/fs-task.js`) takes one task per run: the one you name, or the first with `status: todo`.

**Status values:**
- `todo`: not started.
- `in-progress`: a workflow run is working on it.
- `needs-check`: built and committed, but waiting for the live checks listed under it.
- `done`: live checks passed.
- `blocked`: needs a decision, with the reason in the notes.
- `dropped`: removed by the user; kept for the record.

When you add a task, keep the same shape: a `## T<n> · title` heading, then the bullets.

## T1 · Queue survives closing the panel
- status: done
- why: closing the side panel drops every queued and running job, which hurts long profile downloads.
- done when:
  - queued jobs are kept in the extension's own storage and come back when the panel reopens;
  - a job that was running when the panel closed restarts;
  - finished jobs aren't re-run;
  - the existing test suites still pass.
- live checks:
  - [x] Reload igd at chrome://extensions. Queue 2–3 profiles in the panel, close the side panel while the first one is running, then reopen it from the toolbar icon. All of them should be listed again as queued, the first one should restart, and files that were already saved should count as 'already had'.
  - [x] Let one job finish, then close and reopen the panel. The finished job should not run again (it is no longer listed), and only the jobs that were still pending come back.
  - [x] With the panel closed, click an igd button on an Instagram post. The panel should open with the earlier saved queue plus the new job, and nothing should be lost.
  - [x] Restart Chrome with jobs still queued and open the panel. The jobs should come back, and the queue should wait for 'Allow access' before running.

## T2 · Resume an interrupted profile download
- status: needs-check
- why: re-running a profile skips saved files but lists every page again from the start, which is slow and hits Instagram's limits on big profiles.
- done when:
  - the profile listing cursor is saved per account while a run is in progress;
  - a re-run continues from the saved cursor;
  - a completed run clears the cursor;
  - there's an explicit way to start over.
- live checks:
  - [x] Reload igd at chrome://extensions and reload the Instagram tab. Queue a large profile and click Stop after page 3 or so. Queue it again: its first request should be page 4, the row should end with 'resumed from page 3', and it should not list page 1 again (check the page counter in the job detail).
  - [x] Let a resumed run finish, then queue the same profile again. It should start from page 1 (and stop early under the T8 rule), not resume.
  - [x] Superseded by T10: 'List every post' now resumes, and Start over is the way to list from page 1. See T10's checks.
  - [ ] Stop a profile midway, then close the panel or restart Chrome, reopen it and re-queue the profile. It should still resume from the saved page.
  - [ ] Stop a profile midway, choose a different collection folder, then queue it. It should start from page 1.

## T3 · Save only the current carousel slide
- status: dropped
- why: on a carousel, every slide's button saves the whole post; sometimes you want one slide.
- done when:
  - there's a way to save just the visible slide (for example a modifier key or a second action);
  - it still saves into `<root>/<owner>/` under the same naming and dedup rules;
  - the whole-post behaviour stays the default.
- notes: the user removed single-slide saving; the action-row icon and grid-tile button save the whole post.

## T4 · Per-highlight subfolders
- status: needs-check
- why: every story and highlight goes to `<user>/stories/`, so highlights can't be told apart.
- done when:
  - there's an option to save each highlight into `<user>/stories/<highlight title or id>/`;
  - dedup by pk still works across these folders (a story already saved elsewhere isn't downloaded again);
  - the default layout is unchanged.
- live checks:
  - [ ] Reload igd at chrome://extensions and reload the Instagram tab. With "Highlights in their own folders" off, queue a profile's Stories & highlights. Everything should land in `<user>/stories/` with no subfolders, as before.
  - [ ] Turn the switch on, close and reopen the panel: it should still be on. Queue the same profile again. Nothing new should be downloaded (every item counts as 'already had'), and no files should be written into highlight subfolders.
  - [ ] With the switch on, download a highlight not saved before (from its `/stories/highlights/<id>/` page). Its items should go to `<user>/stories/<highlight title>/`. Active stories from the same run stay in `<user>/stories/`.
  - [x] In DevTools, check that `PolarisStoriesV3ReelPageStandaloneQuery` → `reels_media[].title` holds the highlight's display name (playbook steps 2–5). Then clear the 'to confirm' note in docs/instagram-api.md. If `title` is missing, folders are named by the highlight id.
  - [ ] Move a file from `stories/<title>/` up into `stories/` and re-run. It should count as 'already had' and not be downloaded into the highlight folder again.

## T5 · DASH video quality
- status: needs-check
- why: Instagram's GraphQL nodes carry `video_dash_manifest` with higher qualities than the progressive MP4 igd saves today (`docs/instagram-api.md`).
- done when:
  - there's a design note in `docs/` covering manifest parsing and how to combine the video and audio tracks in the browser, with what it costs;
  - there's a go/no-go decision. If go, it's an opt-in setting, and files stay named the same so dedup still holds.
- notes: design note is `docs/dash-video.md`; decision is no-go until the probe shows a real gain. No code changes.
- live checks:
  - [ ] On a logged-in instagram.com tab, run the probe in docs/dash-video.md ("Probe: how much higher is DASH?") on a few profiles, including one that posts reels. Record `videos`, `withManifest`, `dashTaller` and `dashUnknown` in docs/dash-video.md.
  - [ ] If `withManifest` is 0, retry with `PolarisPostRootQuery` on a single reel and note in docs/dash-video.md which query carries the manifest. Clear the 'to verify' points in docs/dash-video.md from `firstRep`.
  - [ ] Only when `dashUnknown` is 0: confirm no-go if `dashTaller` is under about a quarter of the videos sampled; otherwise reopen T5 as a 'go' per the docs/dash-video.md decision section.

## T6 · Stop a running job, remove queued ones
- status: needs-check
- why: a job can't be stopped once started. Since T1, closing the panel doesn't stop it either, because it restarts when the panel reopens.
- done when:
  - the running job in the panel has a **Stop** button; queued jobs have a **Remove** button.
  - Stop takes effect at the next safe point: before the next file download and before the next page request, including during a 429 back-off wait. The job ends as "stopped", with how many files were saved before stopping.
  - stopped and removed jobs are dropped from the saved queue, so they don't come back when the panel reopens.
  - the next queued job starts after a stop.
  - no partial files are left behind; a later re-run skips what's already saved.
  - the controls are real buttons, keyboard-reachable and labelled, and match the panel's style.
  - the existing test suites pass, and new pure logic is unit-tested.
- live checks:
  - [x] Reload igd at chrome://extensions. Queue 2 profiles, and click Stop on the running one partway through. It should end as 'Stopped · new N · already had M · failed 0' and the second profile should start by itself.
  - [x] Click Remove on a queued job. It should disappear. Then close and reopen the side panel: neither the stopped nor the removed job comes back, and only the others are listed.
  - [x] Re-queue the stopped profile. Files saved before the stop count as 'already had', and the account folder has no 0-byte or .crswap leftovers.
  - [ ] If you hit a 429 ('Instagram is rate-limiting; waiting … s'), click Stop. The job should stop within a second instead of waiting out the back-off.
  - [x] Keyboard only: Tab to the Stop or Remove button while a job is making progress. Focus should stay on it as the progress text updates, Enter/Space should activate it, and a screen reader (VoiceOver) should read 'Stop @user posts' or 'Remove @user posts'. Check the look in both light and dark mode.

## T7 · Rate-limit guard
- status: needs-check
- why: Instagram blocks accounts ("action blocked", checkpoint or login challenges) that make sustained, regular, high-volume requests. Today igd waits a fixed 1.5 s between profile pages, doesn't pause between downloads or jobs, and keeps retrying after a 429.
- done when:
  - one shared pacer in the panel paces every Instagram request (bridge calls) and every CDN download, with random jitter: API calls 3–6 s apart, CDN downloads 0.3–1 s apart, 30–90 s between jobs, and a 5–10 min break about every 150 API calls.
  - API calls are counted against an hourly and a daily budget (defaults 200 per hour and 1,500 per day), kept in the extension's storage so closing the panel or restarting Chrome doesn't reset them. When a budget runs out, the queue holds and the panel says when it resumes.
  - circuit breaker: a 429, a "please wait" / feedback_required / checkpoint / challenge reply, a redirect to a login or challenge page, or a reply that isn't the expected data holds the whole queue instead of retrying. The panel explains why. The cool-down is at least 30 min and doubles on repeated trips. A challenge or login problem never resumes by itself: the panel shows a Resume button for the user.
  - the existing 60/120/300 s retry is replaced by the breaker.
  - the pacing numbers and budgets are settings in the panel, with these defaults.
  - Stop still takes effect within a second during any wait.
  - the pure logic (jittered delays, budget windows, error classification, cool-down growth) is unit-tested; the existing test suites pass.
- live checks:
  - [x] Reload igd at chrome://extensions. Queue a large profile and watch the job detail: page requests should be 3–6 s apart, and the file count should climb about one file per 0.3–1 s.
  - [x] Queue two profiles. After the first finishes, the second should show a 30–90 s wait before its first request.
  - [x] Open the Pacing settings, set the hourly budget to 3 and run a profile. After 3 requests, the panel should say the queue is holding until a time about an hour after the first request. Close and reopen the panel (or restart Chrome): the hold and its time should still be shown. Reset to defaults afterwards.
  - [ ] Click Stop during each kind of wait (API gap, job gap, budget hold, breaker hold). The job should end as 'Stopped' within a second.
  - [ ] Breaker, timed: if a real 429 or 'please wait' happens (or simulate one by temporarily returning {error:'HTTP 429',status:429} from page.js), the panel should show the reason and a resume time 30 min out. No retry should happen before then, and a second trip should show 60 min.
  - [x] Breaker, manual: log out of Instagram in the tab and run a job. The panel should explain it's a login problem and show a Resume button, with no automatic resume. Log back in and click Resume: the job should continue from the same call.
  - [ ] Check the hold card and Pacing settings in light and dark mode, and with keyboard only: the Resume button and the inputs are reachable and labelled, and VoiceOver reads the hold text.

## T8 · Incremental re-runs
- status: needs-check
- why: re-running a profile lists every page again, even when only a few posts are new. That's the largest source of avoidable Instagram requests.
- done when:
  - Instagram lists posts newest first, so a profile run stops listing after 12 posts in a row that are already in the collection.
  - pinned posts at the top of a profile (old posts listed first) don't count towards the 12 and don't end the run.
  - early stop only applies when an earlier run of that account listed to the end; the account's "listed to the end" state is kept in the extension's storage. A first run, or a run after an interrupted one, lists to the end.
  - there's an explicit way to force a full listing for a profile.
  - stories and single posts are unchanged.
  - the stop rule is unit-tested; the existing test suites pass.
- live checks:
  - [x] Reload igd at chrome://extensions and reload the Instagram tab. Queue a profile you have never fully run: it lists to the last page.
  - [x] Queue the same profile again: it stops after the first page or two with 'stopped early', and the request count in the panel is small.
  - [ ] On a profile with pinned posts that are already saved, run it twice and confirm the second run doesn't stop because of the pinned posts. If you can, also confirm in DevTools that pinned nodes come first with older `taken_at`, as docs/instagram-api.md now says.
  - [x] Stop a profile run mid-way, then queue it again: it lists to the end.
  - [x] Turn on 'List every post' and queue a fully listed profile: it lists every page and the row reads '@x posts (full)'.
  - [ ] Save a single post and a story: both behave as before.

## T9 · Pause and resume the queue
- status: needs-check
- why: Stop drops a job. Sometimes you want to halt everything for a while and continue later from the same place.
- done when:
  - the panel has one Pause button for the whole queue. The running job halts at its next safe point (the same points Stop uses) and keeps its position. Nothing new starts while paused.
  - Resume continues the running job from where it halted, then the rest of the queue.
  - paused is kept in the extension's storage: after the panel closes or Chrome restarts, the queue comes back paused, and a profile job continues from its saved listing position (T2).
  - pause shares the hold state of the T7 circuit breaker, so a breaker hold and a user pause show and resume the same way.
  - the controls are real buttons, keyboard-reachable and labelled, and match the panel's style.
  - pure logic is unit-tested; the existing test suites pass.
- live checks:
  - [x] Reload igd at chrome://extensions. Queue a large profile and click 'Pause queue' while it lists. Within one request or download gap, the file count should stop. The hold card should read 'You paused the queue. Click Resume to continue.', and the job row should stay Running with the same text.
  - [ ] While paused, queue another job. It should stay Queued and not start.
  - [x] Click Resume. The same job should continue from the same page, with no counts reset and no repeated page, and then the queued job should run.
  - [x] Pause, then close the side panel and reopen it. The hold card should still say paused, and the job should be back in the list as Queued. Click Resume: the profile should continue with 'resumed from page N'.
  - [ ] Pause, quit and restart Chrome, then open the panel. It should still be paused. Resume should continue from the saved page.
  - [ ] While paused, click Stop on the running job. It should show Stopped within a second.
  - [ ] Keyboard only: Tab to 'Pause queue' and press Enter. Focus should move to Resume. Press Enter again: focus should go back to Pause. VoiceOver should read the hold text. Check light and dark mode.
  - [ ] If a breaker cool-down happens (or you simulate a 429 as in T7), click Pause during it and then Resume before the cool-down ends. The timed hold with its original resume time should come back, not a direct restart.

## T10 · Start over button for interrupted profiles
- status: needs-check
- why: "start over" for an interrupted profile is currently the List every post switch (T2), which mixes two things. The user chose a dedicated control.
- done when:
  - a profile job row whose account has a saved listing position shows a **Start over** button. It clears that account's saved position, and the job lists from the newest post.
  - List every post only turns off the early stop (T8). It no longer clears or ignores the saved position, so a full listing still resumes.
  - Start over works for jobs queued from the panel and from the in-page Download button.
  - the button is a real button, keyboard-reachable and labelled, and matches the panel's style.
  - README describes the new control; the existing test suites pass, and new pure logic is unit-tested.
- live checks:
  - [x] Reload igd at chrome://extensions and reload the Instagram tab. Queue a large profile from the panel and Stop it after page 3. Queue it again: the queued row shows Start over. Click it, and the job should list from page 1 with no 'resumed from page' note.
  - [x] Repeat with the in-page Download @user button instead of the panel: the queued row shows Start over and it works the same.
  - [x] Stop a profile midway, turn on List every post and queue it. It should resume from the saved page (no Start over clicked), list to the end, and not stop early.
  - [ ] Click Start over on a queued row, then close and reopen the panel before it runs. It should still start from page 1.
  - [ ] Keyboard only: Tab to Start over and press Enter. Focus should land on Remove, and VoiceOver should read 'Start over @user posts'. Check light and dark mode.
  - [x] A queued profile with no saved position (or a story/post job) shows no Start over button.

## T11 · Second button for one carousel slide
- status: dropped
- why: saving one slide with Alt-click (T3) is hard to discover. The user chose a visible second button.
- done when:
  - on a carousel post, a small second button next to the per-item download button saves only the visible slide. Single-image and video posts don't show it.
  - the main button still saves the whole post. Alt-click is removed.
  - the new button requires event.isTrusted, finds posts without Instagram class names, has a title and aria-label, and matches the existing per-item button style.
  - saving, naming and dedup are unchanged (`<root>/<owner>/`, pk).
  - README describes the new button; the existing test suites pass.
- notes: the user removed single-slide saving; the action-row icon and grid-tile button save the whole post.

## T12 · Native-style download icon on posts and reels
- status: needs-check
- why: buttons that look like part of Instagram read better than floating pills. The user wants a native look for profile and post actions; the round grid-tile buttons stay as they are.
- done when:
  - **Post action bar:** in each feed post and on post pages, a download icon in the like / comment / share / save row, placed right after the save (bookmark) icon. It matches Instagram's icons: 24 px, stroke, current text colour, and the same spacing and hover. It saves the whole post.
  - **Reel side bar:** on reels, a download icon in the vertical like / comment / share / save column, styled the same way. It saves that reel.
  - placement uses page structure and post links (`shortcodeFromPath`), never Instagram class names. The icons may rely on the order of the action icons, but not on English aria-labels as the only signal. When a spot can't be found, that button simply doesn't appear, and the bottom-right panel still works.
  - the bottom-right panel (Download @user / Save post, Stories, the panel toggle and the status card) is unchanged and always shown.
  - the round grid-tile buttons are unchanged.
  - every new button requires event.isTrusted, has a title and aria-label, is keyboard-reachable, and follows Instagram's light and dark themes.
  - no flicker or duplicate buttons as Instagram re-renders or the user scrolls the feed; the existing 500 ms scan handles placement.
  - README describes the new buttons; the existing test suites pass, and any new pure logic is unit-tested.
- live checks:
  - [ ] Reload igd and the Instagram tab. On a profile, the bottom-right Download @user, Stories and panel buttons look and work as before, and nothing is added beside the username.
  - [ ] Home feed: each post's like / comment / share / save row has a download icon right after the bookmark, matching Instagram's icons. Clicking it saves that post. Scroll a long way: no duplicate icons and no flicker.
  - [ ] Post page (/p/…): the action row has the icon and the bottom-right Save post is still shown.
  - [ ] Reels (/reels/…): the side column has the icon; clicking it saves the reel shown.
  - [ ] Grid tiles look and work as before; feed posts and post pages have no buttons on the photos themselves.
  - [ ] Tab to each new button: it is reachable, has a focus ring, and VoiceOver reads its label. Check light and dark mode.

## T13 · Rename to Framestash
- status: needs-check
- live checks:
  - [ ] Reload the unpacked extension at chrome://extensions. The card shows the name Framestash, the new description and the "f." icon. The toolbar tooltip reads "Open Framestash".
  - [ ] Open the side panel. The tab title reads Framestash and the header shows "framestash." with the gradient dot, fitting in light and dark mode at the normal panel width.
  - [ ] On instagram.com, reload the tab. Hover a grid tile or the action-row icon to see "Save this post (Framestash)". Start a download and check that the status card shows the "framestash." wordmark and the Framestash status texts.
  - [ ] With an existing collection folder already chosen before the update, the panel still has the folder (no re-pick needed), and downloading a profile you already saved skips existing files and reuses the account folder (.igd.json still honoured).
  - [ ] Look at the 16/32 px toolbar icon: the "f." should be legible and the dot visible.
- why: store policy and Instagram's brand rules forbid "Instagram", "IG", "Insta" and "Gram" in a product name, so "igd: Instagram downloader" can't be published. The user chose the name Framestash.
- done when:
  - every user-visible name reads **Framestash**: the manifest `name` and `action.default_title`, the side panel title and header, the in-page status card wordmark, tooltips and labels ("Save this post (Framestash)"), status texts, README and docs. The wordmark is "framestash." with the same gradient dot.
  - the manifest has a `description` (at most 132 characters) that doesn't name Instagram as part of the product name, and `minimum_chrome_version` set to the lowest version the APIs in use need (sidePanel.open needs 116).
  - icons are redrawn in `design/` for the new name ("f." at 16/32 px, a readable mark at 48/128 px), and `render-icons.sh` rebuilds the PNGs and the README wordmarks.
  - internal identifiers that existing users' data depends on stay as they are, so nothing already saved breaks: the `.igd.json` account markers, the `.igd-trash` folder name, IndexedDB/storage names and keys. CSS classes and message names may stay `igd-*`. collection-format.md says the marker file keeps its `.igd.json` name for compatibility.
  - the README states: "Framestash is not affiliated with, endorsed by or sponsored by Instagram or Meta." Instagram is only mentioned in plain text as the site it works on.
  - the existing test suites pass.

## T14 · Licence, security and privacy policy
- status: needs-check
- live checks:
  - [ ] On GitHub, enable Settings > Code security > Private vulnerability reporting for underw8/framestash so the SECURITY.md link works.
  - [ ] Enable GitHub Pages from the main branch /docs folder and confirm https://underw8.github.io/framestash/privacy renders the policy with its effective date. Use that URL in the Chrome Web Store privacy field.
  - [ ] Open README on GitHub and click the licence, privacy and security links.
- why: the project is going open source and onto the Chrome Web Store, which requires a privacy policy for any extension that handles page content.
- done when:
  - `LICENSE` holds the MIT licence, copyright "2026 underw8".
  - `SECURITY.md` says how to report a vulnerability privately (GitHub private vulnerability reporting).
  - `docs/privacy.md` is a plain privacy policy: Framestash collects, sends and sells no data; it has no analytics or telemetry; it reads Instagram pages and media only to save them into the folder the user picks; settings and the queue stay in the browser's extension storage; the only network requests go to instagram.com and Instagram's CDN, made as the logged-in user. It's written so it can be published as-is on GitHub Pages, with an "effective date".
  - README links the licence, the privacy policy and the security policy, and has a short "Use responsibly" section: personal backup of content you have the right to keep, respect creators' rights, bulk downloading can get an Instagram account rate-limited or blocked.

## T15 · First-run notice
- status: needs-check
- why: users must understand the intended use and the account risk before the first download, as the store listing and the "Use responsibly" section say.
- done when:
  - the first time the side panel opens, it shows a notice card before anything else can run: personal use only, respect creators' rights and Instagram's terms, bulk downloading can get your Instagram account limited or blocked, nothing leaves your device. One "I understand" button dismisses it.
  - acceptance is kept in the extension's storage; the notice doesn't come back after that, and jobs that arrive before acceptance stay queued until it's accepted.
  - the card matches the panel's style, is keyboard-reachable and labelled, and works in light and dark mode.
  - pure logic, if any, is unit-tested; the existing test suites pass.
- live checks:
  - [ ] First run: reload the unpacked extension, clear the panel's state (DevTools on the panel: Application > IndexedDB > igd > kv > delete 'accepted', or reinstall), then open the side panel. Only the header and the notice card show, and the 'I understand' button has focus.
  - [ ] Keyboard: Tab or Shift+Tab reaches the button and Enter/Space dismisses the notice. A screen reader announces the region as 'Before you start'.
  - [ ] Queue while waiting: with the notice still showing, click a Download button on an Instagram post. The panel opens with the notice and nothing downloads. Click 'I understand': the job appears and starts.
  - [ ] Persistence: close and reopen the panel and reload the extension. The notice does not come back.
  - [ ] Light and dark: switch the OS appearance and check that the card's contrast matches the other cards.

## T16 · Store package and listing draft
- status: needs-check
- why: the Chrome Web Store needs a zip of the extension and listing texts, including a justification for every permission.
- done when:
  - `scripts/package.sh` builds `dist/framestash-<version>.zip` from `extension/` only (no tests, docs, design or dotfiles), runs the test suites first, and refuses to build if they fail. `dist/` is git-ignored.
  - `docs/store-listing.md` drafts: the short description (at most 132 characters), the full description (what it does, how to use it, the not-affiliated line, the "Use responsibly" points), the single-purpose statement, a justification for each permission and host permission in the manifest, the data-use answers (no data collected), and the list of required images with sizes (128 px icon, 1280×800 screenshots, 440×280 small promo tile).
  - no claims in the listing that aren't true of the code.
- live checks:
  - [ ] Unzip dist/framestash-0.22.0.zip to a temp folder, load it via Load unpacked in chrome://extensions, and confirm the panel opens and one Save post works.
  - [ ] Read docs/store-listing.md and confirm the wording, the single-purpose statement and the privacy-policy URL before pasting it into the Web Store dashboard.
  - [ ] Make the 1280×800 screenshots and the 440×280 promo tile; they are listed but not produced by this task.

## T17 · GitHub workflows: CI, release, CodeQL, Dependabot, store publish
- status: needs-check
- live checks:
  - After pushing, the CI run on GitHub's Actions tab is green and has a framestash-zip artifact; a PR also triggers CI and CodeQL.
  - If the repo has CodeQL 'default setup' turned on under Settings > Code security, switch it to advanced (or delete codeql.yml), or the uploads conflict.
  - Settings > Actions > General allows GitHub-owned actions and the workflows aren't rejected
  - Dependabot shows a github-actions entry under Insights > Dependency graph > Dependabot.
  - Optional: push a test tag that doesn't match the manifest (e.g. v0.0.1) and confirm release.yml fails, then delete the tag. Pushing v0.22.0 should create a Release with the zip.
  - publish.yml does nothing on its own. After the first manual store submission and the secrets are added, follow docs/releasing.md to uncomment the release trigger.
- why: the repo is public and headed for the Chrome Web Store. Pushes and pull requests need automatic checks, tags need a release with the zip, and store updates should not be manual uploads.
- done when:
  - only GitHub-owned actions are used (`actions/*`, `github/codeql-action`), pinned to a full commit SHA with the version in a comment, because the repo allows GitHub-owned actions only. Every workflow sets `permissions:` explicitly, least privilege (contents: read unless a job needs more).
  - **`.github/workflows/ci.yml`** on push and pull_request: runs the three test suites and `node --check` on every `extension/*.js`; validates `extension/manifest.json` (parses as JSON; every file it references exists; `version` is 1–4 dot-separated integers; `description` at most 132 characters) with a small Node script under `scripts/`; builds the zip with `scripts/package.sh` and uploads it as a run artifact.
  - **`.github/workflows/release.yml`** on push of tags `v*`: fails if the tag (without `v`) differs from the manifest version; runs the same checks; builds the zip; creates a GitHub Release for the tag with the zip attached, using the `gh` CLI (contents: write only in this job).
  - **`.github/workflows/codeql.yml`**: CodeQL for JavaScript on pull_request, push to main and a weekly schedule (security-events: write).
  - **`.github/dependabot.yml`**: weekly updates for the `github-actions` ecosystem.
  - **`.github/workflows/publish.yml`**: uploads the release zip to the Chrome Web Store API v2 and submits it for review, using `curl` only. It exchanges `CWS_REFRESH_TOKEN` with `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET` at `https://oauth2.googleapis.com/token`, then calls `POST https://chromewebstore.googleapis.com/upload/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:upload` and `POST https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:publish`, failing on any non-2xx reply and never echoing tokens. Its `on:` trigger (release published, plus workflow_dispatch) is **commented out**, with a comment explaining it is enabled after the first manual store submission; the file must still be valid YAML that GitHub accepts (use an `on:` that never fires, e.g. workflow_dispatch only, or document the exact choice).
  - `docs/releasing.md` explains the release flow: bump the manifest version, tag `vX.Y.Z`, push the tag; and the one-time store setup for publish.yml (first manual submission, OAuth client in Google Cloud, refresh token with the `https://www.googleapis.com/auth/chromewebstore` scope, the five repository secrets, then un-commenting the trigger). README links it.
  - the workflow YAML files parse (check them locally with a YAML parser if one is available, otherwise by careful review), and the local test suites still pass.

## T18 · Claude Code agents, rules and hooks for the task workflows
- status: needs-check
- live checks:
  - Open /agents in Claude Code in this repo and confirm all six fs-* agents are listed with the expected tools and model.
  - Run /permissions (or try an Edit under ~/Downloads/IG) and confirm the deny rules are active and the routine node/git checks run without a prompt.
  - Make a deliberate syntax error in an extension/*.js file through Claude, and confirm the PostToolUse hook reports it back.
  - Run the fs-task workflow on a small todo task and confirm each step shows its fs-* agent, reviewers make no edits, and the finisher makes exactly one commit.
- why: workflow steps restate the project rules in every prompt, reviewers could edit files, and a Finish step once refused to commit after misreading its context. Custom agents, path-scoped rules and hooks make each step narrow and enforce the rules mechanically.
- done when:
  - **Agents** in `.claude/agents/` (frontmatter: name, description, tools, model, effort as fits; plain-English system prompt below it):
    - `fs-planner`: read-only tools (Read, Grep, Glob, Bash for read-only git and listing). Plans a TASKS.md item against CLAUDE.md and docs/; returns the plan, never edits.
    - `fs-builder`: Read, Edit, Write, Grep, Glob, Bash. Implements a plan, adds tests, runs the checks; never commits or pushes.
    - `fs-reviewer-security`, `fs-reviewer-compat`, `fs-reviewer-correctness`: read-only tools. Each holds its lens checklist (today's LENSES prompts in fs-task.js, expanded with the scoped rules below) and reports findings only.
    - `fs-finisher`: model sonnet, effort low; Read, Edit, Bash. Runs the checks, updates README/TASKS.md status and live checks, makes exactly one commit with the attribution lines; never pushes; never refuses because of unrelated context in the conversation.
  - `.claude/workflows/fs-task.js` uses these via `agentType`, so prompts carry only the task-specific text; per-call model/effort overrides move into the agent files. `fs-tasks.js` keeps working.
  - **Rules** in `.claude/rules/` with `paths` frontmatter:
    - `content-script.md` (`extension/content.*`): no Instagram class names; every handler requires isTrusted; clicks in capture phase; no filter, backdrop-filter or transform on per-tile elements (they paint long grids black); action rows are thin strips (at most 96 px across), and grid rows get the icon inside the bookmark cell.
    - `collection.md` (`extension/naming.js`, `extension/collection.js`, `test/**`): dedup by pk only, never overwrite, `.igd.json` and other legacy ids keep their names, test data uses made-up usernames and ids.
    - `page-world.md` (`extension/page.js`): never call story "seen" mutations; replies are untrusted; provided variables come from the query definition; block replies pass through as flags.
    - `github.md` (`.github/**`): GitHub-owned actions only, pinned to a full SHA with the version comment; explicit least-privilege permissions; no secrets echoed.
  - CLAUDE.md keeps the overview and security invariants and points to the rules instead of repeating their details.
  - **`.claude/settings.json`** (project, committed):
    - `permissions.deny` for Edit, Write and Bash on the user's collection `/Users/underw8/Downloads/IG/**` (and `~/Downloads/IG/**`), so no agent writes there; only the extension does.
    - no `permissions.allow`: allowing repo scripts or git without a prompt equals allowing any code an agent has edited (and git runs programs from `.git/config`). The session's own permission mode decides prompts.
    - the `Bash` deny on `~/Downloads/IG` is best-effort; a command can reach the folder without naming it. The Edit/Write denies are the reliable part.
    - a `PostToolUse` hook on Edit|Write that runs `node --check` on the edited file when it is `extension/*.js` and reports a syntax error back (exit code 2), using a small script under `.claude/hooks/`.
    - a `Stop`/`SubagentStop` check is optional; add it only if it can't loop or slow every turn; otherwise skip and say why.
  - the hook script works when run by hand on a good and a broken file; settings.json is valid JSON; the existing test suites pass.

## T19 · No Download button on Instagram's "page isn't available" screen
- status: needs-check
- why: `routeFromPath` treats any one-segment path as a profile, so a missing account (or any unknown page such as /under.w8x/) still shows "Download @name" in the corner. A job started there fails, which is harmless but confusing.
- done when:
  - the corner Download and Stories buttons stay hidden until the page shows the profile is real (for example its header with the username, found by structure as the profile routes already do), and come back when it is.
  - real profiles, including ones with dots and underscores, keep their buttons; post, reel and story pages are unchanged.
  - any new pure logic is unit-tested; the existing test suites pass.
- live checks:
  - Reload Framestash at chrome://extensions, then reload an instagram.com tab.
  - Open a missing account such as instagram.com/under.w8x/: the 'page isn't available' screen shows no Download or Stories button, and the panel button is still there.
  - Open a real profile with dots or underscores in its name: 'Download @name' and Stories appear within about half a second of the header rendering. This should also hold on its /tagged/ and /reels/ tabs.
  - Go from a missing account to a real profile through Instagram's own links (client-side navigation, no reload): the buttons come back. Going from the real profile to a missing one hides them.
  - Open a post, a reel, someone's stories and a highlight: the buttons and labels look the same as before.
  - Narrow the window to the mobile layout and open a real profile: the buttons still show, so `main header` still matches there.
- live results (2026-10-12): passed on /under.w8x/ (no Download/Stories, panel button kept), on /under.w8/ and /under.w8/tagged/, and on a post page. Not run: client-side navigation between a missing and a real profile, and the mobile layout (the window didn't narrow).

## T20 · Rename the remaining igd ids to Framestash
- status: done
- why: the extension still wrote `.igd.json` markers and used `igd` ids for its storage, classes and messages after the Framestash rename.
- done when:
  - account markers are written as `.framestash.json`, and `.igd.json` is still read when a folder has no new marker (unit-tested).
  - the panel's IndexedDB is `"framestash"`; on first open it copies the old `"igd"` database once and deletes it.
  - CSS classes, the ping reply, the postMessage tag, the queue lock, the picker id, comments, docs and the `fs-task`/`fs-tasks` workflows use the new name.
- live checks:
  - [x] Reload Framestash at chrome://extensions and reload the Instagram tab. Open the panel: the collection folder, queue and pacing state are still there (no re-pick), and DevTools > Application > IndexedDB shows `framestash` and no `igd`. (Folder and first-run notice carried over; the IndexedDB list itself was not inspected.)
  - [x] Download a post from an account you already have: it lands in the same account folder, and existing files count as 'already had'.
  - [x] On a profile, the corner buttons, grid-tile icons and post action-row icon look and work as before.

## T21 · Download icon in the story viewer's header
- status: needs-check
- why: on a story or highlight, the only way to save is the corner button, which saves the whole reel. The viewer's header (mute, pause, ⋯) should carry a download icon that saves just the item on screen, like the post action row does.
- done when:
  - on `/stories/<user>/<pk>/` and `/stories/highlights/<id>/`, a download icon sits between Instagram's pause and ⋯ buttons, found by structure (a row of 24 px icon buttons in the viewer's top bar), matching their size and colour; no Instagram class names or English labels.
  - clicking it saves only the item on screen: the pk from the story URL, or for a highlight (whose URL has no item id) the item at the active progress-bar segment's index. The job is validated in `validJob` and the panel filters the listed reel to that one item before saving.
  - no story "seen" mutation is sent; live checks use the author's own highlights only.
  - the corner Download button keeps saving the whole reel; pure logic (segment index, item pick) is unit-tested.
- notes (measured live on the author's own highlight, October 2026, viewer 524 px wide):
  - the header row is one flex container (524×40) with three children: the account block (avatar, title, age), a 64×32 group holding mute (32×32) and play/pause (a 34×34 role=button with a 17 px filled svg), then ⋯ (a 40×40 role=button with a 24 px svg). Close (40×40) sits outside the viewer, top-right of the page. Insert the icon as a sibling just before the ⋯ button.
  - a 34×34 button with the 20 px stroke download icon in white matches the row (checked by injecting it); the viewer is always dark, so the icon is white rather than the action row's currentColor.
  - the progress bar sits 10 px above the row: one track per item (2 px high, white at 35 %), each with a white fill child. The test highlight has one item, so the multi-item index rule (count tracks before the one whose fill is not full) still needs a live check on a highlight with 2+ items.
  - media is a blob video or an img with no item id in its URL, so the segment index is the only structural way to identify the highlight item; React internals stay off-limits.
  - clicks must stay in the capture phase (as for .framestash-act) so Instagram doesn't advance to the next item.
- live checks: Reload the extension and the Instagram tab. On one of your own active stories (`/stories/<you>/<pk>/`), the download icon sits between pause and ⋯, is the same height and white, and clicking it doesn't advance or close the viewer.; Click the icon on story 2 of 3 or more of your own active stories: the panel saves exactly that pk into `<root>/<you>/stories/` and the job label shows that pk.; On your own highlight with 2 or more items, move to item 2 (pause it, then click): only item 2 is saved. Repeat with item 1 and the last item. This confirms that `reels_media.items` order matches the segments; then add that line to docs/instagram-api.md.; The corner 'Save highlight' / 'Save @you's stories' button still saves the whole reel.; With DevTools Network open, confirm that the clicks send only `PolarisStoriesV3ReelPageStandaloneQuery` (plus topsearch for stories) and no 'seen' mutation.; In the console, running `document.querySelector('.framestash-story').click()` starts no job (isTrusted check).
- live results (2026-10-12): on the author's own one-item highlight, the icon sits between pause and ⋯ (34 px, white), clicking it keeps the viewer on the same item and paused, and the job 'highlight … item 1' ended 'new 0 · already had 1'. Not run yet: active stories, the Network check for seen mutations.
- live results (2026-10-12, a friend's 34-item highlight, with the user's consent): two bugs found and fixed (photo items have no mute button, so the icon was missing; only the active segment holds a fill element, so item 1 was always picked). After the fixes the icon shows on photo items, item 7 resolved to index 6, the viewer stayed paused on it, and the job ended 'new 1'. Pending: the user confirms the saved file is item 7.
