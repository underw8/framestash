# DASH video quality

Should igd save videos from Instagram's DASH manifest instead of the largest progressive MP4? This note covers what the data looks like, how to parse it, how the video and audio tracks could be combined in the browser, and what that would cost. It ends with the decision.

Today `bestMedia()` (`extension/naming.js`) picks the largest `video_versions` entry, a single progressive MP4 with audio. See [instagram-api.md](instagram-api.md), "Picking the rendition".

## Data

In October 2026, GraphQL post nodes carried three fields ([instagram-api.md](instagram-api.md)):

| Field | Meaning |
|---|---|
| `video_dash_manifest` | an MPEG-DASH MPD as an XML **string** |
| `is_dash_eligible` | whether the post has DASH renditions |
| `number_of_qualities` | how many video qualities the manifest lists |

Expected MPD shape:

```
MPD
└─ Period
   ├─ AdaptationSet  contentType="video"
   │  └─ Representation  width height bandwidth codecs   (one per quality)
   │     ├─ BaseURL      signed CDN URL
   │     └─ SegmentBase  indexRange (sidx)
   └─ AdaptationSet  contentType="audio"
      └─ Representation  bandwidth codecs
         ├─ BaseURL
         └─ SegmentBase
```

With `SegmentBase` and one `BaseURL` per Representation, each track is a single fragmented-MP4 file that can be fetched in one request. Video and audio are separate files.

**To verify:**
- Whether the v1-shaped nodes igd actually consumes (`PolarisProfilePostsQuery`, `PolarisPostRootQuery`) carry `video_dash_manifest`. instagram-api.md only says "post nodes". If they don't, a "go" would need an extra query per post, which costs API budget.
- The exact element and attribute names above (`contentType` vs `mimeType`, whether `width`/`height` sit on the Representation, `SegmentBase` vs `SegmentTemplate`). The probe below prints them.

## Parsing

- Parse in the side panel (`manager.js`) with `DOMParser(…, "application/xml")`. The service worker has no `DOMParser`.
- Video: the Representation with the largest width × height. Audio: the Representation with the highest `bandwidth`.
- Fall back to `bestMedia()` when there's no manifest, it doesn't parse (`parsererror`), or there's no video or no audio set.
- The manifest is untrusted input, like every record that crosses the page bridge. Accept a `BaseURL` only if it's `https:` on a host covered by `host_permissions` (`*.cdninstagram.com`, `*.fbcdn.net`). Otherwise fall back.

## Combining in the browser

| Option | Verdict |
|---|---|
| (a) Save video and audio as two files | Rejected. Breaks one file per pk: `parseFileName()` and pk dedup assume a single `<user>_<taken_at>_<pk>.<ext>`. |
| (b) ffmpeg.wasm | Rejected. About 30 MB vendored binary, needs `'wasm-unsafe-eval'` in the extension CSP, slow, and a large supply-chain surface for one feature. |
| (c) Our own fMP4 track merger | Feasible. See below. |

Option (c), no re-encoding:

1. Write the video file's `ftyp`.
2. Write one `moov` holding both `trak` boxes, with distinct `track_ID`s (e.g. video 1, audio 2). Its `mvex` gets one `trex` per track, and `mvhd.next_track_ID` is set past the highest one.
3. Append each input's `moof`+`mdat` pairs, with `tfhd.track_ID` rewritten to the new ID. Ordering by decode time is nicer for players but not required.
4. Drop `sidx` boxes. Their offsets point into the original files.

`moof` data offsets are relative to the `moof` itself (`default-base-is-moof`), so they survive the move. That needs checking on real files. If a file uses absolute offsets, `trun.data_offset` has to be rewritten too.

Size: about 150–250 lines of box parsing and writing, plus a small fixture pair (video-only and audio-only fMP4) for a Node test. The output is a fragmented MP4. Browsers, VLC and QuickTime play it, and it's still the original bitstream.

## Costs

