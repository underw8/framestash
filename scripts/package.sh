#!/bin/sh
# Builds dist/framestash-<version>.zip for the Chrome Web Store; refuses if any check fails.
set -eu
cd "$(dirname "$0")/.."

for t in test/*.test.js; do node "$t"; done
for f in extension/*.js; do node --check "$f"; done

v=$(node -p 'require("./extension/manifest.json").version')
zip="dist/framestash-$v.zip"
mkdir -p dist
rm -f "$zip"
# Zipped from inside extension/ so manifest.json sits at the zip root.
(cd extension && zip -qrX "../$zip" . -x '.*' '*/.*')
echo "$zip"
