// Run: node igd/test/collection.test.js
// Exercises folder resolution and the collection check against an in-memory folder tree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ctx = vm.createContext({ console, TextDecoder, Uint8Array });
for (const f of ["naming.js", "collection.js"]) vm.runInContext(fs.readFileSync(`${__dirname}/../extension/${f}`, "utf8"), ctx);

// Minimal File System Access stand-ins.
const notFound = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
class FakeFile {
  constructor(bytes) { this.bytes = bytes; this.size = bytes.length; }
  async text() { return Buffer.from(this.bytes).toString("utf8"); }
  slice(a, b) { return new FakeFile(this.bytes.slice(a, b)); }
  async arrayBuffer() { return Uint8Array.from(this.bytes).buffer; }
}
class FakeFileHandle {
  constructor() { this.kind = "file"; this.bytes = []; }
  async getFile() { return new FakeFile(this.bytes); }
  async createWritable() { const h = this; return { async write(d) { h.bytes = [...Buffer.from(d)]; }, async close() {} }; }
}
class FakeDir {
  constructor(name) { this.kind = "directory"; this.name = name; this.children = new Map(); }
  async getDirectoryHandle(n, o = {}) {
    if (!this.children.has(n)) { if (!o.create) throw notFound(); this.children.set(n, new FakeDir(n)); }
    return this.children.get(n);
  }
  async getFileHandle(n, o = {}) {
    if (!this.children.has(n)) { if (!o.create) throw notFound(); this.children.set(n, new FakeFileHandle()); }
    return this.children.get(n);
  }
  async *entries() { yield* this.children.entries(); }
  file(n, bytes = [0xff, 0xd8, 0xff, 0xe0]) { const h = new FakeFileHandle(); h.bytes = bytes; this.children.set(n, h); return this; }
}
const media = (user, pk, owner) => `${user}_1789389655_${pk}${owner ? `_${owner}` : ""}.jpg`;
const marker = async (dir) => JSON.parse(await (await (await dir.getFileHandle(".igd.json")).getFile()).text());

(async () => {
  const root = new FakeDir("IG");
  // Old-tool folders: no markers.
  (await root.getDirectoryHandle("old_name", { create: true }))
    .file(media("old_name", "100000000000000001", "42")).file(media("old_name", "100000000000000002", "42"));
  (await root.getDirectoryHandle("taken", { create: true }))
    .file(media("taken", "100000000000000003", "77"));

  // 1. Renamed account (42 was @old_name, now @new_name): found by file-name inference, marker written.
  let r = await ctx.resolveAccountDir(root, "new_name", "42");
  assert.equal(r.name, "old_name");
  assert.match(r.note, /now @new_name/);
  assert.deepEqual(await marker(r.dir), { version: 1, userId: "42", usernames: ["old_name", "new_name"] });

  // 2. Second run: found through the marker this time.
  r = await ctx.resolveAccountDir(root, "new_name", "42");
  assert.equal(r.name, "old_name");

  // 3. A different account (88) now owns the name "taken": it must not share the folder.
  r = await ctx.resolveAccountDir(root, "taken", "88");
  assert.equal(r.name, "taken_88");
  assert.equal((await marker(r.dir)).userId, "88");
  assert.equal(await (async () => { try { await (await root.getDirectoryHandle("taken")).getFileHandle(".igd.json"); return "marked"; } catch { return "untouched"; } })(), "untouched");

  // 4. The original owner of "taken" (77) still lands in its own folder and gets a marker.
  r = await ctx.resolveAccountDir(root, "taken", "77");
  assert.equal(r.name, "taken");
  assert.equal((await marker(r.dir)).userId, "77");

  // 5. Brand-new account: plain folder, marked.
  r = await ctx.resolveAccountDir(root, "fresh", "99");
  assert.equal(r.name, "fresh");
  assert.equal((await marker(r.dir)).userId, "99");

  // 5b. "<username>_<userId>" already owned by yet another account: refuse rather than share it.
  (await root.getDirectoryHandle("dup", { create: true })).file(media("dup", "100000000000000030", "61"));
  const squatter = await root.getDirectoryHandle("dup_62", { create: true });
  await (await squatter.getFileHandle(".igd.json", { create: true })).createWritable().then(async (w) => { await w.write(JSON.stringify({ version: 1, userId: "63", usernames: ["x"] })); await w.close(); });
  await assert.rejects(ctx.resolveAccountDir(root, "dup", "62"), /belongs to another account/);
  assert.equal((await marker(squatter)).userId, "63");

  // 6. No user id available: legacy behaviour, by name, no marker.
  r = await ctx.resolveAccountDir(root, "noid", null);
  assert.equal(r.name, "noid");

  // Collection check: duplicates, empty files, error pages, split accounts. Nothing is written.
  const check = new FakeDir("IG2");
  (await check.getDirectoryHandle("a", { create: true }))
    .file(media("a", "100000000000000010", "5"))
    .file("a_1789389000_100000000000000010.jpg")                     // same pk, fallback-style name
    .file(media("a", "100000000000000011", "5"), [])                 // empty
    .file(media("a", "100000000000000012", "5"), [...Buffer.from("<!DOCTYPE html>")]) // saved error page
    .file(media("a", "100000000000000013", "5") + ".error.txt", [...Buffer.from("x")])
    .file("notes.txt", [...Buffer.from("x")]);
  (await check.getDirectoryHandle("a_renamed", { create: true })).file(media("a_renamed", "100000000000000020", "5"));
  const before = JSON.stringify([...check.children.keys()]);
  const report = await ctx.checkCollection(check, () => {});
  const a = report.accounts.find((x) => x.name === "a").folders.posts;
  assert.equal(a.duplicates.length, 1);
  assert.equal(a.empty.length, 1);
  assert.equal(a.notMedia.length, 1);
  assert.equal(a.errorTxt, 1);
  // Values from the vm context have foreign prototypes, so compare as JSON.
  assert.equal(JSON.stringify(a.unparsed), JSON.stringify(["notes.txt"]));
  assert.equal(JSON.stringify(report.split), JSON.stringify([{ userId: "5", folders: ["a", "a_renamed"] }]));
  assert.equal(JSON.stringify([...check.children.keys()]), before);
  const text = ctx.formatReport(report);
  assert.match(text, /1 accounts split across folders/);
  assert.match(text, /user 5: a, a_renamed/);

  console.log("collection: all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
