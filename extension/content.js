// Isolated content script: buttons, folder handling, download loop.
// Functions from naming.js are in scope (listed first in the manifest).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- folder ----
// The handle lives only in this isolated world's memory: anything stored in
// instagram.com's storage would be readable, and usable, by any script on the page.
// Cost: the folder is chosen once per tab; the picker remembers its last location.
let root = null;
indexedDB.deleteDatabase("igd"); // v0.1 persisted the handle there

// Must be called straight from a click: permission prompts and the picker need user activation.
async function rootFolder(forcePick) {
  if (root && !forcePick) {
    if ((await root.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error("Write permission for the download folder was not granted.");
    }
    try {
      await root.entries().next();
      return root;
    } catch (e) {
      if (e.name !== "NotFoundError") throw e; // moved or deleted: ask again
    }
  }
  root = await showDirectoryPicker({ id: "igd-root", mode: "readwrite", startIn: "downloads" });
  return root;
}

// ---- page-world bridge ----
// The field is "op", not "procedure": the old extension's page script answers any
// message with a "procedure" field, and its reply would reach our port first.
// Replies are untrusted (any page script can answer); naming.js validates records.

function pageCall(op, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "no answer from page script (reload the tab)" }), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && typeof e.data === "object" ? e.data : { error: "malformed reply" });
    };
    window.postMessage({ igd: 1, op, ...args }, location.origin, [ch.port2]);
  });
}

async function withBackoff(call, onWait) {
  const waits = [60, 120, 300];
  for (let attempt = 0; ; attempt++) {
    const r = await call();
    if (r.status !== 429 || attempt >= waits.length) return r;
    onWait(waits[attempt]);
    await sleep(waits[attempt] * 1000);
  }
}

// ---- files ----

