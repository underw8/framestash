// The igd panel: owns the collection folder and runs every download.
// The folder handle lives in the extension's own IndexedDB, which pages on
// instagram.com cannot read. Instagram tabs only list records (doc 3); saving
// happens here. Helpers come from naming.js and collection.js.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- folder ----

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

let root = null;

async function renderFolder() {
  const state = root ? await root.queryPermission({ mode: "readwrite" }) : null;
  $("folder").textContent = root ? `📁 ${root.name}` : "No folder chosen";
  $("grant").hidden = !root || state === "granted";
}

// Jobs only run with a granted, still-existing folder; asking needs a click in this panel.
async function folderReady() {
  if (!root) throw new Error("Choose your collection folder in the igd panel.");
  if ((await root.queryPermission({ mode: "readwrite" })) !== "granted") {
    await renderFolder();
    throw new Error("Click “Allow access” in the igd panel.");
  }
  try {
    await root.entries().next();
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
    root = null;
    await kv("root", null);
    await renderFolder();
    throw new Error("The collection folder was moved or deleted. Choose it again in the igd panel.");
  }
  return root;
}

$("pick").addEventListener("click", async () => {
  try {
    root = await showDirectoryPicker({ id: "igd-root", mode: "readwrite", startIn: "downloads" });
    await kv("root", root);
  } catch (e) {
    if (e.name !== "AbortError") alertLine(e.message);
  }
  await renderFolder();
  pump();
});

$("grant").addEventListener("click", async () => {
  if (root) await root.requestPermission({ mode: "readwrite" });
  await renderFolder();
  pump();
});

// ---- jobs ----

const jobs = [];
let busy = false;

function alertLine(text) {
  jobs.push({ id: crypto.randomUUID(), label: text, state: "error", detail: "" });
  renderJobs();
}

function renderJobs() {
  $("jobs").replaceChildren(...jobs.slice(-50).map((j) => {
    const li = document.createElement("li");
    li.dataset.state = j.state;
    li.textContent = `${j.label} — ${j.state}`;
    if (j.detail) {
      const d = document.createElement("span");
      d.className = "detail";
      d.textContent = j.detail;
      li.append(d);
    }
    return li;
  }));
}

function update(job, detail, kind = "") {
  job.detail = detail;
  renderJobs();
  if (job.tabId) chrome.tabs.sendMessage(job.tabId, { type: "status", text: detail, kind }).catch(() => {});
}

function describe(job) {
  return {
    profile: () => `@${job.username} posts`,
    stories: () => `@${job.username} ${job.withHighlights ? "stories & highlights" : "stories"}`,
    post: () => `post ${job.shortcode}`,
    highlight: () => `highlight ${job.id}`,
    check: () => "collection check",
  }[job.kind]();
}

// Jobs arrive from content scripts; only well-formed ones are accepted.
function validJob(j) {
  if (!j || typeof j !== "object") return false;
  const user = (u) => typeof u === "string" && USERNAME_RE.test(u);
  return (j.kind === "profile" && user(j.username))
    || (j.kind === "stories" && user(j.username))
    || (j.kind === "post" && typeof j.shortcode === "string" && /^[A-Za-z0-9_-]{5,40}$/.test(j.shortcode))
    || (j.kind === "highlight" && /^\d+$/.test(String(j.id)))
    || j.kind === "check";
}

function enqueue(job) {
  const entry = { ...job, id: crypto.randomUUID(), label: describe(job), state: "queued", detail: "" };
  jobs.push(entry);
  renderJobs();
  pump();
  return jobs.filter((j) => j.state === "queued" || j.state === "running").length;
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (let job; (job = jobs.find((j) => j.state === "queued")); ) {
      job.state = "running";
      update(job, "Starting…");
      try {
        await run(job);
        job.state = "done";
        renderJobs();
        if (job.tabId) chrome.tabs.sendMessage(job.tabId, { type: "status", text: job.detail, kind: "ok" }).catch(() => {});
      } catch (e) {
        job.state = "error";
        update(job, e.message, "error");
        // A folder problem stops the queue until the user fixes it here.
        if (/igd panel/.test(e.message)) { job.state = "queued"; renderJobs(); break; }
      }
    }
  } finally {
    busy = false;
  }
}

// ---- talking to an Instagram tab ----

// Tabs opened before igd was installed or reloaded have no igd script, so each
// candidate is pinged; the job's own tab first, then the most recently used.
async function instagramTab(preferred) {
  const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
  const ordered = tabs.sort((a, b) => (b.id === preferred) - (a.id === preferred) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const tab of ordered) {
    try {
      if ((await chrome.tabs.sendMessage(tab.id, { type: "ping" })) === "igd") return tab.id;
    } catch { /* no igd script in this tab */ }
  }
  throw new Error(tabs.length
    ? "Reload your Instagram tab (igd was updated after it was opened), then retry."
    : "Open instagram.com in a tab (logged in), then retry.");
}

async function bridge(job, op, args) {
  const waits = [60, 120, 300];
  for (let attempt = 0; ; attempt++) {
    const tabId = await instagramTab(job.tabId);
    let r;
    try {
      r = await chrome.tabs.sendMessage(tabId, { type: "bridge", op, args });
    } catch {
      throw new Error("The Instagram tab didn't answer. Reload it and retry.");
    }
    r = r && typeof r === "object" ? r : { error: "malformed reply" };
    if (r.status !== 429 || attempt >= waits.length) return r;
    update(job, `Instagram is rate-limiting; waiting ${waits[attempt]} s…`, "warn");
    await sleep(waits[attempt] * 1000);
  }
}

