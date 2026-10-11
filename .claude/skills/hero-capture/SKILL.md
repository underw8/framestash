---
name: hero-capture
description: Capture the README / store cover for Framestash - five live screenshots of the extension on instagram.com composed into design/hero/hero.png (1280x800). Use when the user asks to (re)make the hero, cover, or store screenshots.
---

# Capture the hero cover

**Rights first:** use only content the user may publish: their own account, a test account, or blurred media. Never commit other people's posts, faces or usernames.

## Shots (in `design/hero/shots/`)
| File | Content | How |
|---|---|---|
| `tile.png` | a grid tile on hover: counts plus the Framestash icon | `computer` hover on the tile, then `zoom` with `save_to_disk` on the tile's area |
| `profile.png` | the corner buttons (Stories, panel, Download @user) | move the mouse to an empty spot first, then `zoom` on the corner |
| `post.png` | a post's action row with the icon after the bookmark | open a post, `zoom` on the action row |
| `reel.png` | a reel with the side column (tall) | **video renders grey in tab screenshots**: use macOS `screencapture -x -R x,y,w,h` in screen points |
| `panel.png` | the side panel | open it with the in-page panel button, then `screencapture` its area |

Use the `live-check` skill for tab handling and clean-up (restore 1440×900, close tabs).

## Compose
`design/hero/hero.html` lays out the five tiles: the tall reel on the right, a blurred dark background, a glow behind each tile made from its own image (`.tile::before`), and the wordmark bottom-left. Adjust per-tile crops with `background-position`. Render with `design/hero/render.sh` and look at the result before committing. The README shows `design/hero/hero.png`.
