// The Framestash panel: owns the collection folder and runs every download.
// The folder handle lives in the extension's own IndexedDB, which pages on
// instagram.com cannot read. Instagram tabs only list records (docs/instagram-api.md); saving
// happens here. Helpers come from naming.js and collection.js.

const $ = (id) => document.getElementById(id);

// ---- folder ----

function openDb(name = "framestash") {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });

// Before 1.0.1 the database was "igd": copy it once (folder handle, queue, cursors, pacing), then delete it.
const migrated = (async () => {
  if (!(await indexedDB.databases()).some((d) => d.name === "igd")) return;
  const [from, to] = await Promise.all([openDb("igd"), openDb()]);
  const read = from.transaction("kv");
  const keys = read.objectStore("kv").getAllKeys(), values = read.objectStore("kv").getAll();
  await done(read);
  const write = to.transaction("kv", "readwrite");
  keys.result.forEach((k, i) => write.objectStore("kv").put(values.result[i], k));
  await done(write);
  from.close();
  to.close();
  indexedDB.deleteDatabase("igd");
})().catch(() => {});

async function kv(key, value) {
  await migrated;
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
  $("folder").textContent = root ? root.name : "No folder chosen";
  $("folder").classList.toggle("unset", !root);
  $("folderHint").textContent = !root ? "Pick the folder that holds your account folders."
    : state === "granted" ? "Account folders are created inside." : "Access needs to be allowed again after a restart.";
  $("pick").textContent = root ? "Change" : "Choose";
  $("grant").hidden = !root || state === "granted";
}

// Jobs only run with a granted, still-existing folder; asking needs a click in this panel.
async function folderReady() {
  if (!root) throw new Error("Choose your collection folder in the Framestash panel.");
  if ((await root.queryPermission({ mode: "readwrite" })) !== "granted") {
    await renderFolder();
    throw new Error("Click “Allow access” in the Framestash panel.");
  }
  try {
    await root.entries().next();
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
    root = null;
    await kv("root", null);
    await renderFolder();
    throw new Error("The collection folder was moved or deleted. Choose it again in the Framestash panel.");
  }
  return root;
}

