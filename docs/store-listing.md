# Chrome Web Store listing draft

Texts for the Web Store dashboard. Every claim here must stay true of the code in `extension/`. Build the upload with `scripts/package.sh`, which writes `dist/framestash-<version>.zip`.

## Short description

At most 132 characters. Same as the manifest `description`:

> Save profiles, posts, stories and highlights from instagram.com into a local folder, skipping media you already have.

## Full description

> Framestash saves Instagram profiles, posts, stories and highlights into a folder on your computer.
>
> What it does
>
> - Adds download buttons to instagram.com: on profiles, post and reel pages, story and highlight pages, in the action row of feed posts and reels, and on grid tiles.
> - Runs every download through a queue in a Framestash side panel, which remembers the folder you picked for every tab.
> - Skips media you already have, matched on Instagram's media ID, so re-running a profile only fetches what's new.
> - Spaces its requests out, keeps to hourly and daily budgets, and pauses the queue when Instagram signals rate limiting or a login check.
> - Never marks a story as seen.
> - Checks an existing collection for duplicates, empty files and unrecognised names, without changing anything.
>
> How to use it
>
> 1. Pin Framestash to the toolbar and click its icon to open the side panel.
> 2. Read the "Before you start" notice and click I understand.
> 3. Click Choose and pick the folder for your collection.
> 4. On instagram.com, use the Framestash buttons, or paste usernames into the panel and click Add to queue.
> 5. Use Check collection in the panel for a read-only report on your folder.
>
> Framestash is not affiliated with, endorsed by or sponsored by Instagram or Meta.
>
> Use responsibly
>
> - Framestash is for personal backup of content you have the right to keep.
> - Respect creators' rights: don't republish other people's work without their permission.
> - Bulk downloading can get your Instagram account rate-limited or blocked. Framestash paces its requests, but it can't prevent this.

## Single purpose

> Save Instagram posts, stories and highlights the user asks for into a local folder the user chooses.

## Permission justifications

| Permission | Justification |
|---|---|
| `sidePanel` | The folder, the download queue and the collection check live in the side panel, which the toolbar icon and the in-page buttons open. |
| `https://www.instagram.com/*` | Content scripts add the download buttons and, in the page, run Instagram's own GraphQL queries with the user's session to list the posts and stories the user asked for. The panel finds open Instagram tabs with `tabs.query` and sends them these listing requests. |
| `https://*.cdninstagram.com/*` | The panel fetches the media files from Instagram's CDN to save them. Only Instagram CDN URLs are accepted. |
| `https://*.fbcdn.net/*` | Instagram also serves media from this CDN. The panel accepts a media URL only if its host ends in `cdninstagram.com` or `fbcdn.net` (`naming.js`), so no other fbcdn content is fetched. |

No other permissions are requested: no `downloads`, `storage`, `tabs` or `scripting`. Files are written with the File System Access API to the folder the user picks.

## Remote code

No. All code ships in the package; nothing is loaded or evaluated from the network.

## Data use

Framestash collects and transmits no user data. Leave every data category unchecked.

Certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: the published copy of [privacy.md](privacy.md) (URL to fill in).

## Required images

| Image | Size | Status |
|---|---|---|
| Store icon | 128×128 PNG (96×96 artwork, 16 px transparent padding) | `extension/icons/icon-128.png` |
| Screenshots | 1280×800, 1 to 5 | `design/hero/hero.png` (render more from `design/hero/shots/` if wanted) |
| Small promo tile | 440×280 | `design/hero/promo.png` |
