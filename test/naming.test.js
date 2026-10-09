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

// Only queued and running jobs are kept across a panel close, all back as queued.
const kept = n.unfinished([
  { kind: "profile", username: "a", label: "x", state: "running", detail: "page 3", tabId: 4 },
  { kind: "post", shortcode: "ABCDE", label: "post ABCDE", state: "done", detail: "1 saved" },
  { kind: "stories", username: "b", withHighlights: true, label: "x", state: "queued", detail: "" },
  { label: "Not a username", state: "error", detail: "" }, // alertLine entry, no kind
  { kind: "highlight", id: "18000000000000040", label: "x", state: "queued", detail: "" },
  { kind: "post", shortcode: "FGHIJ", label: "x", state: "error", detail: "boom" },
]);
assert.deepEqual(kept, [
  { kind: "profile", username: "a", label: "@a posts", state: "queued", detail: "", tabId: 4 },
  { kind: "stories", username: "b", withHighlights: true, label: "@b stories & highlights", state: "queued", detail: "" },
  { kind: "highlight", id: "18000000000000040", label: "highlight 18000000000000040", state: "queued", detail: "" },
]);
assert.deepEqual(JSON.parse(JSON.stringify(kept)), kept); // plain data, safe for IndexedDB
assert.deepEqual(n.unfinished([]), []);

console.log("naming: all checks passed");