// ---- running jobs ----

const summary = (c) => `new ${c.saved} · already had ${c.skipped} · failed ${c.failed}`;

function counters(job, prefix) {
  const c = { saved: 0, skipped: 0, failed: 0, failures: [], progress: () => update(job, `${prefix()}${summary(c)}`) };
  return c;
}

async function run(job) {
  const top = await folderReady();

  if (job.kind === "check") {
    update(job, "Checking collection…");
    const report = await checkCollection(top, (n) => update(job, `Checking collection… ${n} files`));
    $("report").textContent = formatReport(report);
    $("reportBox").hidden = false;
    $("reportBox").open = true;
    update(job, `Checked ${top.name}: nothing was changed. Report in the igd panel.`);
    return;
  }

  if (job.kind === "profile") {
    const id = await bridge(job, "userId", { username: job.username });
    const account = await resolveAccountDir(top, job.username, id.error ? null : id.pk);
    let page = 0;
    const c = counters(job, () => `Page ${page} · `);
    update(job, "Checking files you already have…");
    const index = await indexFolder(account.dir);
    let after = null;
    do {
      const r = await bridge(job, "profilePosts", { username: job.username, after });
      if (r.error) throw new Error(`Stopped listing after ${page} page(s): ${r.error} (${summary(c)})`);
      if (!Array.isArray(r.nodes)) throw new Error("malformed reply from the Instagram tab");
      page++;
      for (const node of r.nodes) await saveItems(account.dir, index, itemsFromNode(node), c);
      after = typeof r.next === "string" ? r.next : null;
      if (after) await sleep(1500);
    } while (after);
    return finish(job, c, `${top.name}/${account.name}${account.note}`);
  }

  const request = {
    post: ["post", { shortcode: job.shortcode }, "the post", ""],
    stories: ["stories", { username: job.username, withHighlights: !!job.withHighlights }, job.withHighlights ? "stories or highlights" : "active stories", "stories"],
    highlight: ["highlight", { id: job.id }, "this highlight", "stories"],
  }[job.kind];
  const [op, args, what, sub] = request;
  update(job, `Loading ${what}…`);
  const r = await bridge(job, op, args);
  if (r.error) throw new Error(`Could not load ${what}: ${r.error}`);
  const items = Array.isArray(r.nodes) ? r.nodes.flatMap(itemsFromNode) : [];
  if (!items.length) {
    job.detail = `Nothing to download: no ${what} found.`;
    return;
  }
  const account = await resolveAccountDir(top, items[0].owner, items[0].ownerId);
  const dir = sub ? await account.dir.getDirectoryHandle(sub, { create: true }) : account.dir;
  const c = counters(job, () => "");
  await saveItems(dir, await indexFolder(dir), items, c);
  finish(job, c, [top.name, account.name, sub].filter(Boolean).join("/") + account.note);
}

function finish(job, c, where) {
  if (c.failures.length) console.warn(`[igd] ${job.label} failed downloads:\n${c.failures.join("\n")}`);
  job.detail = `Done: ${where} · ${summary(c)}`;
}

// ---- inputs ----

// Jobs reach the panel only through background.js, which adds the sending tab's
// id and URL as reported by Chrome (not by the page).
function acceptDelivery(d) {
  if (!d || d.type !== "job" || !String(d.url).startsWith("https://www.instagram.com/")) return { queued: false, reason: "igd: invalid request" };
  if (!validJob(d.job)) return { queued: false, reason: "igd: invalid request" };
  return { queued: true, position: enqueue({ ...d.job, tabId: d.tabId }) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "job" || sender.tab || sender.id !== chrome.runtime.id) return false;
  sendResponse(acceptDelivery(msg));
  return false;
});

function usernameFromLine(line) {
  const s = line.trim().replace(/^@/, "");
  if (!s) return null;
  try {
    const path = new URL(s.includes("://") ? s : `https://www.instagram.com/${s}`).pathname;
    const route = routeFromPath(path.endsWith("/") ? path : `${path}/`);
    return route && route.kind === "profile" ? route.username : null;
  } catch {
    return null;
  }
}

$("add").addEventListener("click", () => {
  const lines = $("usernames").value.split(/\n/);
  const names = [...new Set(lines.map(usernameFromLine).filter(Boolean))];
  const bad = lines.filter((l) => l.trim() && !usernameFromLine(l));
  for (const username of names) {
    if ($("withPosts").checked) enqueue({ kind: "profile", username });
    if ($("withStories").checked) enqueue({ kind: "stories", username, withHighlights: true });
  }
  $("usernames").value = bad.join("\n");
  if (bad.length) alertLine(`Not a username or profile URL: ${bad.join(", ")}`);
});

$("check").addEventListener("click", () => enqueue({ kind: "check" }));

(async () => {
  root = (await kv("root")) || null;
  await renderFolder();
  // Pick up jobs that were sent while this panel was opening.
  const waiting = await chrome.runtime.sendMessage({ type: "managerReady" }).catch(() => []);
  for (const d of waiting || []) acceptDelivery(d);
})();