$("pick").addEventListener("click", async () => {
  try {
    root = await showDirectoryPicker({ id: "framestash-root", mode: "readwrite", startIn: "downloads" });
    await kv("root", root);
    await kv("listed", {}); // "listed to the end" and saved cursors describe the old collection
    await kv("cursors", {});
  } catch (e) {
    if (e.name !== "AbortError") alertLine(e.message);
  }
  await renderFolder();
  await loadCursors();
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
let accepted = false; // first-run notice; the queue waits for it
// One job runs at a time; its controller stays off the job, which is structured-cloned into IndexedDB.
let stopper = null;
let counts = null;
// Copy of kv("cursors") for rendering Start over; a running job owns the stored map.
let savedCursors = {};
const loadCursors = () => kv("cursors").then((c) => { savedCursors = c || {}; renderJobs(); }).catch(() => {});
loadCursors();

// One panel per profile owns the saved queue; the others stand by until it closes.
let ownsQueue; // undefined until the first lock request settles
let decide;
const decided = new Promise((r) => { decide = r; });
const owned = new Promise((resolve) => {
  const hold = () => { ownsQueue = true; decide(); resolve(); return new Promise(() => {}); };
  navigator.locks.request("framestash-queue", { ifAvailable: true }, (lock) => {
    if (lock) return hold();
    ownsQueue = false;
    decide();
    alertLine("Another Framestash panel is running the queue. This one takes over when that panel closes.");
    return navigator.locks.request("framestash-queue", hold);
  });
});

// Writes chain after the restore so an early delivery can't overwrite the saved queue unread.
const restored = owned.then(() => kv("jobs")).then((saved) => {
  jobs.unshift(...(saved || []).filter(validJob).map(queueEntry));
  renderJobs();
}).catch(() => {});
let saving = restored;
const saveQueue = () => { saving = saving.then(() => kv("jobs", unfinished(jobs))).catch(() => {}); };

function alertLine(text) {
  jobs.push({ label: text, state: "error", detail: "" });
  renderJobs();
}

// Stroke icons drawn for Framestash, one per job state.
const STATE_ICONS = {
  queued: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  running: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.8 2.8L16 10"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.4v.1"/>',
  stopped: '<circle cx="12" cy="12" r="8.5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
};
STATE_ICONS.stopping = STATE_ICONS.running;

// Labels and details carry usernames, so they go in with textContent only.
// Rows are updated in place: replacing a row mid-click would drop the click on its button.
const rows = new WeakMap();
function renderJobs() {
  $("empty").hidden = jobs.length > 0;
  const list = $("jobs");
  const shown = visibleJobs(jobs);
  shown.forEach((j, i) => {
    let li = rows.get(j);
    if (!li) {
      li = $("jobRow").content.firstElementChild.cloneNode(true);
      li.querySelector(".job-main").job = li.querySelector(".job-restart").job = j;
      rows.set(j, li);
    }
    const btn = li.querySelector(".job-main");
    const restart = li.querySelector(".job-restart");
    restart.hidden = !startOverShown(j, savedCursors);
    restart.setAttribute("aria-label", `Start over ${j.label}`);
    if (li.dataset.state !== j.state) {
      li.dataset.state = li.title = j.state;
      li.querySelector("svg").innerHTML = STATE_ICONS[j.state];
      const action = { running: "Stop", queued: "Remove" }[j.state];
      btn.hidden = !action;
      if (action) btn.textContent = action;
    }
    li.querySelector(".job-label").textContent = j.label;
    li.querySelector(".job-detail").textContent = j.detail;
    if (!btn.hidden) btn.setAttribute("aria-label", `${btn.textContent} ${j.label}`);
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  while (list.children.length > shown.length) list.lastElementChild.remove();
  $("clear").hidden = clearQueue(jobs).length === jobs.length;
}

$("clear").addEventListener("click", () => {
  jobs.splice(0, jobs.length, ...clearQueue(jobs));
  saveQueue();
  renderJobs();
});

$("jobs").addEventListener("click", (e) => {
  const restart = e.target.closest(".job-restart");
  if (restart) {
    const job = restart.job;
    if (job.state !== "queued") {
      job.restarted = true;
      enqueue({ kind: "profile", username: job.username, ...(job.full && { full: true }), fresh: true, tabId: job.tabId });
      return;
    }
    // Flag the job rather than editing kv("cursors"): a running job rewrites that map whole.
    job.fresh = true;
    job.detail = "Starts from the newest post.";
    saveQueue();
    renderJobs();
    restart.closest("li").querySelector(".job-main").focus();
    return;
  }
  const job = e.target.closest(".job-main")?.job;
  if (!job) return;
  if (job.state === "running") {
    stopper.abort();
    job.state = "stopping";
    job.detail = "Stopping…";
  } else if (job.state === "queued") {
    jobs.splice(jobs.indexOf(job), 1);
  } else return;
  saveQueue();
  renderJobs();
});

function update(job, detail, kind = "") {
  job.detail = detail;
  renderJobs();
  if (job.tabId) chrome.tabs.sendMessage(job.tabId, { type: "status", text: detail, kind }).catch(() => {});
}

// Jobs arrive from content scripts; only well-formed ones are accepted.
function validJob(j) {
  if (!j || typeof j !== "object") return false;
  const user = (u) => typeof u === "string" && USERNAME_RE.test(u);
  return (j.kind === "profile" && user(j.username) && (j.full === undefined || typeof j.full === "boolean")
      && (j.fresh === undefined || typeof j.fresh === "boolean"))
    || (j.kind === "stories" && user(j.username) && (j.pk === undefined || (typeof j.pk === "string" && /^\d{1,25}$/.test(j.pk))))
    || (j.kind === "post" && typeof j.shortcode === "string" && /^[A-Za-z0-9_-]{5,40}$/.test(j.shortcode))
    || (j.kind === "highlight" && /^\d+$/.test(String(j.id))
      && (j.index === undefined || (Number.isInteger(j.index) && j.index >= 0 && j.index <= 999)))
    || j.kind === "check";
}

function enqueue(job) {
  jobs.push(queueEntry(job));
  saveQueue();
  renderJobs();
  pump();
  return jobs.filter((j) => j.state === "queued" || j.state === "running").length;
}

async function pump() {
  if (busy || !ownsQueue || !accepted) return;
  busy = true;
  try {
    await paceLoaded;
    for (let job; (job = jobs.find((j) => j.state === "queued")); ) {
      if (pace.hold && pace.hold.manual) break;
      job.state = "running";
      saveQueue();
      update(job, "Starting…");
      stopper = new AbortController();
      counts = null;
      apiThisJob = 0;
      try {
        await run(job);
        job.state = "done";
        update(job, job.detail, "ok");
      } catch (e) {
        if (stopper.signal.aborted) {
          job.state = "stopped";
          update(job, counts ? `Stopped · ${summary(counts)}` : "Stopped before any file was saved.", "warn");
          saveQueue();
          continue;
        }
        job.state = "error";
        update(job, e.message, "error");
        // A folder problem stops the queue until the user fixes it here.
        if (/Framestash panel/.test(e.message)) { job.state = "queued"; saveQueue(); renderJobs(); break; }
      } finally {
        if (apiThisJob) { pace.lastJobEnd = Date.now(); pace.jobGap = jobGap(apiThisJob, pacing); savePace(); }
        await loadCursors();
      }
      saveQueue();
    }
  } finally {
    busy = false;
  }
}

// ---- talking to an Instagram tab ----

// Tabs opened before Framestash was installed or reloaded have no Framestash script, so each
// candidate is pinged; the job's own tab first, then the most recently used.
async function instagramTab(preferred) {
  const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
  const ordered = tabs.sort((a, b) => (b.id === preferred) - (a.id === preferred) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const tab of ordered) {
    try {
      if ((await chrome.tabs.sendMessage(tab.id, { type: "ping" })) === "framestash") return tab.id;
    } catch { /* no Framestash script in this tab */ }
  }
  throw new Error(tabs.length
    ? "Reload your Instagram tab (Framestash was updated after it was opened), then retry."
    : "Open instagram.com in a tab (logged in), then retry.");
}

// ---- pacing and circuit breaker (rules in pacer.js) ----

let pacing = pacingSettings();
// Persisted so closing the panel or restarting Chrome keeps budgets and holds.
// hold: null or { until (null = until Resume), reason, manual }.
let pace = { stamps: [], sinceBreak: 0, breakAt: nextBreakAt(pacing), lastApi: 0, lastJobEnd: 0, jobGap: 0, trips: 0, lastTrip: 0, hold: null };
let lastCdn = 0;
let apiThisJob = 0; // Instagram calls made by the running job
let resumeNow = () => {};
const paceInputs = document.querySelectorAll("[data-pace]");

const pacingLoaded = kv("pacing").then((s) => { pacing = pacingSettings(s); }).catch(() => {}).then(() => renderPacing());
// Only the queue owner reads and writes the record, so a standby panel can't overwrite it.
const paceLoaded = Promise.all([owned, pacingLoaded]).then(() => kv("pace")).then((p) => {
  if (p && Array.isArray(p.stamps)) pace = { ...pace, ...p };
}).catch(() => {}).then(() => renderHold());
let paceSaving = paceLoaded;
const savePace = () => { paceSaving = paceSaving.then(() => kv("pace", pace)).catch(() => {}); };

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderHold(text = holdText(pace.hold, Date.now(), clock)) {
  $("hold").hidden = !text;
  $("holdText").textContent = text;
  $("resume").hidden = !(pace.hold && pace.hold.manual);
  $("pause").hidden = !!(pace.hold && pace.hold.manual);
}

function renderPacing() {
  for (const i of paceInputs) i.value = pacing[i.dataset.pace];
}

function setPacing(raw) {
  pacing = pacingSettings(raw);
  pace.breakAt = nextBreakAt(pacing);
  renderPacing();
  kv("pacing", pacing).catch(() => {});
  savePace();
}

$("pacingBox").addEventListener("change", () => setPacing(Object.fromEntries([...paceInputs].map((i) => [i.dataset.pace, i.value]))));
$("pacingReset").addEventListener("click", () => setPacing({}));

$("resume").addEventListener("click", () => {
  pace.hold = resumeHold(pace.hold, Date.now()); // trips are kept, so the next trip still doubles
  savePace();
  renderHold();
  resumeNow();
  pump();
  $("pause").focus();
});

$("pause").addEventListener("click", () => {
  pace.hold = pauseHold(pace.hold, Date.now());
  savePace();
  renderHold();
  $("resume").focus();
});

function untilResume(signal) {
  return new Promise((resolve, reject) => {
    resumeNow = resolve;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

// Long waits go in steps of a minute, so a sleeping computer or a settings change is noticed.
async function waitUntil(t) {
  await wait(Math.min(Math.max(0, t - Date.now()), 60e3), stopper.signal);
}

// Every Instagram request waits here first. Order: holds, budget, long break, spacing.
async function paceApi(job) {
  await paceLoaded;
  for (;;) {
    stopper.signal.throwIfAborted();
    const now = Date.now();
    const h = pace.hold;
    if (h && h.manual) {
      await whileManualHold(job);
      continue;
    }
    if (h && h.until > now) {
      update(job, holdText(h, Date.now(), clock), "warn");
      renderHold();
      await waitUntil(h.until);
      continue;
    }
    if (h) { pace.hold = null; savePace(); }
    const budget = budgetWait(pace.stamps, now, pacing);
    pace.stamps = budget.stamps;
    if (budget.resumeAt) {
      const text = `Framestash used its request budget (${pacing.perHour} per hour, ${pacing.perDay} per day). The queue resumes at ${clock(budget.resumeAt)}.`;
      update(job, text, "warn");
      renderHold(text);
      await waitUntil(budget.resumeAt);
      continue;
    }
    renderHold();
    if (pace.sinceBreak >= pace.breakAt) {
      const ms = jitter(pacing.breakMin * 60, pacing.breakMax * 60);
      update(job, `Taking a break from Instagram until ${clock(now + ms)}…`);
      await wait(ms, stopper.signal);
      pace.sinceBreak = 0;
      pace.breakAt = nextBreakAt(pacing);
      savePace();
      continue;
    }
    // The job gap applies only to the first call after a job ended.
    const gap = pace.lastJobEnd >= pace.lastApi ? pace.lastJobEnd + (pace.jobGap || 0) : 0;
    const at = Math.max(pace.lastApi + jitter(pacing.apiMin, pacing.apiMax), gap);
    if (gap > now) update(job, `Waiting until ${clock(gap)} between jobs…`);
    await wait(Math.max(0, at - now), stopper.signal);
    if (pace.hold && pace.hold.manual) continue;
    return;
  }
}

async function whileManualHold(job) {
  while (pace.hold && pace.hold.manual) {
    update(job, holdText(pace.hold, Date.now(), clock), "warn");
    renderHold();
    await untilResume(stopper.signal);
  }
}

async function paceCdn(job) {
  await wait(Math.max(0, lastCdn + jitter(pacing.cdnMin, pacing.cdnMax) - Date.now()), stopper.signal);
  await whileManualHold(job);
  lastCdn = Date.now();
}

const TRIP_TEXT = {
  rate: "Instagram is limiting requests",
  http: "Instagram answered with an error",
  shape: "Instagram sent an unexpected reply; Instagram may have changed the query, and Framestash may need an update",
  login: "Instagram wants you to log in again. Log in on instagram.com.",
  challenge: "Instagram wants you to confirm your account. Clear the check on instagram.com.",
};

// A block signal holds the whole queue; the same call is retried only after the hold clears.
async function bridge(job, op, args) {
  for (;;) {
    await paceApi(job);
    const tabId = await instagramTab(job.tabId);
    let r;
    try {
      r = await chrome.tabs.sendMessage(tabId, { type: "bridge", op, args });
    } catch {
      throw new Error("The Instagram tab didn't answer. Reload it and retry.");
    }
    r = r && typeof r === "object" ? r : { error: "malformed reply" };
    const now = Date.now();
    const n = Math.min(100, Math.max(1, Math.floor(Number(r.requests)) || 1)); // page-reported, so bounded
    for (let i = 0; i < n; i++) pace.stamps.push(now);
    pace.sinceBreak += n;
    pace.lastApi = now;
    apiThisJob += n;
    const trip = classify(op, r);
    if (!trip) { savePace(); return r; }
    pace.trips = nextTrips(pace.trips, pace.lastTrip, now);
    pace.lastTrip = now;
    const why = trip.manual ? TRIP_TEXT[trip.reason] : `${TRIP_TEXT[trip.reason]} (${String(r.error || "missing data").slice(0, 120)}).`;
    pace.hold = tripHold(pace.hold, { until: trip.manual ? null : now + cooldownMs(pace.trips), reason: why, manual: trip.manual });
    savePace();
    renderHold();
  }
}

// ---- running jobs ----

const summary = (c) => `new ${c.saved} · already had ${c.skipped} · failed ${c.failed}`;

function counters(job, prefix) {
  const c = { saved: 0, skipped: 0, failed: 0, failures: [], progress: () => update(job, `${prefix()}${summary(c)}`) };
  c.halt = () => stopper.signal.throwIfAborted();
  c.pace = () => paceCdn(job);
  counts = c;
  return c;
}

async function run(job) {
  const top = await folderReady();

  if (job.kind === "check") {
    update(job, "Checking collection…");
    const report = await checkCollection(top, (n) => { stopper.signal.throwIfAborted(); update(job, `Checking collection… ${n} files`); });
    $("report").textContent = formatReport(report);
    $("reportBox").hidden = false;
    $("reportBox").open = true;
    update(job, `Checked ${top.name}: nothing was changed. Report in the Framestash panel.`);
    return;
  }

  if (job.kind === "profile") {
    const id = await bridge(job, "userId", { username: job.username });
    const account = await resolveAccountDir(top, job.username, id.error ? null : id.pk);
    let page = 0;
    const c = counters(job, () => `Page ${page} · `);
    update(job, "Checking files you already have…");
    const index = await indexFolder(account.dir);
    // listed[pk] is the newest post of the last complete listing: everything at or before it is
    // saved. It is cleared until this run completes too.
    const listedKey = id.error ? null : String(id.pk);
    const listed = (await kv("listed")) || {};
    const prevMark = listedKey && typeof listed[listedKey] === "number" ? listed[listedKey] : null;
    const incremental = !job.full && prevMark !== null;
    if (listedKey) { delete listed[listedKey]; await kv("listed", listed); }
    // cursors[pk] is where an interrupted listing stopped; Start over (job.fresh) drops it.
    const cursors = (await kv("cursors")) || {};
    const dropCursor = async () => { if (listedKey && listedKey in cursors && root === top) { delete cursors[listedKey]; await kv("cursors", cursors); } };
    // Start over once: a restored job resumes from its new position.
    if (job.fresh) { await dropCursor(); delete job.fresh; saveQueue(); }
    const res = listedKey && resumeFrom(cursors[listedKey]);
    if (res && root === top && backfillUsername(cursors, listedKey, job.username)) await kv("cursors", cursors);
    let after = res ? res.after : null;
    page = res ? res.page : 0;
    let streak = 0;
    let newest = res ? Math.max(prevMark ?? -Infinity, res.newest) : prevMark ?? -Infinity;
    const priorFailed = !!(res && res.failed);
    let early = "";
    do {
      const r = await bridge(job, "profilePosts", { username: job.username, after });
      const empty = !r.error && res && page === res.page && !(Array.isArray(r.nodes) && r.nodes.length);
      if (r.error || empty) {
        let note = "";
        const action = cursorOnFailure(res, page, empty);
        if (action === "drop") {
          await dropCursor();
          note = " · saved position no longer works; the next run starts over";
        } else if (action === "retry" && listedKey in cursors && root === top) {
          cursors[listedKey] = { ...cursors[listedKey], tries: res.tries + 1 };
          await kv("cursors", cursors);
        }
        throw new Error(`Stopped listing after ${page} page(s): ${r.error || "saved position returned no posts"} (${summary(c)})${note}`);
      }
      page++;
      const saved = [];
      for (const node of r.nodes) {
        const items = itemsFromNode(node);
        const before = c.skipped;
        await saveItems(account.dir, index, items, c);
        saved.push(items.length > 0 && c.skipped - before === items.length);
        const t = Number(node && node.taken_at);
        if (Number.isFinite(t) && t > newest) newest = t;
      }
      streak = pageStreak(streak, r.nodes, saved, prevMark ?? -Infinity);
      after = typeof r.next === "string" ? r.next : null;
      if (stopListing(streak, incremental, !!after)) {
        after = null;
        early = " · stopped early: nothing older is new";
      }
      if (listedKey && after && root === top) {
        cursors[listedKey] = cursorRecord(after, page, newest, priorFailed, c.failed, job.username);
        await kv("cursors", cursors);
      }
    } while (after);
    await dropCursor();
    if (listedKey && c.failed === 0 && !priorFailed && root === top && Number.isFinite(newest)) { listed[listedKey] = newest; await kv("listed", listed); }
    finish(job, c, `${top.name}/${account.name}${account.note}`);
    job.detail += early + (res ? ` · resumed from page ${res.page}` : "");
    return;
  }

  const request = {
    post: ["post", { shortcode: job.shortcode }, "the post", ""],
    stories: ["stories", { username: job.username, withHighlights: !!job.withHighlights }, job.withHighlights ? "stories or highlights" : "active stories", "stories"],
    highlight: ["highlight", { id: job.id }, "this highlight", "stories"],
  }[job.kind];
  const [op, args, listed, sub] = request;
  const what = job.pk || Number.isInteger(job.index) ? "this story item" : listed;
  update(job, `Loading ${what}…`);
  const r = await bridge(job, op, args);
  if (r.error) throw new Error(`Could not load ${what}: ${r.error}`);
  const nodes = Array.isArray(r.nodes) ? r.nodes : [];
  const items = pickStoryItems(job, nodes);
  if (!items.length) {
    job.detail = `Nothing to download: no ${what} found.`;
    return;
  }
  const account = await resolveAccountDir(top, items[0].owner, items[0].ownerId);
  const dir = sub ? await account.dir.getDirectoryHandle(sub, { create: true }) : account.dir;
  const c = counters(job, () => "");
  // One index over stories/ and its highlight folders, so a pk saved in any of them is skipped.
  const index = await indexFolder(dir, sub === "stories");
  const split = sub === "stories" && $("highlightFolders").checked;
  const groups = new Map();
  for (const item of items) {
    const g = split && item.folder ? item.folder : "";
    groups.set(g, [...(groups.get(g) || []), item]);
  }
  for (const [g, group] of groups) await saveItems(g ? await dir.getDirectoryHandle(g, { create: true }) : dir, index, group, c);
  finish(job, c, [top.name, account.name, sub].filter(Boolean).join("/") + account.note);
}

function finish(job, c, where) {
  if (c.failures.length) console.warn(`[framestash] ${job.label} failed downloads:\n${c.failures.join("\n")}`);
  job.detail = `Done: ${where} · ${summary(c)}`;
}

// ---- inputs ----

// Jobs reach the panel only through background.js, which adds the sending tab's
// id and URL as reported by Chrome (not by the page).
function acceptDelivery(d) {
  if (!d || d.type !== "job" || !String(d.url).startsWith("https://www.instagram.com/") || !validJob(d.job)) {
    return { queued: false, reason: "Framestash: invalid request" };
  }
  return { queued: true, position: enqueue({ ...d.job, tabId: d.tabId }) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "job" || sender.tab || sender.id !== chrome.runtime.id || ownsQueue === false) return false;
  // Standby panels stay silent so only the owner answers.
  decided.then(() => ownsQueue && sendResponse(acceptDelivery(msg)));
  return true;
});

// Tell the background this window's panel is open (see background.js). The port drops
// whenever the service worker stops, so it reconnects, which also wakes the worker.
const myWindow = chrome.windows.getCurrent().then((w) => {
  const connect = () => chrome.runtime.connect({ name: `panel:${w.id}` }).onDisconnect.addListener(connect);
  connect();
  return w.id;
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "closePanel" || sender.tab || sender.id !== chrome.runtime.id) return false;
  myWindow.then((id) => { if (id === msg.windowId) window.close(); });
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
    if ($("withPosts").checked) enqueue({ kind: "profile", username, ...($("fullList").checked && { full: true }) });
    if ($("withStories").checked) enqueue({ kind: "stories", username, withHighlights: true });
  }
  $("usernames").value = bad.join("\n");
  if (bad.length) alertLine(`Not a username or profile URL: ${bad.join(", ")}`);
});

$("check").addEventListener("click", () => enqueue({ kind: "check" }));

kv("highlightFolders").then((on) => { $("highlightFolders").checked = !!on; }).catch(() => {});
$("highlightFolders").addEventListener("change", (e) => kv("highlightFolders", e.target.checked).catch(() => {}));

$("accept").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  await kv("accepted", true);
  accepted = true;
  document.body.classList.remove("first-run");
  $("notice").hidden = true;
  pump();
});

(async () => {
  accepted = !!(await kv("accepted").catch(() => false));
  if (!accepted) {
    document.body.classList.add("first-run");
    $("notice").hidden = false;
    $("accept").focus();
  }
  root = (await kv("root")) || null;
  await renderFolder();
  await restored; // also waits for queue ownership
  pump(); // root is loaded only now
  // Pick up jobs that were sent while this panel was opening.
  const waiting = await chrome.runtime.sendMessage({ type: "managerReady" }).catch(() => []);
  for (const d of waiting || []) acceptDelivery(d);
})();
