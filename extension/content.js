// Isolated content script: profile button, folder handling, download loop.
// Functions from naming.js are in scope (listed first in the manifest).

const RESERVED = new Set([
  "explore", "reels", "direct", "accounts", "stories", "p", "reel", "tv", "about", "legal",
  "developer", "web", "challenge", "emails", "session", "archive", "your_activity", "create",
  "api", "graphql", "ajax", "static", "privacy", "terms", "nametag", "directory", "lite",
]);

function profileFromPath(path) {
  const m = path.match(/^\/([A-Za-z0-9._]{1,30})\/(?:(?:reels|tagged)\/)?$/);
  return m && !RESERVED.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- settings: folder handle in IndexedDB (instagram.com origin, our own DB) ----
// ponytail: page scripts on instagram.com can read this DB too; same exposure as the old tool.

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("igd", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", value === undefined ? "readonly" : "readwrite");
    const req = value === undefined ? tx.objectStore("kv").get(key) : tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Must be called straight from a click: permission prompts and the picker need user activation.
async function rootFolder(forcePick) {
  let root = forcePick ? null : await kv("root");
  if (root) {
    if ((await root.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error("Write permission for the download folder was not granted.");
    }
    try {
      await root.entries().next();
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
      root = null; // folder was moved or deleted: ask again
    }
  }
  if (!root) {
    root = await showDirectoryPicker({ id: "igd-root", mode: "readwrite", startIn: "downloads" });
    await kv("root", root);
  }
  return root;
}

// ---- page-world bridge ----

// The field is "op", not "procedure": the old extension's page script answers any
// message with a "procedure" field, and its reply would reach our port first.
function pageCall(op, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "no answer from page script (reload the tab)" }), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    window.postMessage({ igd: 1, op, ...args }, location.origin, [ch.port2]);
  });
}

async function listPage(username, after, onWait) {
  const waits = [60, 120, 300];
  for (let attempt = 0; ; attempt++) {
    const r = await pageCall("profilePosts", { username, after });
    if (r.status !== 429 || attempt >= waits.length) return r;
    onWait(waits[attempt]);
    await sleep(waits[attempt] * 1000);
  }
}

// ---- files ----

async function indexFolder(dir) {
  const have = new Set();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file") continue;
    const key = keyFromFileName(name);
    // ponytail: one stat per file; fine for thousands, cache the index if folders get huge.
    if (key && (await handle.getFile()).size > 0) have.add(key);
  }
  return have;
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

// ---- UI ----

const panel = document.createElement("div");
panel.className = "igd-panel";
panel.innerHTML = `
  <div class="igd-row">
    <button class="igd-go" type="button">⬇ Download profile</button>
    <button class="igd-folder" type="button" title="Choose download folder">📁</button>
  </div>
  <div class="igd-status" aria-live="polite"></div>`;
const goButton = panel.querySelector(".igd-go");
const folderButton = panel.querySelector(".igd-folder");
const statusLine = panel.querySelector(".igd-status");
let running = false;

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

async function runProfile(username) {
  running = true;
  goButton.disabled = folderButton.disabled = true;
  const counts = { saved: 0, skipped: 0, failed: 0 };
  const failures = [];
  try {
    const root = await rootFolder(false);
    const dir = await root.getDirectoryHandle(username, { create: true });
    setStatus("Checking files you already have…");
    const have = await indexFolder(dir);
    let after = null;
    let page = 0;
    do {
      const r = await listPage(username, after, (s) => setStatus(`Instagram is rate-limiting; waiting ${s} s…`, "warn"));
      if (r.error) throw new Error(`Stopped listing after ${page} page(s): ${r.error}`);
      page++;
      for (const node of r.nodes) {
        for (const item of itemsFromNode(node)) {
          if (have.has(item.key)) { counts.skipped++; continue; }
          try {
            counts[await save(dir, item)]++;
            have.add(item.key);
          } catch (e) {
            counts.failed++;
            failures.push(`${item.name}: ${e.message}`);
          }
          setStatus(`Page ${page} · new ${counts.saved} · already had ${counts.skipped} · failed ${counts.failed}`);
        }
      }
      after = r.next;
      if (after) await sleep(1500);
    } while (after);
    setStatus(
      `Done: ${root.name}/${username} · new ${counts.saved} · already had ${counts.skipped} · failed ${counts.failed}`,
      counts.failed ? "warn" : "ok",
    );
  } catch (e) {
    const where = counts.saved + counts.skipped ? ` (new ${counts.saved}, already had ${counts.skipped} before stopping)` : "";
    setStatus(`${e.name === "AbortError" ? "No folder chosen." : e.message}${where}`, "error");
  } finally {
    if (failures.length) console.warn("[igd] failed downloads:\n" + failures.join("\n"));
    running = false;
    goButton.disabled = folderButton.disabled = false;
  }
}

goButton.addEventListener("click", () => {
  const username = profileFromPath(location.pathname);
  if (username && !running) runProfile(username);
});

folderButton.addEventListener("click", async () => {
  try {
    const root = await rootFolder(true);
    setStatus(`Folder: ${root.name}`, "ok");
  } catch (e) {
    if (e.name !== "AbortError") setStatus(e.message, "error");
  }
});

// ponytail: polling the URL is simpler than hooking history; 500 ms is plenty for a button.
setInterval(() => {
  const username = profileFromPath(location.pathname);
  if (username && !panel.isConnected) document.body.append(panel);
  if (!username && panel.isConnected && !running) { panel.remove(); setStatus(""); }
  if (username && !running) goButton.textContent = `⬇ Download @${username}`;
}, 500);
