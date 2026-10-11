---
paths:
  - "extension/naming.js"
  - "extension/collection.js"
  - "extension/manager.js"
  - "test/**"
---
# Collection naming and storage

- Dedup by `pk` only. Never key on the full name, the username, or a prefix that includes `taken_at`.
- Never overwrite: open with `create: false` first, because creating and then writing truncates the file.
- Account markers are written as `.framestash.json`; `.igd.json` is still read as a fallback, so never drop that.
- Test data uses made-up usernames and ids, never real accounts.
- Run `node test/naming.test.js && node test/collection.test.js` after any change. Full rules: docs/collection-format.md.
