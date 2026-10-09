export const meta = {
  name: 'igd-task',
  description: 'Take one task from igd/TASKS.md: plan, build, review, commit, and list the live checks left for the user',
  whenToUse: 'Run with no args for the first "todo" task, or args "T3" (or a title fragment) for a specific one. One task per run.',
  phases: [
    { title: 'Pick', detail: 'clean tree check, choose the task, mark in-progress' },
    { title: 'Plan', detail: 'design against CLAUDE.md and docs/' },
    { title: 'Build', detail: 'implement and add tests' },
    { title: 'Review', detail: 'security, compatibility, correctness lenses; up to 2 reviewed fix rounds' },
    { title: 'Finish', detail: 'tests, one commit, task status, live checks' },
  ],
}

// Paths are relative to the igd repo root (the folder holding TASKS.md and CLAUDE.md).
const REPO = 'the igd git repository (the folder that contains TASKS.md, CLAUDE.md and extension/)'
const TESTS = 'node test/naming.test.js && node test/collection.test.js, plus `node --check` on every changed extension/*.js'

const TASK = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    reason: { type: 'string', description: 'why nothing was picked, if found is false' },
    id: { type: 'string' },
    title: { type: 'string' },
    why: { type: 'string' },
    doneWhen: { type: 'array', items: { type: 'string' } },
  },
  required: ['found'],
}

const PLAN = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' }, description: 'automated checks to add or extend' },
    liveChecks: { type: 'array', items: { type: 'string' }, description: 'things only the user can verify in Chrome (reload, real clicks, folder picks)' },
    risks: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'string', description: 'set only if the task needs a user decision before building' },
  },
  required: ['summary', 'steps', 'files', 'tests', 'liveChecks'],
}

const BUILD = {
  type: 'object',
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    testsPassed: { type: 'boolean' },
    testOutput: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['changed', 'testsPassed'],
}

const REVIEW = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'issue'],
      },
    },
  },
  required: ['findings'],
}

const FINISH = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'short hash and subject, or empty if nothing was committed' },
    status: { type: 'string', enum: ['needs-check', 'done', 'blocked'] },
    liveChecks: { type: 'array', items: { type: 'string' } },
    testOutput: { type: 'string' },
  },
  required: ['commit', 'status', 'liveChecks'],
}

const LENSES = [
  {
    key: 'security',
    prompt: 'Security invariants from CLAUDE.md: folder handle only in the panel\'s extension IndexedDB; page-bridge replies validated (itemsFromNode); jobs only via background + validJob; every in-page button handler requires event.isTrusted; postMessage origin checks; no new web-accessible resources, permissions or telemetry without a stated reason.',
  },
  {
    key: 'compatibility',
    prompt: 'Compatibility with existing collections (CLAUDE.md): naming <root>/<username>/<username>_<taken_at>_<id>.<ext>; dedup by pk only; never overwrite a non-empty file; .igd.json identity rules; never rename folders or let two user ids share one; never delete user files.',
  },
  {
    key: 'correctness',
    prompt: 'Correctness and regressions: does the change meet every "done when" item; edge cases (empty results, 429 backoff, panel closed, stale tabs, URLs with or without trailing slash); tests actually cover the new logic; no dead code or stale comments left behind.',
  },
]

// ---- Pick ----
phase('Pick')
const pickHint = typeof args === 'string' && args.trim() ? `The user asked for task "${args.trim()}" (an id like T3 or part of a title).` : 'No task was named: take the first task whose status is todo.'
const task = await agent(
  `In ${REPO}:
1. Run \`git status --porcelain\`. If anything is uncommitted, stop: return found=false with reason "working tree not clean" and the list of files. Do not change anything.
2. Read TASKS.md. ${pickHint} Only tasks with status todo (or needs-check if the user named it explicitly) can be picked.
3. If a task is picked, change only its status line to "in-progress" in TASKS.md (do not commit).
Return the task's id, title, why, and its "done when" items.`,
  { label: 'pick task', schema: TASK },
)
if (!task || !task.found) {
  log(`Nothing to do: ${task ? task.reason : 'pick agent failed'}`)
  return { picked: null, reason: task ? task.reason : 'pick agent failed' }
}
log(`Task ${task.id}: ${task.title}`)
const taskText = `${task.id} · ${task.title}\nWhy: ${task.why}\nDone when:\n- ${(task.doneWhen || []).join('\n- ')}`

