# Investigation playbook

Console probes for re-checking Instagram's API and a collection on disk. Run the snippets in the DevTools console of a logged-in `https://www.instagram.com/` tab.

Ground rules:

- **Read-only.** None of these change Instagram data or files on disk. The fetches are the same reads the page makes itself.
- **Never print tokens.** Print whether a token is present or how long it is, never its value. `fb_dtsg`, `lsd`, the claim and the CSRF token are session secrets.
- **Go slowly.** Every probe counts against Instagram's per-endpoint limits. Wait between runs.

## 1. Are the session values there?

```js
(() => {
  const R = window.require, has = (m) => { try { return !!R(m); } catch { return false; } };
  return {
    hasRequire: typeof R === "function",
    dtsg: typeof R === "function" && has("DTSGInitialData"),
    lsd:  typeof R === "function" && has("LSD"),
    appId: typeof R === "function" && has("PolarisConfig"),
    claim: !!sessionStorage.getItem("www-claim-v2"),
    csrfCookie: /(?:^|; )csrftoken=/.test(document.cookie),
  };
})()
```

## 2. Endpoint health, without being fooled by redirects

`status === 200` doesn't mean the request worked. Check for redirects and the content type, and look at the first bytes of the body.

```js
async function probe(url, init = {}) {
  const r = await fetch(url, { credentials: "include", ...init });
  const body = await r.text();
  let json = null; try { json = JSON.parse(body); } catch {}
  return {
    status: r.status,
    redirected: r.redirected,
    finalPath: new URL(r.url).pathname,
    isJson: !!json,
    looksLikeHtml: body.trimStart().startsWith("<"),
    topKeys: json ? Object.keys(json).slice(0, 8) : null,
  };
}
const igHeaders = {
  "x-ig-app-id": window.require("PolarisConfig").getIGAppID(),
  "x-ig-www-claim": sessionStorage.getItem("www-claim-v2") || "0",
};
({
  profileInfo: await probe("/api/v1/users/web_profile_info/?username=instagram", { headers: igHeaders }),
  v1Feed:      await probe("/api/v1/feed/user/instagram/username/?count=12",      { headers: igHeaders }),
})
```

| Result | Meaning |
|---|---|
| `status 429` | rate-limited on this endpoint; wait, don't retry in a loop |
| `redirected: true`, `finalPath: "/"`, HTML | the endpoint has been removed or blocked for this kind of request |
| `isJson: true` but missing the expected keys | the response shape changed |
| JSON with the expected keys | the endpoint is healthy |

The same `probe` works for any GET, e.g. a CDN URL taken from a record.

## 3. What does Instagram's own UI call right now?

Install a recorder that logs Instagram's GraphQL requests, with secrets replaced by their length. Then use the UI (switch profile tabs, scroll, open a story) and read `window.__cap`.

```js
window.__cap = [];
const SECRET = /^(fb_dtsg|lsd|jazoest|__[a-z_]+|dpr)$/i;
function record(url, body) {
  if (!String(url).includes("/graphql")) return;
  const p = new URLSearchParams(typeof body === "string" ? body : "");
  const fields = {};
  for (const [k, v] of p) fields[k] = SECRET.test(k) ? `<${v.length} chars>` : v.slice(0, 300);
  window.__cap.push({ url: String(url), name: fields.fb_api_req_friendly_name, doc_id: fields.doc_id, variables: fields.variables });
}
const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return xo.apply(this, arguments); };
XMLHttpRequest.prototype.send = function (b) { record(this.__u, b); return xs.apply(this, arguments); };
const fo = window.fetch;
window.fetch = function (u, o = {}) { record(u?.url || u, o.body); return fo.apply(this, arguments); };
"recording";
```

Queries the page has already cached won't be sent again. Move around inside the app to trigger new ones, but don't reload the page, because reloading removes the recorder.

## 4. Read query IDs and variables from Instagram's module loader

Each Relay operation has a module named `<OperationName>_instagramRelayOperation` that holds its current `doc_id`. The query's own module (`<OperationName>.graphql`) lists its arguments and provided variables.

