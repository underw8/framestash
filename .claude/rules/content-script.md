---
paths:
  - "extension/content.*"
---
# Content script

- Never select on Instagram class names. Find posts through their `/p/` or `/reel/` links (`shortcodeFromPath`).
- Every igd button handler requires `event.isTrusted`; page scripts can click our buttons.
- Handle clicks in the capture phase so the tile link never navigates.
- No `filter`, `backdrop-filter` or `transform` on per-tile elements: they paint long grids black.
- Action rows are thin strips (at most 96 px across). Grid rows get the icon inside the bookmark cell.
- The content script never saves files; saving happens only in the panel.
