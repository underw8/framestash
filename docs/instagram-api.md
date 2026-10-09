# Instagram API

What igd uses to list posts, stories and highlights. None of this is documented or stable; it was checked live in October 2026. Re-check with the [playbook](playbook.md) (steps 2–5) before relying on it, and update this file when something has changed.

All calls run in the **page world** (`extension/page.js`), because some tokens exist only there. The panel never talks to Instagram except to fetch CDN bytes.

## Session values

The browser sends Instagram's cookies with same-origin requests, so igd never handles login. Per request, `page.js` reads:

| Value | Source |
|---|---|
| `doc_id` | `require("<Operation>_instagramRelayOperation")` |
| `fb_dtsg` | `require("DTSGInitialData").token`. Mandatory: without it the server answers with HTML |
| `lsd` | `require("LSD").token`, sent in the body and as `x-fb-lsd` |
| app ID | `require("PolarisConfig").getIGAppID()` |
| CSRF token | the `csrftoken` cookie, sent as `x-csrftoken` |

Nothing is hardcoded or stored. No `www-claim` header is needed.

## GraphQL model

- `POST /api/graphql`, form-encoded: `doc_id`, `variables` (JSON), `lsd`, `fb_dtsg`.
- `doc_id` is a persisted-query ID that rotates. Instagram's module loader exposes it under a stable operation name, so it is read at call time.
- Queries also expect Relay "provided variables" (feature flags). igd reads their names from `require("<Operation>.graphql")` and sends them as `false`, as Instagram does.
- A body may start with `for (;;);`, which is stripped before parsing.
- Some queries return data and a field-level error together. If the root field has data, it wins.

## Queries igd uses

| Purpose | Operation | Variables | Root field | Notes |
|---|---|---|---|---|
| profile posts | `PolarisProfilePostsQuery` | `username`, `first: 12`, `after`, `data: {count, …}` | `xdt_api__v1__feed__user_timeline_graphql_connection` | `edges[].node`, `page_info {has_next_page, end_cursor}` |
| one post | `PolarisPostRootQuery` | `shortcode` | `xdt_api__v1__media__shortcode__web_info` | `items[]` |
| username → user ID | `PolarisAPITopsearchQuery` | `data: {query, context: "blended", …}` | `xdt_api__v1__fbsearch__topsearch_connection` | match the username exactly, case-insensitive. Works for private accounts and accounts without posts, unlike the profile posts query |
| a profile's highlights | `PolarisProfileStoryHighlightsTrayContentQuery` | `user_id`, `first`, `after` | `highlights` | node IDs look like `highlight:<id>` |
| stories / highlight items | `PolarisStoriesV3ReelPageStandaloneQuery` | `reel_ids_arr`, `is_highlight`, `media_id: null` | `xdt_api__v1__feed__reels_media` | see "Stories and highlights" |

## Record shape

Every node igd consumes has the v1 shape, because the GraphQL layer wraps the same backend objects:

| Field | Meaning |
|---|---|
| `pk` | numeric media key |
| `id` | `<pk>_<owner user ID>` |
| `user.username`, `user.pk` | owner |
| `taken_at` | Unix seconds. Carousel children from the profile posts query lack it; igd uses the parent's |
| `carousel_media[]` | carousel children, each with its own `pk`, `id` and media |
| `image_versions2.candidates[]` | `{url, width, height}` |
| `video_versions[]` | `{url, width, height}`, progressive MP4 with audio |

Post nodes may also carry `is_dash_eligible`, `number_of_qualities` and `video_dash_manifest`; see [DASH video](dash-video.md).

`itemsFromNode` treats every node as untrusted: Instagram-shaped usernames and IDs only, and media URLs only on `*.cdninstagram.com` or `*.fbcdn.net`.

## Picking the rendition

`video_versions` if present, else `image_versions2.candidates`. The largest width × height wins; the first wins ties. No DASH, no separate audio, no muxing.

## Carousel slide matching

The one-slide button saves only the visible slide. igd takes the shown `<img>`'s `currentSrc` (or the video's `poster`), keeps its CDN file name (the last path segment, query dropped), and matches it against each `carousel_media[]` part's `image_versions2.candidates[].url` and `video_versions[].url`. If nothing matches, nothing is saved.

- The pagination dots are not used (they need Instagram class names), and neither is `img_index` (in the feed it can belong to another post).
- An image is assumed to keep the same file name across its size variants. **To verify** (playbook step 2).
- A post counts as a carousel when its `<article>` holds 2 or more large media with different frames. No class names, dots or aria-labels are used.

## Profile listing

