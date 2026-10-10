---
name: release
description: Cut a Framestash release - bump the manifest version, run all checks, build the store zip, commit and tag vX.Y.Z, and hand publishing the tag to the user. Use when the user asks to release, tag, or ship a version.
---

# Release Framestash

1. **Pick the version** with the user. It is semver in `extension/manifest.json` `version`: patch for fixes, minor for features, major for breaking changes to the collection format.
2. **Check that the tree is ready**: `git status` is clean, `TASKS.md` has no `in-progress` task, and the checks pass:
   ```bash
   node test/naming.test.js && node test/collection.test.js && node test/pacer.test.js
   node scripts/check-manifest.js
   ```
3. **Bump** `version` in `extension/manifest.json`, then build: `sh scripts/package.sh` (it re-runs the tests and writes `dist/framestash-<version>.zip`, which is git-ignored).
4. **Commit and tag**: commit `chore: release vX.Y.Z` with the session's attribution lines, then create the tag `vX.Y.Z`.
5. **Hand the upload to the user.** A guard hook blocks Claude from pushing, and the repo uses the `underw8` GitHub account. Give the user this command:
   ```
   ! gh auth switch --user underw8 && git push && git push origin vX.Y.Z; gh auth switch --user mvn-kiettran-dn
   ```
   The tag starts `.github/workflows/release.yml`, which creates the GitHub Release with the zip.
6. **Store:** until `publish.yml`'s trigger is enabled (see `docs/releasing.md`), the user uploads the zip in the Chrome Web Store dashboard by hand.

Never send commits or tags to GitHub yourself, never rewrite published history, and never delete tags. If the tag already exists, stop and ask.
