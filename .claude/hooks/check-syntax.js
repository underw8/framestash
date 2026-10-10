// PostToolUse hook: `node --check` an edited extension/*.js; exit 2 reports the error to Claude.
// By hand: node .claude/hooks/check-syntax.js <file>
const { spawnSync } = require('child_process')

function check(file) {
  if (!file || !/(^|\/)extension\/[^/]+\.js$/.test(file)) process.exit(0)
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (r.status === 0) process.exit(0)
  process.stderr.write(r.stderr || `node --check failed on ${file}\n`)
  process.exit(2)
}

if (process.argv[2]) check(process.argv[2])
else {
  let input = ''
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    let file
    try { file = JSON.parse(input).tool_input.file_path } catch { process.exit(0) }
    check(file)
  })
}
