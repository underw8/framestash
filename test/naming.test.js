// Run: node igd/test/naming.test.js
const assert = require("node:assert/strict");
const n = require("../extension/naming.js");

// Names the old tool wrote (docs/04): pk_owner id, and bare pk from its fallback lookup.
assert.equal(n.keyFromFileName("sample.user_1789389655_3900000000000000071_31600000058.jpg"), "sample.user:3900000000000000071");
assert.equal(n.keyFromFileName("sample.user_1789389000_3900000000000000071.JPG"), "sample.user:3900000000000000071");
// Usernames with digit segments must not confuse the parser.
assert.equal(n.keyFromFileName("john_123_x_1789389655_3900000000000000071_316.mp4"), "john_123_x:3900000000000000071");
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
  { url: "https://scontent-a.cdninstagram.com/l.jpg?a", key: "a.b:100000000000000002", name: "a.b_1789389600_100000000000000002_42.jpg" },
  { url: "https://instagram.fsgn5-1.fna.fbcdn.net/v.mp4?a", key: "a.b:100000000000000003", name: "a.b_1789389655_100000000000000003_42.mp4" },
]);
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

console.log("naming: all checks passed");
