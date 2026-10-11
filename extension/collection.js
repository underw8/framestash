// Account folders and their identity. A folder is tied to an Instagram user id
// through a small ".framestash.json" file, because usernames change and get reused.
// Helpers from naming.js are in scope (listed first in the manifest).

const MARKER = ".framestash.json";
// Pre-1.0.1 name, still read when a folder has no MARKER; writes always use MARKER.
const LEGACY_MARKER = ".igd.json";

async function readMarker(dir) {
  for (const name of [MARKER, LEGACY_MARKER]) {
    try {
      const data = JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
      return data && /^\d+$/.test(String(data.userId)) ? data : null;
    } catch (e) {
      if (e.name !== "NotFoundError") return null; // unreadable: treated as unmarked
    }
  }
  return null;
}

async function writeMarker(dir, userId, username, previous) {
  const usernames = [...new Set([...((previous && previous.usernames) || []), username])];
  const w = await (await dir.getFileHandle(MARKER, { create: true })).createWritable();
  await w.write(JSON.stringify({ version: 1, userId: String(userId), usernames }, null, 2));
  await w.close();
}

async function fileNames(dir) {
  const names = [];
  for await (const [name, handle] of dir.entries()) if (handle.kind === "file") names.push(name);
  return names;
}

async function accountFolders(root) {
  const folders = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory" && !name.startsWith(".")) folders.push({ name, dir: handle });
  }
  return folders;
}

// Picks the folder for an account, in order:
// 1. the folder whose marker has this user id (follows renames);
// 2. the folder named after the username, if it isn't someone else's;
// 3. an unmarked folder whose file names say it belongs to this user id (renamed before Framestash);
// 4. a new folder; "<username>_<userId>" when the plain name belongs to another account.
// Existing folders are never renamed.
async function resolveAccountDir(root, username, userId) {
  if (!userId) return { dir: await root.getDirectoryHandle(username, { create: true }), name: username, note: "" };
  const renamedNote = (name) => (name.toLowerCase() === username ? "" : ` (account now @${username})`);

  const unmarked = [];
  for (const folder of await accountFolders(root)) {
    const marker = await readMarker(folder.dir);
    if (!marker) { unmarked.push(folder); continue; }
    if (String(marker.userId) === String(userId)) {
      if (!marker.usernames.includes(username)) await writeMarker(folder.dir, userId, username, marker);
      return { dir: folder.dir, name: folder.name, note: renamedNote(folder.name) };
    }
  }

  let plain = null;
  try { plain = await root.getDirectoryHandle(username); } catch (e) { if (e.name !== "NotFoundError") throw e; }
  if (plain) {
    const marker = await readMarker(plain);
    const inferred = inferOwner(await fileNames(plain));
    const takenByOther = marker
      ? String(marker.userId) !== String(userId)
      : inferred.ownerId && inferred.ownerId !== String(userId) && inferred.share >= 0.5;
    if (!takenByOther) {
      if (!marker) await writeMarker(plain, userId, username, null);
      return { dir: plain, name: username, note: "" };
    }
  }

  for (const folder of unmarked) {
    if (folder.name === username) continue;
    const inferred = inferOwner(await fileNames(folder.dir));
    if (inferred.ownerId === String(userId) && inferred.share >= 0.5) {
      await writeMarker(folder.dir, userId, username, { usernames: [folder.name] });
      return { dir: folder.dir, name: folder.name, note: renamedNote(folder.name) };
    }
  }

  const name = plain ? `${username}_${userId}` : username;
  const dir = await root.getDirectoryHandle(name, { create: true });
  const existing = await readMarker(dir);
  // Never let two accounts share a folder, even one named after this account's id.
  if (existing && String(existing.userId) !== String(userId)) {
    throw new Error(`Folder "${name}" belongs to another account (user ${existing.userId}). Rename it, then retry.`);
  }
  if (!existing) await writeMarker(dir, userId, username, null);
  return { dir, name, note: plain ? ` (@${username} folder belongs to another account)` : "" };
}

// ---- saving ----

// key -> file handles whose names map to that key; `true` once saved in this run.
// `deep` also indexes direct subfolders (highlight folders), skipping dot-names.
async function indexFolder(dir, deep, index = new Map()) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (deep && !name.startsWith(".")) await indexFolder(handle, false, index);
      continue;
    }
    const key = keyFromFileName(name);
    if (key) index.set(key, [...(index.get(key) || []), handle]);
  }
  return index;
}

// Only files whose names match are stat'ed; empty leftovers don't count as present.
async function alreadyHave(index, key) {
  const entry = index.get(key);
  if (entry === true) return true;
  for (const handle of entry || []) if ((await handle.getFile()).size > 0) return true;
  return false;
}

