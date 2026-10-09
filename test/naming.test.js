// Run: node igd/test/naming.test.js
const assert = require("node:assert/strict");
const n = require("../extension/naming.js");

// Names the old tool wrote (docs/04): pk_owner id, and bare pk from its fallback lookup.
assert.equal(n.keyFromFileName("sample.user_1789389655_3900000000000000071_31600000058.jpg"), "3900000000000000071");
assert.equal(n.keyFromFileName("sample.user_1789389000_3900000000000000071.JPG"), "3900000000000000071");
// The key ignores the username, so files survive an account rename.
assert.equal(n.keyFromFileName("renamed.user_1789389655_3900000000000000071_31600000058.jpg"), "3900000000000000071");
// Usernames with digit segments must not confuse the parser.
assert.deepEqual(n.parseFileName("john_123_x_1789389655_3900000000000000071_316.mp4"),
  { username: "john_123_x", takenAt: 1789389655, pk: "3900000000000000071", ownerId: "316", ext: "mp4" });
// Leftovers and non-media are ignored.
for (const f of ["x_1789389655_3900000000000000071_31600000058.jpg.error.txt", "user_0_.jpg", "user_1790000000_31600000058.jpg", ".DS_Store"]) {
  assert.equal(n.keyFromFileName(f), null, f);
}

// Extension rule: first match anywhere, case kept, fallback by media type.
assert.equal(n.extensionOf("https://cdn.x/v/t51/abc.jpg?stp=dst-jpg_e35&_nc=1", false), "jpg");
assert.equal(n.extensionOf("https://cdn.x/o1/v/t2/f2/m86/AQ.mp4?efg=x", true), "mp4");
assert.equal(n.extensionOf("https://cdn.x/a/B.HEIC", false), "HEIC");
assert.equal(n.extensionOf("https://cdn.x/noext?x=1", true), "mp4");

// Node -> items: carousel slides keep their own id, own taken_at when present, parent's otherwise.
const node = {
  pk: "100000000000000001", id: "100000000000000001_42", taken_at: 1789389655, user: { username: "a.b" },
  carousel_media: [
    { pk: "100000000000000002", id: "100000000000000002_42", taken_at: 1789389600,
      image_versions2: { candidates: [{ url: "https://scontent-a.cdninstagram.com/s.jpg?a", width: 320, height: 320 }, { url: "https://scontent-a.cdninstagram.com/l.jpg?a", width: 1080, height: 1080 }] } },
    { pk: "100000000000000003", id: "100000000000000003_42",
      video_versions: [{ url: "https://instagram.fsgn5-1.fna.fbcdn.net/v.mp4?a", width: 720, height: 1280 }],
      image_versions2: { candidates: [{ url: "https://scontent-a.cdninstagram.com/poster.jpg", width: 1080, height: 1920 }] } },
  ],
};
assert.deepEqual(n.itemsFromNode(node), [
  { url: "https://scontent-a.cdninstagram.com/l.jpg?a", key: "100000000000000002", name: "a.b_1789389600_100000000000000002_42.jpg", owner: "a.b", ownerId: "42" },
  { url: "https://instagram.fsgn5-1.fna.fbcdn.net/v.mp4?a", key: "100000000000000003", name: "a.b_1789389655_100000000000000003_42.mp4", owner: "a.b", ownerId: "42" },
]);
// Owner id prefers user.pk over the id suffix.
assert.equal(n.itemsFromNode({ ...node, user: { username: "a.b", pk: "777" } })[0].ownerId, "777");
// Every generated name must map back to the same key the index uses.
for (const it of n.itemsFromNode(node)) assert.equal(n.keyFromFileName(it.name), it.key);
// Forged page replies are dropped: bad usernames, non-numeric ids, non-CDN URLs, missing timestamps.
const good = { pk: "100000000000000009", id: "100000000000000009_42", taken_at: 1789389655, user: { username: "ok.user" },
  image_versions2: { candidates: [{ url: "https://scontent-a.cdninstagram.com/x.jpg", width: 1, height: 1 }] } };
