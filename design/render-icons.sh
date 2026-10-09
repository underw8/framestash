#!/bin/sh
# Rebuilds extension/icons/*.png from the SVG sources. Needs rsvg-convert (brew install librsvg).
set -e
cd "$(dirname "$0")"
for s in 48 128; do rsvg-convert -w "$s" icon.svg -o "../extension/icons/icon-$s.png"; done
# The full word is unreadable below 48 px, so small sizes show "i." with the same dot.
for s in 16 32; do rsvg-convert -w "$s" icon-small.svg -o "../extension/icons/icon-$s.png"; done
