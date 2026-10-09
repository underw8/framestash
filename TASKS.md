# Tasks

Work list for igd. The `igd-task` workflow (`.claude/workflows/igd-task.js`) takes one task per run: the one you name, or the first with `status: todo`.

**Status values:**
- `todo`: not started.
- `in-progress`: a workflow run is working on it.
- `needs-check`: built and committed, but waiting for the live checks listed under it.
- `done`: live checks passed.
- `blocked`: needs a decision, with the reason in the notes.

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
  - [ ] Reload igd at chrome://extensions and reload the Instagram tab. Queue a large profile and click Stop after page 3 or so. Queue it again: its first request should be page 4, the row should end with 'resumed from page 3', and it should not list page 1 again (check the page counter in the job detail).
  - [ ] Let a resumed run finish, then queue the same profile again. It should start from page 1 (and stop early under the T8 rule), not resume.
  - [ ] Superseded by T10: 'List every post' now resumes, and Start over is the way to list from page 1. See T10's checks.
  - [ ] Stop a profile midway, then close the panel or restart Chrome, reopen it and re-queue the profile. It should still resume from the saved page.
  - [ ] Stop a profile midway, choose a different collection folder, then queue it. It should start from page 1.

## T3 · Save only the current carousel slide
- status: needs-check
- why: on a carousel, every slide's button saves the whole post; sometimes you want one slide.
- done when:
  - there's a way to save just the visible slide (for example a modifier key or a second action);
  - it still saves into `<root>/<owner>/` under the same naming and dedup rules;
  - the whole-post behaviour stays the default.
- live checks:
  - [ ] Pass T11's live checks. They replace the Alt-click checks, since T11 removed Alt-click.
  - [ ] In DevTools on a carousel, confirm that the last path segment of the shown `<img>` `currentSrc` equals the last path segment of one of that slide's `image_versions2.candidates[].url` in the PolarisPostRootQuery reply (playbook step 3). Then the docs/03 'to verify' note can be cleared.

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
  - [ ] In DevTools, check that `PolarisStoriesV3ReelPageStandaloneQuery` → `reels_media[].title` holds the highlight's display name (playbook steps 3–6). Then clear the 'to confirm' note in docs/03. If `title` is missing, folders are named by the highlight id.
  - [ ] Move a file from `stories/<title>/` up into `stories/` and re-run. It should count as 'already had' and not be downloaded into the highlight folder again.

## T5 · DASH video quality
- status: needs-check
- why: Instagram's GraphQL nodes carry `video_dash_manifest` with higher qualities than the progressive MP4 igd saves today (`docs/03`).
- done when:
  - there's a design note in `docs/` covering manifest parsing and how to combine the video and audio tracks in the browser, with what it costs;
  - there's a go/no-go decision. If go, it's an opt-in setting, and files stay named the same so dedup still holds.
- notes: design note is `docs/12-dash-video.md`; decision is no-go until the probe shows a real gain. No code changes.
- live checks:
  - [ ] On a logged-in instagram.com tab, run the probe in docs/12 ("Probe: how much higher is DASH?") on a few profiles, including one that posts reels. Record `videos`, `withManifest`, `dashTaller` and `dashUnknown` in docs/12.
  - [ ] If `withManifest` is 0, retry with `PolarisPostRootQuery` on a single reel and note in docs/12 which query carries the manifest. Clear the 'to verify' points in docs/12 from `firstRep`.
  - [ ] Only when `dashUnknown` is 0: confirm no-go if `dashTaller` is under about a quarter of the videos sampled; otherwise reopen T5 as a 'go' per the docs/12 decision section.

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
  - [ ] Reload igd at chrome://extensions and reload the Instagram tab. Queue a profile you have never fully run: it lists to the last page.
  - [ ] Queue the same profile again: it stops after the first page or two with 'stopped early', and the request count in the panel is small.
  - [ ] On a profile with pinned posts that are already saved, run it twice and confirm the second run doesn't stop because of the pinned posts. If you can, also confirm in DevTools that pinned nodes come first with older `taken_at`, as docs/03 now says.
  - [ ] Stop a profile run mid-way, then queue it again: it lists to the end.
  - [ ] Turn on 'List every post' and queue a fully listed profile: it lists every page and the row reads '@x posts (full)'.
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
  - [ ] Reload igd at chrome://extensions and reload the Instagram tab. Queue a large profile from the panel and Stop it after page 3. Queue it again: the queued row shows Start over. Click it, and the job should list from page 1 with no 'resumed from page' note.
  - [ ] Repeat with the in-page Download @user button instead of the panel: the queued row shows Start over and it works the same.
  - [ ] Stop a profile midway, turn on List every post and queue it. It should resume from the saved page (no Start over clicked), list to the end, and not stop early.
  - [ ] Click Start over on a queued row, then close and reopen the panel before it runs. It should still start from page 1.
  - [ ] Keyboard only: Tab to Start over and press Enter. Focus should land on Remove, and VoiceOver should read 'Start over @user posts'. Check light and dark mode.
  - [ ] A queued profile with no saved position (or a story/post job) shows no Start over button.

## T11 · Second button for one carousel slide
- status: needs-check
- why: saving one slide with Alt-click (T3) is hard to discover. The user chose a visible second button.
- done when:
  - on a carousel post, a small second button next to the per-item download button saves only the visible slide. Single-image and video posts don't show it.
  - the main button still saves the whole post. Alt-click is removed.
  - the new button requires event.isTrusted, finds posts without Instagram class names, has a title and aria-label, and matches the existing per-item button style.
  - saving, naming and dedup are unchanged (`<root>/<owner>/`, pk).
  - README describes the new button; the existing test suites pass.
- live checks:
  - [ ] Reload igd at chrome://extensions and reload the Instagram tab. On a carousel post page (/p/…), hover a slide: two round buttons appear top-left, and the second one has the slide icon and reads 'Save only this slide (igd)' as its tooltip.
  - [ ] Swipe to slide 3 and click the slide button. The panel row reads 'post CODE (one slide)', and exactly one file, slide 3's media named `<owner>_<taken_at>_<id>.<ext>`, is saved in `<root>/<owner>/`.
  - [ ] Click the main button on the same post. The whole post is saved, and slide 3 is counted as 'already had' (pk dedup holds).
  - [ ] Alt-click the main button: it saves the whole post, so the Alt shortcut is gone.
  - [ ] In the home feed, check that a single-image post and a single-video post show only the main button, and that a carousel post shows both. Clicking the slide button on a carousel post that is not the one you last swiped saves that post's visible slide.
  - [ ] On a profile grid, tiles show only the main button and do not navigate when it is clicked.
  - [ ] Click the slide button on a video slide inside a carousel. Note whether the video is saved or the 'couldn't tell which slide' warning appears.
