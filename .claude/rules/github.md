---
paths:
  - ".github/**"
---
# GitHub workflows

- GitHub-owned actions only (`actions/*`, `github/*`), pinned to a full commit SHA with the version as a comment: `uses: actions/checkout@<40-char sha> # v7.0.1`.
- Set explicit least-privilege `permissions` (default `contents: read`); widen per job only where needed.
- Never echo secrets or pass them on command lines; use `env:` and masked values.