assert.equal(n.itemsFromNode(good).length, 1);
for (const bad of [
  { ...good, user: { username: "../evil" } },
  { ...good, user: { username: "a".repeat(31) } },
  { ...good, user: null },
  { ...good, id: "1;rm", pk: "1;rm" },
  { ...good, taken_at: "1789389655" },
  { ...good, image_versions2: { candidates: [{ url: "https://evil.example/x.jpg", width: 1, height: 1 }] } },
  { ...good, image_versions2: { candidates: [{ url: "https://cdninstagram.com.evil.example/x.jpg", width: 1, height: 1 }] } },
  { ...good, image_versions2: { candidates: [{ url: "http://scontent-a.cdninstagram.com/x.jpg", width: 1, height: 1 }] } },
]) assert.deepEqual(n.itemsFromNode(bad), [], JSON.stringify(bad).slice(0, 80));
assert.deepEqual(n.itemsFromNode(null), []);

// Ties: first candidate wins.
assert.equal(n.bestMedia({ image_versions2: { candidates: [{ url: "first", width: 10, height: 10 }, { url: "second", width: 10, height: 10 }] } }).url, "first");

// Post links in every form Instagram uses; anything else is not a post.
for (const [path, code] of [
  ["/p/AbC-12dEfGh/", "AbC-12dEfGh"], ["/demo_account/p/AbC-12dEfGh/", "AbC-12dEfGh"],
  ["/reel/XyZ12Ab_c_3/", "XyZ12Ab_c_3"], ["/demo_account/reel/XyZ12Ab_c_3/", "XyZ12Ab_c_3"],
  ["/reels/XyZ12Ab_c_3/", "XyZ12Ab_c_3"], ["/p/AbC-12dEfGh/?img_index=2", "AbC-12dEfGh"], ["/p/AbC-12dEfGh", "AbC-12dEfGh"],
  ["/demo_account/", null], ["/demo_account/reels/", null], ["/reels/", null], ["/explore/", null], ["/p/", null],
  ["/a/b/p/X/", null],
]) assert.equal(n.shortcodeFromPath(path), code, path);

// Page routes decide which button shows and what it downloads.
for (const [path, route] of [
  ["/demo_account/", { kind: "profile", username: "demo_account" }],
  ["/Sample.User/tagged/", { kind: "profile", username: "sample.user" }],
  ["/demo_account/p/AbC-12dEfGh/", { kind: "post", shortcode: "AbC-12dEfGh" }],
  ["/stories/minhhi_taplon/", { kind: "stories", username: "minhhi_taplon" }],
  ["/stories/minhhi_taplon/4000000000000000091/", { kind: "stories", username: "minhhi_taplon" }],
  ["/stories/highlights/18000000000000040/", { kind: "highlight", id: "18000000000000040" }],
  ["/nike", { kind: "profile", username: "nike" }],
  ["/nike/tagged", { kind: "profile", username: "nike" }],
  ["/stories/minhhi_taplon", { kind: "stories", username: "minhhi_taplon" }],
  ["/stories/minhhi_taplon/4000000000000000091", { kind: "stories", username: "minhhi_taplon" }],
  ["/stories/highlights/18000000000000040", { kind: "highlight", id: "18000000000000040" }],
  ["/explore", null], ["/stories", null], ["/stories/highlights", null], ["/nike/saved", null],
  ["/", null], ["/explore/", null], ["/direct/inbox/", null], ["/reels/", null], ["/stories/", null], ["/stories/highlights/", null],
]) assert.deepEqual(n.routeFromPath(path), route, path);

