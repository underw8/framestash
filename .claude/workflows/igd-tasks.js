export const meta = {
  name: 'igd-tasks',
  description: 'Run igd-task for several tasks in order, one at a time; stop at the first run that leaves the tree uncommitted',
  whenToUse: 'args: an array of task ids, e.g. ["T7","T8"]. Live checks pile up in TASKS.md for the user to do afterwards.',
  phases: [{ title: 'Tasks' }],
}

const ids = Array.isArray(args) ? args : []
const results = []
for (const id of ids) {
  log(`Starting ${id}`)
  let r
  try {
    r = await workflow({ scriptPath: '/Users/underw8/testSpace/tdi/igd/.claude/workflows/igd-task.js' }, id)
  } catch (e) {
    results.push({ task: id, error: String(e) })
    break
  }
  results.push(r || { task: id, error: 'no result' })
  // A blocked plan is committed by igd-task, so the next task can still start.
  const committed = r && (r.question || ((r.status === 'needs-check' || r.status === 'done') && r.commit))
  if (!committed) {
    log(`Stopping after ${id}: ${r ? r.status || r.error : 'no result'}`)
    break
  }
}
const left = ids.slice(results.length)
if (left.length) log(`Not run: ${left.join(', ')}`)
return { results, notRun: left }