- **CDN requests:** 2 per video instead of 1. Each one goes through `paceCdn()`, so video-heavy profiles take about twice as long and have twice the exposure to CDN 403/429.
- **Memory:** both tracks plus the merged Blob are in memory at once, so peak memory is about 2× the output size. Long videos on low-memory machines could fail.
- **`save()`** (`extension/collection.js`) fetches a URL and rejects anything that isn't `image/*` or `video/*`. A DASH path needs a variant that takes two fetches (accepting `audio/*` for the audio track) and writes a Blob. The never-overwrite check and the write-after-good-download rule have to stay.
- **`sniffMedia()`** already accepts the output, because the merged file starts with `ftyp`.
- **Drift:** one more undocumented format to track. If the manifest changes shape, the fallback keeps downloads working, at progressive quality.
- **No upgrade for existing collections:** igd never overwrites and dedups on pk. Turning the setting on only affects files not already saved. Re-downloading would mean deleting files by hand.

## Decision: no-go (October 2026)

- The gain is **unmeasured**. Instagram may serve progressive MP4s at the same height as the top DASH rendition for most posts.
- The cost is permanent: a binary-format merger to maintain, twice the CDN requests, and twice the peak memory.
- Existing collections gain nothing (see above).

**Reopen when** the probe shows that the top DASH video Representation is taller than the largest `video_versions` entry on a meaningful share of sampled videos (say, more than a quarter), and the v1-shaped nodes igd uses carry the manifest.

**If we go:**
- An opt-in setting, off by default, in the panel settings.
- Option (c), with the fallback to `bestMedia()` described under "Parsing".
- The DASH path reuses the item's existing `name` from `itemsFromNode()` unchanged: same owner, `taken_at` and media id (`m.id`, i.e. `<pk>_<ownerId>` when present). Only the URL changes. The extension is `mp4`, which `extensionOf()` already yields for progressive video. Names and pk dedup don't change, so a collection can mix progressive and DASH files.

## Probe: how much higher is DASH?

Run in the console of a logged-in instagram.com tab, after pasting `igGraphQL` from [playbook](playbook.md) step 5. It reads one page of a profile's posts and compares heights. It sends one GraphQL request and **no** CDN requests.

```js
const page = await igGraphQL("PolarisProfilePostsQuery", {
  username: "instagram", first: 12, after: null, before: null, last: null,
  data: { count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true,
          latest_besties_reel_media: true, latest_reel_media: true },
  __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
  __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
});
const nodes = (page.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges || [])
  .flatMap((e) => [e.node, ...(e.node.carousel_media || [])]);
const rows = nodes.filter((n) => n.video_versions?.length).map((n) => {
  const progressive = Math.max(...n.video_versions.map((v) => v.height || 0));
  const xml = n.video_dash_manifest &&
    new DOMParser().parseFromString(n.video_dash_manifest, "application/xml");
  const reps = xml ? [...xml.querySelectorAll("Representation")] : [];
  const kind = (r) => r.parentElement.getAttribute("contentType") ||
    (r.getAttribute("mimeType") || r.parentElement.getAttribute("mimeType") || "").split("/")[0];
  const dash = Math.max(0, ...reps.filter((r) => kind(r) === "video").map((r) => +r.getAttribute("height") || 0));
  return { pk: n.pk, progressive, dash, eligible: n.is_dash_eligible, qualities: n.number_of_qualities,
           hasManifest: !!n.video_dash_manifest, audio: reps.some((r) => kind(r) === "audio") };
});
console.table(rows);
({ videos: rows.length, withManifest: rows.filter((r) => r.hasManifest).length,
   dashTaller: rows.filter((r) => r.dash > r.progressive).length,
   dashUnknown: rows.filter((r) => r.hasManifest && !r.dash).length,
   firstRep: nodes.find((n) => n.video_dash_manifest)?.video_dash_manifest.slice(0, 600) });
```

Read the result:
- `withManifest` is 0 → the profile query doesn't carry the field (a "to verify" point above). Try `PolarisPostRootQuery` with `{ shortcode }` on a single reel before concluding.
- `dashUnknown` > 0 → the probe found no video height in those manifests (height not on the Representation?), so `dashTaller` undercounts. Fix the probe from `firstRep` before using the numbers.
- `dashTaller / videos` is the share used by the reopen trigger. Sample a few profiles, including one that posts reels.
- `firstRep` shows the raw MPD start, to check the element and attribute names under "Data".