// Folder owner by majority of "_<ownerId>" suffixes; names without a suffix don't vote.
assert.deepEqual(n.inferOwner([
  "u_1789389655_100000000000000001_42.jpg", "u_1789389655_100000000000000002_42.jpg",
  "u_1789389655_100000000000000003_99.jpg", "u_1789389655_100000000000000004.jpg", ".igd.json",
]), { ownerId: "42", share: 2 / 3, owners: 2 });
assert.deepEqual(n.inferOwner([]), { ownerId: null, share: 0, owners: 0 });

// Media sniffing by content.
const bytes = (...xs) => Uint8Array.from(xs.flatMap((x) => typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x]));
assert.equal(n.sniffMedia(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0)), "jpeg");
assert.equal(n.sniffMedia(bytes(0, 0, 0, 0x18, "ftypisom", 0, 0, 0, 0)), "mp4/heic");
assert.equal(n.sniffMedia(bytes("RIFF", 0, 0, 0, 0, "WEBP")), "webp");
assert.equal(n.sniffMedia(bytes("<!DOCTYPE ht")), null); // error page saved under a media name
assert.equal(n.sniffMedia(new Uint8Array(0)), null);

// Queue entries keep the job's own fields: a highlight's id must survive queueing.
const hl = n.queueEntry({ kind: "highlight", id: "18000000000000040", tabId: 7 });
assert.equal(hl.id, "18000000000000040");
assert.equal(hl.label, "highlight 18000000000000040");
assert.equal(hl.state, "queued");
assert.equal(n.queueEntry({ kind: "stories", username: "a.b" }).label, "@a.b stories"); // withHighlights unset = active only
assert.equal(n.queueEntry({ kind: "profile", username: "x", full: true }).label, "@x posts (full)");
assert.equal(n.queueEntry({ kind: "profile", username: "x" }).label, "@x posts");

// pinnedFlags: only nodes older than a later node on the page (pinned, listed first) are flagged.
{
  const t = (...ts) => ts.map((taken_at) => ({ taken_at }));
  assert.deepEqual(n.pinnedFlags(t(100, 200, 900, 800, 700)), [true, true, false, false, false]);
  assert.deepEqual(n.pinnedFlags(t(900, 800, 700)), [false, false, false]);
  assert.deepEqual(n.pinnedFlags([]), []);
}

// knownStreak: pinned posts never move the streak; a new post resets it; it carries across pages.
{
  let s = 0;
  for (let i = 0; i < 3; i++) s = n.knownStreak(s, true, true);
  for (let i = 0; i < 11; i++) s = n.knownStreak(s, false, true);
  assert.equal(s, 11);
  assert.ok(s < n.KNOWN_STOP);
  assert.equal(n.knownStreak(s, true, false), 11); // a new pinned post doesn't reset it
  assert.equal(n.knownStreak(s, false, false), 0);
  s = 0;
  for (const page of [6, 6]) for (let i = 0; i < page; i++) s = n.knownStreak(s, false, true);
  assert.equal(s, n.KNOWN_STOP);
}

// pageStreak + stopListing: the per-page stop decision, with the watermark rule.
{
  const node = (taken_at) => ({ taken_at });
  const all = (k, v) => Array(k).fill(v);
  const mark = 1000;
  // page 1: 3 pinned known posts, then 11 known posts → no stop yet
  const p1 = [node(10), node(20), node(30), ...Array.from({ length: 11 }, (_, i) => node(900 - i))];
  let s = n.pageStreak(0, p1, all(14, true), mark);
  assert.equal(s, 11);
  assert.equal(n.stopListing(s, true, true), false);
  // page 2: one more known post → stop
  s = n.pageStreak(s, [node(500)], [true], mark);
  assert.equal(s, n.KNOWN_STOP);
  assert.equal(n.stopListing(s, true, true), true);
  assert.equal(n.stopListing(s, false, true), false); // full listing never stops
  assert.equal(n.stopListing(s, true, false), false); // last page: nothing left to skip
  // a new post resets the streak
  assert.equal(n.pageStreak(s, [node(400)], [false], mark), 0);
  // watermark: saved posts newer than the mark (single-post jobs) don't count as known
  const newer = Array.from({ length: 12 }, (_, i) => node(2000 - i));
  assert.equal(n.pageStreak(0, newer, all(12, true), mark), 0);
  assert.equal(n.pageStreak(0, [...newer, node(990)], all(13, true), mark), 1);
  // no mark yet: nothing counts as known
  assert.equal(n.pageStreak(0, [node(5)], [true], -Infinity), 0);
}

