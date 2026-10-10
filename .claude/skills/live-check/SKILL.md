---
name: live-check
description: Verify a Framestash change on live instagram.com with the Claude-in-Chrome tools, measuring the page instead of eyeballing it. Use when a fix touches content.js/content.css or Instagram's DOM, when the user reports a visual bug, or before marking an in-page live check done.
---

# Live check on instagram.com

Framestash runs inside the user's own logged-in Chrome. Work only in your own tab group, measure with JavaScript, and leave the browser as you found it.

## Setup
1. Load every browser tool you need in one ToolSearch call (`tabs_context_mcp`, `navigate`, `computer`, `javascript_tool`, `browser_batch`, `resize_window`, `tabs_close_mcp`).
2. `tabs_context_mcp` with `createIfEmpty: true`, then navigate that tab. Never use the user's own tabs.
3. The page runs the extension build the user last loaded. Code changes need a reload at `chrome://extensions`, which only the user can do. Say so instead of assuming the new code is live.

## Reproduce and measure
- Read state with `javascript_tool`: `getBoundingClientRect()`, `getComputedStyle()`, `document.elementsFromPoint()`, counts of `.igd-*` elements.
- Screenshot coordinates are not CSS pixels. Convert with `k = innerWidth / screenshotFrameWidth` before calling `elementsFromPoint`.
- To prove the cause, switch a suspect off with an injected `!important` style (`.igd-item{display:none!important}`) and reproduce again. If the symptom stays, it isn't igd's element.
- Layout bugs often depend on width. Use `resize_window` (for example 700, 1100 and 1440 px wide) and re-measure.

## Test a fix before the user reloads
Apply the same DOM or CSS change to the live page with `javascript_tool` (move the node, set the style), then measure and screenshot. Only commit once the live result matches what you expect, and say that the check was a simulation.

## Limits
- `isTrusted`: igd ignores script `.click()`. Real clicks through the `computer` tool count as user clicks, so **don't click download buttons** unless the user asked: they write into the user's collection.
- Never like, follow, comment, or open stories in a way that marks them seen.
- Video renders grey in tab screenshots. Capture it with macOS `screencapture -x -R x,y,w,h`, using screen points from the window bounds (`osascript -e 'tell application "Google Chrome" to get bounds of front window'`).
- CSS-only changes can also be checked offline: write a small HTML file that loads `extension/content.css` with Instagram's theme variables, and render it with headless Chrome `--screenshot`.

## Clean up
Restore the window size (1440×900), close every tab you opened, and report what was measured live and what was only simulated.
