#!/bin/sh
# Rebuilds extension/icons/*.png from the SVG sources. Needs rsvg-convert (brew install librsvg).
set -e
cd "$(dirname "$0")"
for s in 48 128; do rsvg-convert -w "$s" icon.svg -o "../extension/icons/icon-$s.png"; done
# 16/32 px render "f." from icon-small.svg, positioned for the small pixel grid.
for s in 16 32; do rsvg-convert -w "$s" icon-small.svg -o "../extension/icons/icon-$s.png"; done
# README wordmarks: the master without its white background, black for light themes, white for dark.
for v in light:#000 dark:#fff; do
  sed -e '/<rect /d' -e "s/fill=\"#000\"/fill=\"${v#*:}\"/" wordmark.svg | rsvg-convert -w 560 -o "wordmark-${v%%:*}.png"
done
