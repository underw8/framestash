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
- status: needs-check
- why: closing the side panel drops every queued and running job, which hurts long profile downloads.
- done when:
  - queued jobs are kept in the extension's own storage and come back when the panel reopens;
  - a job that was running when the panel closed restarts;
  - finished jobs aren't re-run;
  - the existing test suites still pass.
- live checks:
  - [ ] Reload igd at chrome://extensions. Queue 2–3 profiles in the panel, close the side panel while the first one is running, then reopen it from the toolbar icon. All of them should be listed again as queued, the first one should restart, and files that were already saved should count as 'already had'.
  - [ ] Let one job finish, then close and reopen the panel. The finished job should not run again (it is no longer listed), and only the jobs that were still pending come back.
  - [ ] With the panel closed, click an igd button on an Instagram post. The panel should open with the earlier saved queue plus the new job, and nothing should be lost.
  - [ ] Restart Chrome with jobs still queued and open the panel. The jobs should come back, and the queue should wait for 'Allow access' before running.

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