```js
function describeOperation(name) {
  const R = window.require, out = { name };
  try { out.doc_id = R(`${name}_instagramRelayOperation`); } catch (e) { out.doc_id = "not found"; }
  try {
    const q = R(`${name}.graphql`), p = q.params || {};
    out.args = (q.fragment?.argumentDefinitions || []).map(a => a.name);
    out.provided = Object.keys(p.providedVariables || q.providedVariables || {});
    out.rootFields = p.metadata?.root_field_name;
  } catch (e) { out.graphql = "not found"; }
  return out;
}
describeOperation("PolarisProfilePostsQuery");
```

To find operation names you don't know yet, scan the module registry if it is exposed. Skip this if `__debug` doesn't exist.

```js
Object.keys(window.require("__debug")?.getModules?.() || {})
  .filter(k => /RelayOperation$/.test(k) && /Profile|Story|Reel|Highlight/.test(k))
  .slice(0, 50);
```

## 5. Call a GraphQL query the way the page does

`fb_dtsg` is required. Without it the server answers with HTML.

```js
async function igGraphQL(operation, variables) {
  const R = window.require, lsd = R("LSD").token;
  const r = await fetch("/api/graphql", {
    method: "POST", credentials: "include",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrftoken": (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || "",
      "x-ig-app-id": R("PolarisConfig").getIGAppID(),
      "x-fb-lsd": lsd,
    },
    body: new URLSearchParams({
      doc_id: R(`${operation}_instagramRelayOperation`),
      variables: JSON.stringify(variables),
      lsd, fb_dtsg: R("DTSGInitialData").token,
    }),
  });
  return r.json();
}
const page = await igGraphQL("PolarisProfilePostsQuery", {
  username: "instagram", first: 12, after: null, before: null, last: null,
  data: { count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true,
          latest_besties_reel_media: true, latest_reel_media: true },
  __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
  __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
});
const c = page.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
({ edges: c?.edges.length, next: c?.page_info, firstNode: c?.edges[0] && Object.keys(c.edges[0].node).slice(0, 20) });
```

The provided-variable names change; take them from step 4. The other operations in [instagram-api.md](instagram-api.md) are called the same way.

## 6. Check what a run actually wrote

Pick an account folder (running a picker from the console counts as a user gesture), then summarise it.

```js
async function folderSummary(dir) {
  const files = [];
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind !== "file") continue;
    const f = await entry.getFile();
    files.push({ name, bytes: f.size });
  }
  return {
    count: files.length,
    empty: files.filter(f => f.bytes === 0).map(f => f.name),
    errorFiles: files.filter(f => f.name.endsWith(".error.txt")).length,
    types: [...new Set(files.map(f => f.name.split(".").pop()))],
    totalMB: +(files.reduce((a, f) => a + f.bytes, 0) / 1048576).toFixed(1),
  };
}
await folderSummary(await showDirectoryPicker({ mode: "read" }));
```

## 7. Audit a collection outside Framestash

The panel's **Check collection** is the normal report. This probe does a quick pass without Framestash: pick the **root** folder, the one that contains the account folders. It uses the same name pattern and pk key as [collection-format.md](collection-format.md).

```js
const root = await showDirectoryPicker({ mode: "read" });
const NAME = /^(.+)_(\d{9,10})_(\d{12,})(?:_(\d+))?\.([A-Za-z0-9]+)$/;
const index = new Map(), odd = [], zero = [], errors = [];
for await (const [acct, dir] of root.entries()) {
  if (dir.kind !== "directory" || acct.startsWith(".")) continue;
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind !== "file" || name === ".igd.json") continue;
    if (name.endsWith(".error.txt")) { errors.push(`${acct}/${name}`); continue; }
    const m = name.match(NAME);
    if (!m) { odd.push(`${acct}/${name}`); continue; }
    if ((await entry.getFile()).size === 0) zero.push(`${acct}/${name}`);
    index.set(m[3], [...(index.get(m[3]) || []), `${acct}/${name}`]);
  }
}
({
  files: [...index.values()].flat().length,
  samePkManyNames: [...index.entries()].filter(([, v]) => v.length > 1).slice(0, 20),
  unexpectedNames: odd.slice(0, 50),
  emptyFiles: zero.slice(0, 50),
  errorFiles: errors.length,
});
```

- `samePkManyNames`: one media item saved under several names (different `taken_at` or `id` variant).
- `unexpectedNames`: names Framestash doesn't recognise, so they never count as present. If there are many, check them against [collection-format.md](collection-format.md) before writing to the collection.
- `emptyFiles`: failed downloads. Framestash treats them as missing and downloads them again.