// Only queued and running jobs are kept across a panel close, all back as queued.
const kept = n.unfinished([
  { kind: "profile", username: "a", label: "x", state: "running", detail: "page 3", tabId: 4 },
  { kind: "post", shortcode: "ABCDE", label: "post ABCDE", state: "done", detail: "1 saved" },
  { kind: "stories", username: "b", withHighlights: true, label: "x", state: "queued", detail: "" },
  { label: "Not a username", state: "error", detail: "" }, // alertLine entry, no kind
  { kind: "highlight", id: "18000000000000040", label: "x", state: "queued", detail: "" },
  { kind: "post", shortcode: "FGHIJ", label: "x", state: "error", detail: "boom" },
  { kind: "profile", username: "c", label: "x", state: "stopped", detail: "Stopped" },
  { kind: "profile", username: "d", label: "x", state: "stopping", detail: "Stopping…" },
]);
assert.deepEqual(kept, [
  { kind: "profile", username: "a", label: "@a posts", state: "queued", detail: "", tabId: 4 },
  { kind: "stories", username: "b", withHighlights: true, label: "@b stories & highlights", state: "queued", detail: "" },
  { kind: "highlight", id: "18000000000000040", label: "highlight 18000000000000040", state: "queued", detail: "" },
]);
assert.deepEqual(JSON.parse(JSON.stringify(kept)), kept); // plain data, safe for IndexedDB
assert.deepEqual(n.unfinished([]), []);

// visibleJobs(): newest first, every live job kept, finished rows fill what is left of the cap.
{
  const mk = (state, i) => ({ state, label: `${state}${i}` });
  const few = [mk("done", 0), mk("running", 1), mk("queued", 2)];
  assert.deepEqual(n.visibleJobs(few), few.slice().reverse());
  const finished = Array.from({ length: 60 }, (_, i) => mk(i % 2 ? "done" : "error", i));
  const live = [mk("running", 0), mk("queued", 1), mk("stopping", 2)];
  const mixed = [live[0], ...finished.slice(0, 30), live[1], ...finished.slice(30), live[2]];
  const shown = n.visibleJobs(mixed);
  assert.equal(shown.length, 50);
  assert.ok(live.every((j) => shown.includes(j)));
  assert.deepEqual(shown.filter((j) => !live.includes(j)), finished.slice(-47).reverse());
  assert.deepEqual(shown, mixed.filter((j) => shown.includes(j)).reverse()); // display order is newest first
  const many = Array.from({ length: 55 }, (_, i) => mk("queued", i));
  assert.deepEqual(n.visibleJobs([...finished.slice(0, 5), ...many]), many.slice().reverse());
  assert.deepEqual(n.visibleJobs(finished.slice(0, 3), 2), finished.slice(1, 3).reverse());
  assert.deepEqual(n.visibleJobs([]), []);
}

(async () => {
  // wait(): resolves, rejects at once on an aborted signal, rejects and clears its timer when aborted mid-wait.
  await n.wait(20);
  const reason = new Error("stop");
  await assert.rejects(n.wait(10000, AbortSignal.abort(reason)), (e) => e === reason);
  const ac = new AbortController();
  const pending = n.wait(10000, ac.signal);
  ac.abort(reason);
  await assert.rejects(pending, (e) => e === reason); // a live timer would keep node running ~10 s

  console.log("naming: all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
