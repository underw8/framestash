export const meta = {
  name: 'fs-task',
  description: 'Take one task from TASKS.md: plan, build, review, commit, and list the live checks left for the user',
  whenToUse: 'Run with no args for the first "todo" task, or args "T3" (or a title fragment) for a specific one. One task per run.',
  phases: [
    { title: 'Pick', detail: 'clean tree check, choose the task, mark in-progress', model: 'haiku' },
    { title: 'Plan', detail: 'design against CLAUDE.md and docs/' },
    { title: 'Build', detail: 'implement and add tests' },
    { title: 'Review', detail: 'security, compatibility, correctness lenses; up to 2 reviewed fix rounds' },
    { title: 'Finish', detail: 'tests, one commit, task status, live checks' },
  ],
}

// Paths are relative to the repo root (the folder holding TASKS.md and CLAUDE.md).
const REPO = 'the repository root (the folder that contains TASKS.md, CLAUDE.md and extension/)'

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

// Lens key -> reviewer agent in .claude/agents/; each agent holds its checklist.
const LENSES = ['security', 'compat', 'correctness']

// Plan, Build and Review run as the fs-* agents in .claude/agents/, which set
// their own tools, model and rules. Pick and mark-blocked are mechanical.

// ---- Pick ----
phase('Pick')
const pickHint = typeof args === 'string' && args.trim() ? `The user asked for task "${args.trim()}" (an id like T3 or part of a title).` : 'No task was named: take the first task whose status is todo.'
const task = await agent(
  `In ${REPO}:
1. Run \`git status --porcelain\`. If anything is uncommitted, stop: return found=false with reason "working tree not clean" and the list of files. Do not change anything.
2. Read TASKS.md. ${pickHint} Only tasks with status todo (or needs-check if the user named it explicitly) can be picked.
3. If a task is picked, change only its status line to "in-progress" in TASKS.md (do not commit).
Return the task's id, title, why, and its "done when" items.`,
  { label: 'pick task', schema: TASK, model: 'haiku', effort: 'low' },
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
  `Plan this task in ${REPO}.

Task:
${taskText}`,
  { label: 'plan', schema: PLAN, agentType: 'fs-planner' },
)
if (!plan) return { picked: task.id, error: 'plan agent failed' }
if (plan.blocked) {
  await agent(`In ${REPO}, set task ${task.id}'s status in TASKS.md to "blocked" and add a bullet "- notes: ${plan.blocked.replace(/"/g, "'")}". Commit only TASKS.md with the subject "chore: ${task.id} blocked on a decision", ending the message with the commit attribution lines your session gives, if any. Do not push.`, { label: 'mark blocked', model: 'haiku', effort: 'low' })
  return { picked: task.id, status: 'blocked', question: plan.blocked }
}
const planText = `Summary: ${plan.summary}\nSteps:\n- ${plan.steps.join('\n- ')}\nFiles: ${plan.files.join(', ')}\nTests: ${plan.tests.join('; ')}\nRisks: ${(plan.risks || []).join('; ')}`

// ---- Build ----
phase('Build')
let build = await agent(
  `Implement this plan in ${REPO}.

Task:
${taskText}

Plan:
${planText}`,
  { label: 'build', schema: BUILD, agentType: 'fs-builder' },
)
if (!build) return { picked: task.id, error: 'build agent failed' }

// ---- Review: review, fix, re-review; at most 2 fix rounds, and every fix is reviewed ----
phase('Review')
let blocking = []
for (let round = 1; round <= 3; round++) {
  const reviews = await parallel(LENSES.map((lens) => () =>
    agent(
      `Review the uncommitted changes in ${REPO} for task ${task.id}.

Task:
${taskText}`,
      { label: `review ${lens} #${round}`, phase: 'Review', schema: REVIEW, agentType: `fs-reviewer-${lens}` },
    )))
  const findings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  blocking = findings.filter((f) => f.severity !== 'minor')
  log(`Review round ${round}: ${blocking.length} blocking/major, ${findings.length - blocking.length} minor`)
  if (!blocking.length || round === 3) break
  build = await agent(
    `Fix these review findings in ${REPO} for task ${task.id}.
${blocking.map((f, i) => `${i + 1}. [${f.severity}] ${f.file || ''} ${f.issue} → ${f.fix || ''}`).join('\n')}`,
    { label: `fix round ${round}`, phase: 'Review', schema: BUILD, agentType: 'fs-builder' },
  ) || build
}
if (blocking.length) log(`Unresolved after 2 fix rounds: ${blocking.length} finding(s); they are listed in the result and on the task`)

// ---- Finish ----
phase('Finish')
const finish = await agent(
  `In ${REPO}, finish task ${task.id}:
- Live checks: ${plan.liveChecks.join('; ') || 'none'}${blocking.length ? `\n- Also add a "- open review findings:" bullet to the task with: ${blocking.map((f) => f.issue).join('; ')}` : ''}
- End the commit message with the commit attribution lines your session gives, if any.`,
  { label: 'finish', schema: FINISH, agentType: 'fs-finisher' },
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
