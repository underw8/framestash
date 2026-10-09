#!/bin/sh
# Renders hero.html to hero.png (1280×800) with headless Chrome.
set -e
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --window-size=1280,800 --screenshot="$PWD/hero.png" "file://$PWD/hero.html" 2>/dev/null
echo "$PWD/hero.png"