// ---- Plan ----
phase('Plan')
const plan = await agent(
  `Plan this igd task in ${REPO}. Read CLAUDE.md, README.md, the relevant extension/ files and docs/ before deciding. Follow the clean-room rules: build from docs/, never copy from ../js, ../css or ../icons.
If Instagram data is involved, say which query/fields you rely on and whether docs/03 already documents them.
Prefer the smallest change that meets every "done when" item; reuse existing helpers (naming.js, collection.js) instead of adding new layers.
If the task cannot be done without a product decision from the user, set "blocked" to the question and keep the rest of the plan minimal.

Task:
${taskText}`,
  { label: 'plan', schema: PLAN },
)
if (!plan) return { picked: task.id, error: 'plan agent failed' }
if (plan.blocked) {
  await agent(`In ${REPO}, set task ${task.id}'s status in TASKS.md to "blocked" and add a bullet "- notes: ${plan.blocked.replace(/"/g, "'")}". Commit only TASKS.md with the subject "chore: ${task.id} blocked on a decision", ending the message with these two lines exactly:
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEGtRT8fAMDQtihDDzxb6t
Do not push.`, { label: 'mark blocked' })
  return { picked: task.id, status: 'blocked', question: plan.blocked }
}
const planText = `Summary: ${plan.summary}\nSteps:\n- ${plan.steps.join('\n- ')}\nFiles: ${plan.files.join(', ')}\nTests: ${plan.tests.join('; ')}\nRisks: ${(plan.risks || []).join('; ')}`

// ---- Build ----
phase('Build')
let build = await agent(
  `Implement this plan in ${REPO}. Match the surrounding code style (plain MV3 JavaScript, no build step, comments only for non-obvious constraints). Add or extend the automated tests listed. Bump the patch or minor version in extension/manifest.json as fits the change. Run ${TESTS} and fix failures until they pass. Do not commit.

Task:
${taskText}

Plan:
${planText}`,
  { label: 'build', schema: BUILD },
)
if (!build) return { picked: task.id, error: 'build agent failed' }

// ---- Review: review, fix, re-review; at most 2 fix rounds, and every fix is reviewed ----
phase('Review')
let blocking = []
for (let round = 1; round <= 3; round++) {
  const reviews = await parallel(LENSES.map((lens) => () =>
    agent(
      `Review the uncommitted changes in ${REPO} (\`git diff\` and new files) for task ${task.id} through one lens only. ${lens.prompt}
Report only real problems you can point to in the diff, each with a concrete fix. "blocker" = breaks an invariant or a done-when item; "major" = likely bug or missing test; "minor" = nice to have. Return an empty list if the change is sound.

Task:
${taskText}`,
      { label: `review ${lens.key} #${round}`, phase: 'Review', schema: REVIEW },
    )))
  const findings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  blocking = findings.filter((f) => f.severity !== 'minor')
  log(`Review round ${round}: ${blocking.length} blocking/major, ${findings.length - blocking.length} minor`)
  if (!blocking.length || round === 3) break
  build = await agent(
    `Fix these review findings in ${REPO} for task ${task.id}, then run ${TESTS} until they pass. Do not commit.
${blocking.map((f, i) => `${i + 1}. [${f.severity}] ${f.file || ''} ${f.issue} → ${f.fix || ''}`).join('\n')}`,
    { label: `fix round ${round}`, phase: 'Review', schema: BUILD },
  ) || build
}
if (blocking.length) log(`Unresolved after 2 fix rounds: ${blocking.length} finding(s); they are listed in the result and on the task`)

// ---- Finish ----
phase('Finish')
const finish = await agent(
  `In ${REPO}, finish task ${task.id}:
1. Run ${TESTS}. If they fail, do not commit; set the task status to "blocked" with a notes bullet saying which test fails, and return commit "".
2. Update README.md only if user-visible behaviour changed (keep it describing current behaviour, no changelog).
3. In TASKS.md set the task's status to "needs-check" and add a "- live checks:" bullet listing these, so the user can tick them off: ${plan.liveChecks.join('; ') || 'none'}. If there are no live checks, set status "done".
4. Make one git commit with all changes. Message: a conventional-commit subject for the task, a short body (what changed, why, how it was verified), and end with these two lines exactly:
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PEGtRT8fAMDQtihDDzxb6t
Do not push.${blocking.length ? `\nAlso add a "- open review findings:" bullet to the task with: ${blocking.map((f) => f.issue).join('; ')}` : ''}`,
  { label: 'finish', schema: FINISH },
)

return {
  task: `${task.id} · ${task.title}`,
  plan: plan.summary,
  changed: build.changed,
  commit: finish ? finish.commit : '',
  status: finish ? finish.status : 'unknown',
  liveChecks: finish ? finish.liveChecks : plan.liveChecks,
  openFindings: blocking.map((f) => `[${f.severity}] ${f.issue}`),
}