async function save(dir, item) {
  let handle = null;
  try {
    handle = await dir.getFileHandle(item.name);
    if ((await handle.getFile()).size > 0) return "skipped"; // never overwrite
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!/^(image|video)\//.test(type)) throw new Error(`unexpected content type "${type}"`);
  const blob = await res.blob();
  if (!blob.size) throw new Error("empty response");
  // Created only after a good download, so failures leave no empty files.
  handle = handle || (await dir.getFileHandle(item.name, { create: true }));
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
  return "saved";
}

async function saveItems(dir, index, items, job) {
  for (const item of items) {
    if (job.halt) job.halt(); // outside the try: a stop is not a failed file
    if (await alreadyHave(index, item.key)) {
      job.skipped++;
    } else {
      if (job.pace) await job.pace(); // outside the try, like halt
      try {
        job[await save(dir, item)]++;
        index.set(item.key, true);
      } catch (e) {
        job.failed++;
        job.failures.push(`${item.name}: ${e.message}`);
      }
    }
    job.progress();
  }
}

// ---- read-only collection check ----

async function checkFolder(dir, onFile) {
  const byPk = new Map();
  const out = { files: 0, media: 0, empty: [], errorTxt: 0, unparsed: [], notMedia: [], duplicates: [] };
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || name === MARKER || name === LEGACY_MARKER || name === ".DS_Store") continue;
    out.files++;
    onFile();
    if (name.endsWith(".error.txt")) { out.errorTxt++; continue; }
    const parsed = parseFileName(name);
    if (!parsed) { out.unparsed.push(name); continue; }
    const file = await handle.getFile();
    if (!file.size) { out.empty.push(name); continue; }
    if (!sniffMedia(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) { out.notMedia.push(name); continue; }
    out.media++;
    byPk.set(parsed.pk, [...(byPk.get(parsed.pk) || []), name]);
  }
  for (const names of byPk.values()) if (names.length > 1) out.duplicates.push(names);
  return out;
}

async function checkCollection(root, onProgress) {
  const accounts = [];
  let scanned = 0;
  const tick = () => { if (++scanned % 50 === 0) onProgress(scanned); };
  for (const { name, dir } of await accountFolders(root)) {
    const marker = await readMarker(dir);
    const names = await fileNames(dir);
    const inferred = inferOwner(names);
    const folders = { posts: await checkFolder(dir, tick) };
    try { folders.stories = await checkFolder(await dir.getDirectoryHandle("stories"), tick); } catch (e) { if (e.name !== "NotFoundError") throw e; }
    const prefixes = new Map();
    for (const n of names) { const p = parseFileName(n); if (p) prefixes.set(p.username, (prefixes.get(p.username) || 0) + 1); }
    const topPrefix = [...prefixes].sort((a, b) => b[1] - a[1])[0];
    accounts.push({
      name, marker: marker && marker.userId, inferred, folders,
      filesNamedAs: topPrefix && topPrefix[0].toLowerCase() !== name.toLowerCase() ? topPrefix[0] : null,
    });
  }

  // The same user id in several folders means an account was split by a rename.
  const byOwner = new Map();
  for (const a of accounts) {
    const id = a.marker || (a.inferred.share >= 0.5 ? a.inferred.ownerId : null);
    if (id) byOwner.set(id, [...(byOwner.get(id) || []), a.name]);
  }
  const split = [...byOwner].filter(([, names]) => names.length > 1).map(([id, names]) => ({ userId: id, folders: names }));
  return { root: root.name, accounts, split };
}

function formatReport(r) {
  const sum = (k) => r.accounts.reduce((t, a) => t + Object.values(a.folders).reduce((u, f) => u + (Array.isArray(f[k]) ? f[k].length : f[k]), 0), 0);
  const lines = [
    `Collection ${r.root}: ${r.accounts.length} account folders, ${sum("media")} media files.`,
    `Marked with a user id: ${r.accounts.filter((a) => a.marker).length}. Owner inferable from names: ${r.accounts.filter((a) => !a.marker && a.inferred.ownerId).length}. Unknown: ${r.accounts.filter((a) => !a.marker && !a.inferred.ownerId).length}.`,
    `Problems: ${sum("duplicates")} duplicate groups, ${sum("empty")} empty files, ${sum("errorTxt")} .error.txt, ${sum("notMedia")} files that aren't images/videos, ${sum("unparsed")} unrecognised names, ${r.split.length} accounts split across folders.`,
  ];
  const detail = (title, rows) => { if (rows.length) lines.push("", title, ...rows.slice(0, 50).map((x) => `  ${x}`), ...(rows.length > 50 ? [`  … ${rows.length - 50} more`] : [])); };
  detail("Accounts split across folders:", r.split.map((s) => `user ${s.userId}: ${s.folders.join(", ")}`));
  detail("Owner unclear (several owners, no clear majority):", r.accounts.filter((a) => !a.marker && a.inferred.owners > 1 && a.inferred.share < 0.5).map((a) => a.name));
  detail("Marker and file names disagree:", r.accounts.filter((a) => a.marker && a.inferred.ownerId && a.inferred.share >= 0.5 && a.inferred.ownerId !== String(a.marker)).map((a) => a.name));
  detail("Files named after another username (likely renamed):", r.accounts.filter((a) => a.filesNamedAs).map((a) => `${a.name}: files say @${a.filesNamedAs}`));
  for (const [key, title] of [["duplicates", "Same media saved more than once:"], ["empty", "Empty files:"], ["notMedia", "Not an image or video (likely saved error pages):"], ["unparsed", "Unrecognised file names:"]]) {
    const rows = [];
    for (const a of r.accounts) for (const [sub, f] of Object.entries(a.folders)) for (const x of f[key]) rows.push(`${a.name}${sub === "stories" ? "/stories" : ""}: ${Array.isArray(x) ? x.join("  =  ") : x}`);
    detail(title, rows);
  }
  return lines.join("\n");
}