// key -> file handles whose names map to that key; `true` once saved in this run.
async function indexFolder(dir) {
  const index = new Map();
  for await (const [name, handle] of dir.entries()) {
    const key = handle.kind === "file" && keyFromFileName(name);
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
    if (await alreadyHave(index, item.key)) {
      job.skipped++;
    } else {
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

// ---- jobs ----

async function downloadProfile(username, job) {
  const dir = await (await rootFolder(false)).getDirectoryHandle(username, { create: true });
  job.where = `${root.name}/${username}`;
  setStatus("Checking files you already have…");
  const index = await indexFolder(dir);
  let after = null;
  let page = 0;
  job.progress = () => setStatus(`Page ${page} · ${job.summary()}`);
  do {
    const r = await withBackoff(
      () => pageCall("profilePosts", { username, after }),
      (s) => setStatus(`Instagram is rate-limiting; waiting ${s} s…`, "warn"),
    );
    if (r.error) throw new Error(`Stopped listing after ${page} page(s): ${r.error}`);
    if (!Array.isArray(r.nodes)) throw new Error("malformed reply from page script");
    page++;
    for (const node of r.nodes) await saveItems(dir, index, itemsFromNode(node), job);
    after = typeof r.next === "string" ? r.next : null;
    if (after) await sleep(1500);
  } while (after);
}

// Fetches records through the page bridge and saves them under <root>/<owner>[/<sub>].
async function downloadRecords(op, args, what, sub, job) {
  const top = await rootFolder(false);
  setStatus(`Loading ${what}…`);
  const r = await withBackoff(
    () => pageCall(op, args),
    (s) => setStatus(`Instagram is rate-limiting; waiting ${s} s…`, "warn"),
  );
  if (r.error) throw new Error(`Could not load ${what}: ${r.error}`);
  const items = Array.isArray(r.nodes) ? r.nodes.flatMap(itemsFromNode) : [];
  if (!items.length) throw new Error(`Nothing to download: no ${what} found.`);
  const owner = items[0].key.split(":")[0]; // validated Instagram username
  let dir = await top.getDirectoryHandle(owner, { create: true });
  if (sub) dir = await dir.getDirectoryHandle(sub, { create: true });
  job.where = [top.name, owner, sub].filter(Boolean).join("/");
  job.progress = () => setStatus(job.summary());
  await saveItems(dir, await indexFolder(dir), items, job);
}

const downloadPost = (shortcode, job) => downloadRecords("post", { shortcode }, "the post", "", job);

// ---- UI ----

const panel = document.createElement("div");
panel.className = "igd-panel";
panel.innerHTML = `
  <div class="igd-row">
    <button class="igd-go" type="button"></button>
    <button class="igd-stories" type="button" title="Active stories and all highlights" hidden>⬇ Stories</button>
    <button class="igd-folder" type="button" title="Choose download folder">📁</button>
  </div>
  <div class="igd-status" aria-live="polite"></div>`;
const goButton = panel.querySelector(".igd-go");
const folderButton = panel.querySelector(".igd-folder");
const storiesButton = panel.querySelector(".igd-stories");
const statusLine = panel.querySelector(".igd-status");
let running = false;

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

async function runJob(route) {
  running = true;
  goButton.disabled = folderButton.disabled = storiesButton.disabled = true;
  const job = {
    saved: 0, skipped: 0, failed: 0, failures: [], where: "", progress() {},
    summary() { return `new ${this.saved} · already had ${this.skipped} · failed ${this.failed}`; },
  };
  try {
    if (route.kind === "profile") await downloadProfile(route.username, job);
    else if (route.kind === "post") await downloadPost(route.shortcode, job);
    // Stories and highlights share one folder: a highlighted story keeps its pk, so it is saved once.
    else if (route.kind === "stories") await downloadRecords("stories", { username: route.username, withHighlights: route.withHighlights }, route.withHighlights ? "stories or highlights" : "active stories", "stories", job);
    else if (route.kind === "highlight") await downloadRecords("highlight", { id: route.id }, "this highlight", "stories", job);
    setStatus(`Done: ${job.where} · ${job.summary()}`, job.failed ? "warn" : "ok");
  } catch (e) {
    const partial = job.saved + job.skipped ? ` (${job.summary()} before stopping)` : "";
    const message = e.name === "AbortError" ? "No folder chosen."
      : e.name === "SecurityError" ? "Click the button again to choose the folder."
      : e.message;
    setStatus(`${message}${partial}`, "error");
  } finally {
    if (job.failures.length) console.warn("[igd] failed downloads:\n" + job.failures.join("\n"));
    running = false;
    goButton.disabled = folderButton.disabled = storiesButton.disabled = false;
  }
}

goButton.addEventListener("click", () => {
  const route = routeFromPath(location.pathname);
  if (route && !running) runJob(route);
});

storiesButton.addEventListener("click", () => {
  const route = routeFromPath(location.pathname);
  if (route && route.kind === "profile" && !running) runJob({ kind: "stories", username: route.username, withHighlights: true });
});

// ---- per-item buttons on grid tiles and feed posts ----
// The shortcode comes from the post link inside each tile or article, so no
// Instagram class names or React internals are involved.

const POST_LINK = 'a[href*="/p/"], a[href*="/reel/"]';

function addItemButton(host, shortcode, top) {
  if (host.querySelector(":scope > .igd-item")) return;
  if (getComputedStyle(host).position === "static") host.classList.add("igd-host");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "igd-item";
  button.title = "Save this post (igd)";
  button.textContent = "⬇";
  button.dataset.shortcode = shortcode;
  if (top) button.style.top = `${top}px`;
  host.append(button);
}

function scanItems() {
  // Grid tiles: the link itself wraps the thumbnail.
  for (const a of document.querySelectorAll(POST_LINK)) {
    const shortcode = shortcodeFromPath(new URL(a.href, location.origin).pathname);
    if (shortcode && a.querySelector("img, video")) addItemButton(a, shortcode);
  }
  // Feed posts: an <article> whose links include the post's permalink.
  for (const article of document.querySelectorAll("article")) {
    const link = [...article.querySelectorAll(POST_LINK)]
      .map((a) => shortcodeFromPath(new URL(a.href, location.origin).pathname))
      .find(Boolean);
    if (!link) continue;
    // Sit on the media's top-right corner, below the post header and its "…" menu.
    const media = [...article.querySelectorAll("img, video")].find((m) => m.getBoundingClientRect().width >= 200);
    const top = media ? Math.round(media.getBoundingClientRect().top - article.getBoundingClientRect().top) + 8 : 64;
    addItemButton(article, link, top);
  }
}

// Capture phase, so the tile's link never navigates and Instagram's handlers never see the click.
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element && e.target.closest(".igd-item");
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  if (running) { setStatus("A download is already running.", "warn"); return; }
  runJob({ kind: "post", shortcode: button.dataset.shortcode });
}, true);

let scanTimer = 0;
new MutationObserver((records) => {
  // Ignore our own insertions so adding buttons doesn't retrigger the scan.
  if (records.every((r) => [...r.addedNodes].every((n) => n.classList && n.classList.contains("igd-item")))) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanItems, 300);
}).observe(document.body, { childList: true, subtree: true });
scanItems();

folderButton.addEventListener("click", async () => {
  try {
    setStatus(`Folder: ${(await rootFolder(true)).name}`, "ok");
  } catch (e) {
    if (e.name !== "AbortError") setStatus(e.message, "error");
  }
});

// ponytail: polling the URL is simpler than hooking history; 500 ms is plenty for a button.
// The panel stays on every page so jobs started from tiles can report; the main
// button only shows on profile and post pages.
let shownPath = null;
setInterval(() => {
  if (!panel.isConnected) document.body.append(panel);
  if (running || shownPath === location.pathname) return;
  shownPath = location.pathname;
  const route = routeFromPath(location.pathname);
  setStatus("");
  goButton.hidden = !route;
  storiesButton.hidden = !route || route.kind !== "profile";
  const labels = {
    profile: () => `⬇ Download @${route.username}`,
    post: () => "⬇ Save post",
    stories: () => `⬇ Save @${route.username}'s stories`,
    highlight: () => "⬇ Save highlight",
  };
  if (route) goButton.textContent = labels[route.kind]();
}, 500);
