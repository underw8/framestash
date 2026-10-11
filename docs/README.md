# Framestash docs

| Doc | What it covers |
|---|---|
| [collection-format.md](collection-format.md) | The on-disk format Framestash reads and writes: names, folders, dedup, `.framestash.json`, the collection check, migration rules |
| [instagram-api.md](instagram-api.md) | The GraphQL queries Framestash uses, record shapes, profile listing, stories and highlights, block signals |
| [playbook.md](playbook.md) | Console probes for re-checking Instagram's API and auditing a collection |
| [dash-video.md](dash-video.md) | Whether to save DASH video instead of progressive MP4: design, costs, decision |
| [privacy.md](privacy.md) | Privacy policy, published as-is on GitHub Pages |
| [store-listing.md](store-listing.md) | Chrome Web Store listing draft: descriptions, permission justifications, data use, required images |
| [releasing.md](releasing.md) | Release flow (tag → GitHub Release with the zip) and the one-time setup for Chrome Web Store publishing |

Instagram details drift. Before relying on [instagram-api.md](instagram-api.md), re-check it with playbook steps 1–5.
