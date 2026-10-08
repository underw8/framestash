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

function mediaKey(username, pk) {
  return `${username}:${pk}`;
}

// username may contain "_" and digits, so anchor on the numeric tail:
// taken_at is 9-10 digits (Unix seconds), pk is 12+ digits, owner id optional.
const NAME_RE = /^(.+)_(\d{9,10})_(\d{12,})(?:_\d+)?\.[A-Za-z0-9]+$/;

function keyFromFileName(name) {
  const m = name.match(NAME_RE);
  return m ? mediaKey(m[1], m[3]) : null;
}

// One feed node (v1 shape) -> one item per media file.
function itemsFromNode(node) {
  const owner = node.user && node.user.username;
  const parts = node.carousel_media && node.carousel_media.length ? node.carousel_media : [node];
  const items = [];
  for (const m of parts) {
    const best = bestMedia(m);
    if (!owner || !best) continue;
    const id = String(m.id || m.pk);
    const pk = String(m.pk || id.split("_")[0]);
    const takenAt = m.taken_at != null ? m.taken_at : node.taken_at;
    items.push({
      url: best.url,
      key: mediaKey(owner, pk),
      name: fileName(owner, takenAt, id, extensionOf(best.url, best.video)),
    });
  }
  return items;
}

if (typeof module !== "undefined") {
  module.exports = { bestMedia, extensionOf, fileName, keyFromFileName, itemsFromNode, mediaKey };
}
