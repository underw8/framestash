// Runs in Instagram's page world: the only place fb_dtsg, lsd and the current
// query IDs are readable. Answers requests from content.js on a private port.

(() => {
  // Relay "provided variables" (feature flags) the query expects; sent as false, as
  // Instagram does for these queries. Read from the query's definition so new flags are covered.
  function providedFalse(R, operation) {
    try {
      const q = R(`${operation}.graphql`);
      return Object.fromEntries(Object.keys((q.params || q).providedVariables || {}).map((k) => [k, false]));
    } catch {
      return {}; // definition not loaded on this page: send none rather than fail
    }
  }

  // Calls one of Instagram's own persisted GraphQL queries the way its web app does.
  // Query IDs and tokens are read at call time, never hardcoded.
  let requests = 0; // per bridge message, so the panel's budget counts real requests
  // The panel's breaker holds the queue on this text; a TypeError would only fail one job.
  const SHAPE = { error: "unexpected response shape (Instagram may have changed the query)" };
  const hasNodes = (edges) => Array.isArray(edges) && edges.every((e) => e && e.node);

  async function graphql(operation, variables, rootField) {
    const R = window.require;
    if (typeof R !== "function") throw new Error("Instagram's module loader is not available on this page");
    const lsd = R("LSD").token;
    requests++;
    const res = await fetch("/api/graphql", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrftoken": (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || "",
        "x-ig-app-id": R("PolarisConfig").getIGAppID(),
        "x-fb-lsd": lsd,
      },
      body: new URLSearchParams({
        doc_id: R(`${operation}_instagramRelayOperation`),
        variables: JSON.stringify({ ...providedFalse(R, operation), ...variables }),
        lsd,
        fb_dtsg: R("DTSGInitialData").token,
      }),
    });
    if (res.redirected) return { error: `redirected to ${new URL(res.url).pathname}` };
    // Block replies usually come with HTTP 400, so error bodies are read too.
    const status = res.ok ? undefined : res.status;
    const httpError = { error: `HTTP ${res.status}`, status };
    const text = (await res.text()).replace(/^for \(;;\);/, "");
    let json;
    try { json = JSON.parse(text); } catch { return res.ok ? { error: "response is not JSON (Instagram may have changed the query)" } : httpError; }
    if (!json || typeof json !== "object") return res.ok ? SHAPE : httpError;
    // Some queries return usable data next to field-level errors, so data wins.
    const data = res.ok && json.data && json.data[rootField];
    if (data) return { data };
    // Instagram's block replies (docs/03, "Block signals"); the panel's breaker tells them apart.
    if (json.message || json.require_login || json.checkpoint_url) {
      return { error: String(json.message || "login required"), status, block: true, login: !!json.require_login, checkpoint: !!json.checkpoint_url, spam: !!json.spam };
    }
    if (!res.ok) return httpError;
    if (json.errors && json.errors.length) return { error: json.errors[0].message || "GraphQL error" };
    return SHAPE;
  }

  async function profilePosts(username, after) {
    const r = await graphql("PolarisProfilePostsQuery", {
      username, after: after || null, before: null, first: 12, last: null,
      data: {
        count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true,
        latest_besties_reel_media: true, latest_reel_media: true,
      },
    }, "xdt_api__v1__feed__user_timeline_graphql_connection");
    if (r.error) return r;
    if (!hasNodes(r.data.edges) || !r.data.page_info) return SHAPE;
    return {
      nodes: r.data.edges.map((e) => e.node),
      next: r.data.page_info.has_next_page ? r.data.page_info.end_cursor : null,
    };
  }

  async function post(shortcode) {
    const r = await graphql("PolarisPostRootQuery", { shortcode }, "xdt_api__v1__media__shortcode__web_info");
    if (r.error) return r;
    if (!Array.isArray(r.data.items)) return SHAPE;
    return r.data.items.length ? { nodes: r.data.items } : { error: "post not found" };
  }

  // Works for any account, including ones with no visible posts.
  async function userId(username) {
    const r = await graphql("PolarisAPITopsearchQuery", {
      data: {
        context: "blended", include_reel: "true", query: username, rank_token: "",
        search_session_id: "", search_surface: "web_top_search",
      },
      hasQuery: true,
    }, "xdt_api__v1__fbsearch__topsearch_connection");
    if (r.error) return r;
    const users = r.data.users;
    if (!Array.isArray(users) || !users.every((u) => u && u.user && typeof u.user.username === "string")) return SHAPE;
    const hit = users.find((u) => u.user.username.toLowerCase() === username.toLowerCase());
    return hit ? { pk: String(hit.user.pk) } : { error: `account @${username} not found` };
  }

  // Reads reels without marking anything as seen (that is a separate mutation we never call).
  async function reels(ids, isHighlight) {
    const nodes = [];
    for (let i = 0; i < ids.length; i += 20) {
      const r = await graphql("PolarisStoriesV3ReelPageStandaloneQuery", {
        reel_ids_arr: ids.slice(i, i + 20), is_highlight: isHighlight, media_id: null,
      }, "xdt_api__v1__feed__reels_media");
      if (r.error) return r;
      if (!Array.isArray(r.data.reels_media)) return SHAPE;
      // Story items carry no owner of their own; the reel does.
      for (const reel of r.data.reels_media) {
        const highlight = isHighlight && reel ? { id: String(reel.id).replace(/^highlight:/, ""), title: reel.title } : undefined;
        for (const item of (reel && reel.items) || []) nodes.push({ ...item, user: reel.user, ...(highlight && { highlight }) });
      }
    }
    return { nodes };
  }

  async function highlightIds(pk) {
    const ids = [];
    let after = null;
    do {
      const r = await graphql("PolarisProfileStoryHighlightsTrayContentQuery", {
        user_id: pk, first: 50, after, before: null, last: null, max_highlights_to_fetch_on_pagination: 50,
      }, "highlights");
      if (r.error) return r;
      if (!hasNodes(r.data.edges)) return SHAPE;
      for (const e of r.data.edges) ids.push(e.node.id);
      after = r.data.page_info && r.data.page_info.has_next_page ? r.data.page_info.end_cursor : null;
    } while (after);
    return { ids };
  }

  async function stories(username, withHighlights) {
    const user = await userId(username);
    if (user.error) return user;
    const active = await reels([user.pk], false);
    if (active.error || !withHighlights) return active;
    const hl = await highlightIds(user.pk);
    if (hl.error) return hl;
    const saved = hl.ids.length ? await reels(hl.ids, true) : { nodes: [] };
    if (saved.error) return saved;
    return { nodes: [...active.nodes, ...saved.nodes] };
  }

  const OPS = {
    profilePosts: (d) => profilePosts(d.username, d.after),
    post: (d) => post(d.shortcode),
    stories: (d) => stories(d.username, !!d.withHighlights),
    userId: (d) => userId(d.username),
    highlight: (d) => reels([`highlight:${d.id}`], true),
  };

  window.addEventListener("message", async (e) => {
    const port = e.ports && e.ports[0];
    if (e.origin !== location.origin || !port || !e.data || e.data.igd !== 1) return;
    requests = 0;
    try {
      if (!OPS[e.data.op]) throw new Error(`unknown op ${e.data.op}`);
      port.postMessage({ ...(await OPS[e.data.op](e.data)), requests });
    } catch (err) {
      port.postMessage({ error: String((err && err.message) || err), requests });
    }
  });
})();
