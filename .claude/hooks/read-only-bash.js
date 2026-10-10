// PreToolUse hook for read-only agents: allow only read-only Bash commands; exit 2 blocks anything else.
// By hand: node .claude/hooks/read-only-bash.js '<command>'
const ALLOWED = [
  /^git (diff|status|log|show)( |$)/,
  /^(ls|cat|head|tail|wc|grep)( |$)/,
  /^node test\/[\w.-]+\.test\.js$/,
  /^cd [^ ]+$/,
]

function check(cmd) {
  const parts = String(cmd || '').trim().split(/\s*&&\s*/)
  // Redirects, pipes, subshells and chaining other than && could write files; git's --output writes too.
  const ok = parts.every((p) => !/[;|&<>`$\n]|--output|--ext-diff/.test(p) && ALLOWED.some((re) => re.test(p)))
  if (ok) process.exit(0)
  process.stderr.write(`Read-only agent: only git diff/status/log/show, ls, cat, head, tail, wc, grep and node test/*.test.js are allowed, without redirects or pipes. Blocked: ${cmd}\n`)
  process.exit(2)
}

if (process.argv[2]) check(process.argv[2])
else {
  let input = ''
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    let cmd
    try { cmd = JSON.parse(input).tool_input.command } catch {}
    check(cmd)
  })
}
