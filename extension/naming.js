// File naming and dedup keys. Must stay compatible with collections written by
// the old extension: docs/04-download-and-storage.md, "File naming".

function largest(list) {
  // Strictly greater, so the first candidate wins ties.
  return (list || []).reduce((best, c) => (!best || c.width * c.height > best.width * best.height ? c : best), null);
}

function bestMedia(m) {
  const video = largest(m.video_versions);
  if (video) return { url: video.url, video: true };
  const image = largest(m.image_versions2 && m.image_versions2.candidates);
  return image ? { url: image.url, video: false } : null;
}

// First ".ext" anywhere in the URL that is followed by ?, # or the end; case kept.
function extensionOf(url, video) {
  const m = url.match(/\.([0-9a-z]+)(?:[?#]|$)/i);
  return m ? m[1] : video ? "mp4" : "jpg";
}

function fileName(username, takenAt, id, ext) {
  return `${username}_${takenAt}_${id}.${ext}`.replace(/[<>:"/\\|?*]/g, "");
}

// username may contain "_" and digits, so anchor on the numeric tail:
// taken_at is 9-10 digits (Unix seconds), pk is 12+ digits, owner id optional.
const NAME_RE = /^(.+)_(\d{9,10})_(\d{12,})(?:_(\d+))?\.([A-Za-z0-9]+)$/;

function parseFileName(name) {
  const m = name.match(NAME_RE);
  return m ? { username: m[1], takenAt: Number(m[2]), pk: m[3], ownerId: m[4] || null, ext: m[5] } : null;
}

// Dedup key: the media pk, unique across Instagram and never reused (unlike usernames).
function keyFromFileName(name) {
  const parsed = parseFileName(name);
  return parsed ? parsed.pk : null;
}

// Which account a folder belongs to, judged from the "_<ownerId>" suffix in its file names.
// Collab posts carry other owners, so this is a majority vote.
function inferOwner(names) {
  const counts = new Map();
  let total = 0;
  for (const name of names) {
    const parsed = parseFileName(name);
    if (!parsed || !parsed.ownerId) continue;
    total++;
    counts.set(parsed.ownerId, (counts.get(parsed.ownerId) || 0) + 1);
  }
  let ownerId = null;
  let top = 0;
  for (const [id, n] of counts) if (n > top) [ownerId, top] = [id, n];
  return { ownerId, share: total ? top / total : 0, owners: counts.size };
}

// Identifies a media file by its first bytes, not its name.
function sniffMedia(b) {
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(4, 8) === "ftyp") return "mp4/heic";
  return null;
}

// Records arrive over window messages, which any page script can forge, so only
// Instagram-shaped values and Instagram CDN URLs are accepted.
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const MEDIA_ID_RE = /^\d+(?:_\d+)?$/;
const CDN_URL_RE = /^https:\/\/[a-z0-9.-]+\.(?:cdninstagram\.com|fbcdn\.net)\//i;

function ownerIdOf(node) {
  const u = node.user || {};
  const id = String(u.pk || u.id || String(node.id || "").split("_")[1] || "");
  return /^\d+$/.test(id) ? id : null;
}

// One feed node (v1 shape) -> one item per media file. Invalid parts are dropped.
function itemsFromNode(node) {
  const owner = node && node.user && node.user.username;
  if (typeof owner !== "string" || !USERNAME_RE.test(owner)) return [];
  const parts = node.carousel_media && node.carousel_media.length ? node.carousel_media : [node];
  const items = [];
  for (const m of parts) {
    const best = bestMedia(m);
    if (!best || typeof best.url !== "string" || !CDN_URL_RE.test(best.url)) continue;
    const id = String(m.id || m.pk);
    const pk = String(m.pk || id.split("_")[0]);
    const takenAt = m.taken_at != null ? m.taken_at : node.taken_at;
    if (!MEDIA_ID_RE.test(id) || !/^\d+$/.test(pk) || !Number.isInteger(takenAt)) continue;
    items.push({
      url: best.url,
      key: pk,
      name: fileName(owner, takenAt, id, extensionOf(best.url, best.video)),
      owner,
      ownerId: ownerIdOf(node),
    });
  }
  return items;
}

// "/p/CODE/", "/reel/CODE/", "/reels/CODE/", optionally after "/<user>"; query and hash ignored.
function shortcodeFromPath(path) {
  const m = String(path).match(/^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel|reels)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

const RESERVED = new Set([
  "explore", "reels", "direct", "accounts", "stories", "p", "reel", "tv", "about", "legal",
  "developer", "web", "challenge", "emails", "session", "archive", "your_activity", "create",
  "api", "graphql", "ajax", "static", "privacy", "terms", "nametag", "directory", "lite",
]);

// -> { kind: "profile" | "stories", username } | { kind: "post", shortcode } | { kind: "highlight", id } | null
function routeFromPath(path) {
  const shortcode = shortcodeFromPath(path);
  if (shortcode) return { kind: "post", shortcode };
  const highlight = path.match(/^\/stories\/highlights\/(\d+)\/?/);
  if (highlight) return { kind: "highlight", id: highlight[1] };
  const story = path.match(/^\/stories\/([A-Za-z0-9._]{1,30})(?:\/\d+)?\/?$/);
  if (story && story[1] !== "highlights") return { kind: "stories", username: story[1].toLowerCase() };
  // Trailing slash optional: Instagram and typed URLs use both forms.
  const profile = path.match(/^\/([A-Za-z0-9._]{1,30})(?:\/(?:reels|tagged))?\/?$/);
  if (profile && !RESERVED.has(profile[1].toLowerCase())) return { kind: "profile", username: profile[1].toLowerCase() };
  return null;
}

// Queue entry for a job. Must keep the job's own fields: a highlight job's `id` is the highlight id.
function queueEntry(job) {
  const label = {
    profile: `@${job.username} posts${job.full ? " (full)" : ""}`,
    stories: `@${job.username} ${job.withHighlights ? "stories & highlights" : "stories"}`,
    post: `post ${job.shortcode}`,
    highlight: `highlight ${job.id}`,
    check: "collection check",
  }[job.kind];
  return { ...job, label, state: "queued", detail: "" };
}

// Profile pages list posts newest first, after up to 3 pinned posts. A node is pinned when
// a later node on the same page is newer.
function pinnedFlags(nodes) {
  let newest = -Infinity;
  return nodes.map((n) => Number(n && n.taken_at)).reverse()
    .map((t) => { const pinned = t < newest; if (t > newest) newest = t; return pinned; }).reverse();
}

// A profile re-run stops listing after this many already-saved posts in a row.
const KNOWN_STOP = 12;

// Pinned posts are older than the posts after them, so they neither extend nor break the streak.
function knownStreak(streak, pinned, known) {
  return pinned ? streak : known ? streak + 1 : 0;
}

// Streak after one listing page. A post counts as known only if it was already saved and is no
// newer than `mark`, the newest post of the last complete listing: posts saved by other routes
// (single-post jobs, copied files) can sit above a gap, so they must not extend the streak.
function pageStreak(streak, nodes, saved, mark) {
  const pins = pinnedFlags(nodes);
  return nodes.reduce((s, node, i) => knownStreak(s, pins[i], saved[i] && Number(node && node.taken_at) <= mark), streak);
}

function stopListing(streak, incremental, hasNext) {
  return !!(hasNext && incremental && streak >= KNOWN_STOP);
}

// Jobs worth keeping when the panel closes; a running job restarts as queued.
function unfinished(jobs) {
  return jobs.filter((j) => j.state === "queued" || j.state === "running").map(queueEntry);
}

// Rows to render, newest first: every live job (it carries Stop/Remove), then finished ones up to `cap` total.
function visibleJobs(jobs, cap = 50) {
  const live = (j) => j.state === "queued" || j.state === "running" || j.state === "stopping";
  let room = cap - jobs.filter(live).length;
  return jobs.slice().reverse().filter((j) => live(j) || room-- > 0);
}

// Resolves after ms; rejects with signal.reason if the signal aborts first.
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason);
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { if (signal) signal.removeEventListener("abort", stop); resolve(); }, ms);
    if (signal) signal.addEventListener("abort", stop, { once: true });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    bestMedia, extensionOf, fileName, keyFromFileName, parseFileName, inferOwner, sniffMedia,
    itemsFromNode, shortcodeFromPath, routeFromPath, queueEntry, unfinished, visibleJobs, wait, USERNAME_RE,
    pinnedFlags, knownStreak, pageStreak, stopListing, KNOWN_STOP,
  };
}