- `PolarisProfilePostsQuery` lists posts newest first by `taken_at`. Up to 3 pinned posts come first on page 1, with older `taken_at` than the posts after them, and may appear again at their date position.
- Page size varies (10 posts for `first: 12` on a large account; a 6-post profile returned 7 edges, its pinned post twice). Dedup by `pk`.
- Each page is written before the next is requested.
- A private account or one without posts returns nothing; use topsearch for its user ID.

### Incremental re-runs

- A run stops listing once **12 posts in a row** are already saved and no newer than the newest post of the last complete listing. Pinned posts (a later node on the same page is newer) neither count towards the 12 nor break the run.
- The early stop applies only when an earlier run of that account **listed to the end** with no failed files. The panel keeps this flag per user ID; it is cleared at the start of each run and when the collection folder changes.
- **List every post** forces a full listing.

### Cursor

- While a run lists, the panel saves `page_info.end_cursor` per user ID after every page, and the next run of that account continues from it.
- The cursor is cleared when a listing completes, when the collection folder changes, and by **List every post** or **Start over**.
- How long a cursor stays valid is unknown. A failing resume page is retried once; a second failure, or an empty page, drops the cursor and the next run starts from the top.

## Stories and highlights

- Active stories: topsearch gives the user ID, then the reels query with `reel_ids_arr: [userId]`, `is_highlight: false`.
- Highlights: the tray query lists `highlight:<id>` IDs (50 per page), then the reels query with those IDs, `is_highlight: true`, in batches of 20.
- Items have their own `pk` and `<pk>_<ownerId>` IDs, but **`user` is empty on items**: take the owner from the reel.
- A highlight reel's `id` is `highlight:<id>`, and its `title` is the highlight's display name (`title`: **to confirm**, playbook steps 2–5).
- Reading reels doesn't mark stories as seen. Never call the "seen" mutations.

## ID formats

| Name | Example | Notes |
|---|---|---|
| `pk` | `3900000000000000071` | larger than 2^53: keep it a string |
| `id` | `3900000000000000071_31600000058` | `pk` + `_` + owner user ID |
| shortcode | `DdRKJpXjzGe` | the `pk` in base 64 over `A–Z a–z 0–9 - _`, most significant digit first. Strings longer than 28 characters carry a 28-character suffix to remove before decoding |
| user ID | `31600000058` | stable across username changes |
| reel ID | `31600000058` or `highlight:<id>` | a user's story reel ID equals the user ID |

## Headers

| Call | Headers igd sets |
|---|---|
| `POST /api/graphql` | `content-type`, `x-csrftoken`, `x-ig-app-id`, `x-fb-lsd` |
| CDN media bytes | none |

## Rate limiting and block signals

Limits appear to apply per endpoint: the REST endpoints below returned 429 while `/api/graphql` worked. igd paces every call (`extension/pacer.js`) and treats these as block signals, holding the whole queue instead of retrying:

- HTTP 429;
- a followed redirect (`response.redirected`), e.g. to `/accounts/login/` or `/challenge/…`;
- a JSON body without the expected data, carrying:
  - `message: "Please wait a few minutes before you try again."`: temporary;
  - `message: "feedback_required"` with `spam: true`: action blocked, temporary;
  - `message: "checkpoint_required"` with `checkpoint_url`: the user must clear a challenge;
  - `message: "login_required"` and/or `require_login: true`: the session is gone;
- a reply that isn't the expected shape.

Block replies often come with HTTP 400, so error bodies are read too. Only 429 has been seen live; confirm the others when they occur. Login and challenge holds wait for the user's Resume.

## Not usable

- `GET /api/v1/feed/user/<username or id>/…`: redirects to `/` (200 with HTML).
- `GET /api/v1/users/web_profile_info/`: 429, even on a fresh session.
- `GET /api/v1/media/<id>/info/`: 429 at times.
- `GET /graphql/query/?query_hash=…`: legacy, not used by Instagram's UI.

## Lessons

- Make the requests Instagram's own UI makes, and read query IDs at runtime.
- `200` doesn't mean it worked. Check status, `redirected` and the body before trusting it, and report "HTTP 429" or "unexpected HTML", never a parser error.
- Normalise every record to one shape keyed by `pk` before naming files.
- Separate essential calls from cosmetic ones; a failed cosmetic call must not abort a job.
- Stream: write each page as it arrives and keep a cursor, so a late failure doesn't lose the work.
- Pace and budget every call. On a block signal, hold everything instead of retrying.
- Prefer structure and links over Instagram class names, which rotate.
- Every user action needs a visible end state: success, failure or "nothing to do".
