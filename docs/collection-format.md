# Collection format

Framestash reads and writes one on-disk format. Files already in a collection, including those written by other tools that use the same format, must keep working. `extension/naming.js` and `extension/collection.js` implement these rules; `test/naming.test.js` and `test/collection.test.js` check them.

## Layout

```text
<root>/<username>/<username>_<taken_at>_<id>.<ext>
<root>/<username>/stories/<username>_<taken_at>_<id>.<ext>
<root>/<username>/stories/<highlight folder>/…      (only with "Highlights in their own folders")
<root>/<username>/.framestash.json
```

The user picks `<root>`, the folder that contains the account folders, never an account folder.

## File names

The only cleaning step strips `< > : " / \ | ? *` from the whole name. There is no handling of control characters, trailing dots or spaces, reserved Windows names or length.

| Part | Value | Variations found in collections |
|---|---|---|
| `username` | the post owner's username; carousel slides use the parent's owner | collab or foreign-owner posts in an account folder carry the other username |
| `taken_at` | Unix seconds, 9–10 digits | carousel slides use their own `taken_at` when the record has one, otherwise the parent's, so the same slide can appear with either value |
| `id` | `<pk>_<ownerId>`, e.g. `3900000000000000071_31600000058` | a bare `<pk>` |
| `ext` | see below | `JPG` and `jpg` both occur; case is kept |

Examples:

```text
sample.user_1789389655_3900000000000000071_31600000058.jpg
sample.user_1789389000_3900000000000000071.JPG
```

**Extension rule.** The extension is the first `.<letters or digits>` anywhere in the media URL (host, path or query) that is followed by `?`, `#` or the end of the URL, with its case kept. If nothing matches, Framestash uses `mp4` for video and `jpg` for images.

**Parsing.** `parseFileName` anchors on the numeric tail, because usernames may contain `_` and digits: `taken_at` is 9–10 digits, `pk` is 12 or more digits, the owner ID is optional. Names that don't fit are "unrecognised" in the collection check and never count as present. This includes story files whose ID slot holds a reel ID instead of a media pk.

## Stories and highlights

- Active stories and highlights go to `<username>/stories/`. Story items have their own `<pk>_<ownerId>` IDs, so they are named like posts.
- With the panel switch **Highlights in their own folders**, highlight items go to `<username>/stories/<folder>/`. The folder is the highlight title with reserved and control characters removed, leading and trailing dots and spaces trimmed, capped at 80 characters. If nothing is left, the numeric highlight ID is used. Active stories stay in `stories/`.
- Dedup covers `stories/` and its direct subfolders, skipping dot-folders, so an item saved in any of them is skipped. The collection check reads only `stories/` itself.

## Dedup

The key is the media **pk** alone. A pk is unique across Instagram and never reused, so the key survives renames, both `id` variants, both `taken_at` variants and any extension case. Never key on the full name, the username, or a prefix that includes `taken_at`.

A file counts as present only if it is non-empty. 0-byte files are treated as missing and downloaded again.

## Account folders and `.framestash.json`

An account folder is tied to a user ID by a hidden marker `.framestash.json`: `{ version: 1, userId, usernames: [...] }`. Framestash writes it the first time it saves into the folder and appends new usernames as aliases. Folders are never renamed. Collections from before 1.0.1 have `.igd.json` instead; it is still read when a folder has no `.framestash.json`, and new markers are always written as `.framestash.json`.

`resolveAccountDir(root, username, userId)` picks the folder in this order:

1. The folder whose marker has this user ID. This follows renames.
2. The folder named after the username, unless its marker names another user ID, or (unmarked) at least half of its `_<ownerId>` file names name another owner.
3. An unmarked folder whose file names say, by majority (≥ 50 %), that it belongs to this user ID. This finds accounts renamed before they had a marker.
4. A new folder: `<username>`, or `<username>_<userId>` when the plain name belongs to another account. If that folder already carries another user's marker, the job fails instead of sharing it.

Two user IDs never share a folder. Without a user ID, Framestash uses `<username>` as is.

## Writing

- **Never overwrite.** Open with `create: false` first; creating and then writing truncates the file. A non-empty file with the same name is skipped.
- A file is created only after a successful download: the HTTP status is OK, the content type is `image/*` or `video/*`, and the body is non-empty. A failed item leaves nothing on disk.

## Leftovers the collection check reports

The check (**Check collection** in the panel) is read-only. Per account it reports:

- the same pk saved under several names;
- 0-byte files;
- `.error.txt` files;
- files whose first bytes aren't JPEG, PNG, WebP, GIF or MP4/HEIC (usually saved error pages);
- unrecognised names;
- accounts split across folders (one user ID in several folders), unclear owners, markers that disagree with file names, and folders whose files are named after another username.

## Migration rules

- Report first. The collection check never changes anything.
- Never delete. Anything removed goes to `<root>/.framestash-trash/<date>/`.
- Any step that moves files needs the user's confirmation.
