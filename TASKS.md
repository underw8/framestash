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
- status: todo
- why: re-running a profile skips saved files but lists every page again from the start, which is slow and hits Instagram's limits on big profiles.
- done when:
  - the profile listing cursor is saved per account while a run is in progress;
  - a re-run continues from the saved cursor;
  - a completed run clears the cursor;
  - there's an explicit way to start over.

## T3 · Save only the current carousel slide
- status: todo
- why: on a carousel, every slide's button saves the whole post; sometimes you want one slide.
- done when:
  - there's a way to save just the visible slide (for example a modifier key or a second action);
  - it still saves into `<root>/<owner>/` under the same naming and dedup rules;
  - the whole-post behaviour stays the default.

## T4 · Per-highlight subfolders
- status: todo
- why: every story and highlight goes to `<user>/stories/`, so highlights can't be told apart.
- done when:
  - there's an option to save each highlight into `<user>/stories/<highlight title or id>/`;
  - dedup by pk still works across these folders (a story already saved elsewhere isn't downloaded again);
  - the default layout is unchanged.

## T5 · DASH video quality
- status: todo
- why: Instagram's GraphQL nodes carry `video_dash_manifest` with higher qualities than the progressive MP4 igd saves today (`docs/03`).
- done when:
  - there's a design note in `docs/` covering manifest parsing and how to combine the video and audio tracks in the browser, with what it costs;
  - there's a go/no-go decision. If go, it's an opt-in setting, and files stay named the same so dedup still holds.

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
  - [ ] Reload igd at chrome://extensions. Queue 2 profiles, and click Stop on the running one partway through. It should end as 'Stopped · new N · already had M · failed 0' and the second profile should start by itself.
  - [ ] Click Remove on a queued job. It should disappear. Then close and reopen the side panel: neither the stopped nor the removed job comes back, and only the others are listed.
  - [ ] Re-queue the stopped profile. Files saved before the stop count as 'already had', and the account folder has no 0-byte or .crswap leftovers.
  - [ ] If you hit a 429 ('Instagram is rate-limiting; waiting … s'), click Stop. The job should stop within a second instead of waiting out the back-off.
  - [ ] Keyboard only: Tab to the Stop or Remove button while a job is making progress. Focus should stay on it as the progress text updates, Enter/Space should activate it, and a screen reader (VoiceOver) should read 'Stop @user posts' or 'Remove @user posts'. Check the look in both light and dark mode.

## T7 · Rate-limit guard
- status: todo
- why: Instagram blocks accounts ("action blocked", checkpoint or login challenges) that make sustained, regular, high-volume requests. Today igd waits a fixed 1.5 s between profile pages, doesn't pause between downloads or jobs, and keeps retrying after a 429.
- done when:
  - one shared pacer in the panel paces every Instagram request (bridge calls) and every CDN download, with random jitter: API calls 3–6 s apart, CDN downloads 0.3–1 s apart, 30–90 s between jobs, and a 5–10 min break about every 150 API calls.
  - API calls are counted against an hourly and a daily budget (defaults 200 per hour and 1,500 per day), kept in the extension's storage so closing the panel or restarting Chrome doesn't reset them. When a budget runs out, the queue holds and the panel says when it resumes.
  - circuit breaker: a 429, a "please wait" / feedback_required / checkpoint / challenge reply, a redirect to a login or challenge page, or a reply that isn't the expected data holds the whole queue instead of retrying. The panel explains why. The cool-down is at least 30 min and doubles on repeated trips. A challenge or login problem never resumes by itself: the panel shows a Resume button for the user.
  - the existing 60/120/300 s retry is replaced by the breaker.
  - the pacing numbers and budgets are settings in the panel, with these defaults.
  - Stop still takes effect within a second during any wait.
  - the pure logic (jittered delays, budget windows, error classification, cool-down growth) is unit-tested; the existing test suites pass.

## T8 · Incremental re-runs
- status: todo
- why: re-running a profile lists every page again, even when only a few posts are new. That's the largest source of avoidable Instagram requests.
- done when:
  - Instagram lists posts newest first, so a profile run stops listing after 12 posts in a row that are already in the collection.
  - pinned posts at the top of a profile (old posts listed first) don't count towards the 12 and don't end the run.
  - early stop only applies when an earlier run of that account listed to the end; the account's "listed to the end" state is kept in the extension's storage. A first run, or a run after an interrupted one, lists to the end.
  - there's an explicit way to force a full listing for a profile.
  - stories and single posts are unchanged.
  - the stop rule is unit-tested; the existing test suites pass.

## T9 · Pause and resume the queue
- status: todo
- why: Stop drops a job. Sometimes you want to halt everything for a while and continue later from the same place.
- done when:
  - the panel has one Pause button for the whole queue. The running job halts at its next safe point (the same points Stop uses) and keeps its position. Nothing new starts while paused.
  - Resume continues the running job from where it halted, then the rest of the queue.
  - paused is kept in the extension's storage: after the panel closes or Chrome restarts, the queue comes back paused, and a profile job continues from its saved listing position (T2).
  - pause shares the hold state of the T7 circuit breaker, so a breaker hold and a user pause show and resume the same way.
  - the controls are real buttons, keyboard-reachable and labelled, and match the panel's style.
  - pure logic is unit-tested; the existing test suites pass.
