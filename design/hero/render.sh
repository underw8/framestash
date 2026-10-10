#!/bin/sh
# Renders hero.html to hero.png (1280×800), or promo.html to promo.png (440×280) with "render.sh promo".
set -e
cd "$(dirname "$0")"
name=${1:-hero}; size=1280,800; [ "$name" = promo ] && size=440,280
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --window-size=$size --screenshot="$PWD/$name.png" "file://$PWD/$name.html" 2>/dev/null
echo "$PWD/$name.png"
