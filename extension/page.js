// Runs in Instagram's page world: the only place fb_dtsg, lsd and the current
// query IDs are readable. Answers requests from content.js on a private port.

(() => {
  const OPERATION = "PolarisProfilePostsQuery";

  async function profilePosts(username, after) {
    const R = window.require;
    if (typeof R !== "function") throw new Error("Instagram's module loader is not available on this page");
    const lsd = R("LSD").token;
    const variables = {
      username, after: after || null, before: null, first: 12, last: null,
      data: {
        count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true,
        latest_besties_reel_media: true, latest_reel_media: true,
      },
      __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
      __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
      __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    };
    const res = await fetch("/api/graphql", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-csrftoken": (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || "",
        "x-ig-app-id": sessionStorage.getItem("__ig_app_id") || R("PolarisConfig").getIGAppID(),
        "x-fb-lsd": lsd,
      },
      body: new URLSearchParams({
        doc_id: R(`${OPERATION}_instagramRelayOperation`),
        variables: JSON.stringify(variables),
        lsd,
        fb_dtsg: R("DTSGInitialData").token,
      }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}`, status: res.status };
    if (res.redirected) return { error: `redirected to ${new URL(res.url).pathname}` };
    const text = (await res.text()).replace(/^for \(;;\);/, "");
    let json;
    try { json = JSON.parse(text); } catch { return { error: "response is not JSON (Instagram may have changed the query)" }; }
    if (json.errors && json.errors.length) return { error: json.errors[0].message || "GraphQL error" };
    const conn = json.data && json.data.xdt_api__v1__feed__user_timeline_graphql_connection;
    if (!conn) return { error: "unexpected response shape (Instagram may have changed the query)" };
    return {
      nodes: conn.edges.map((e) => e.node),
      next: conn.page_info.has_next_page ? conn.page_info.end_cursor : null,
    };
  }

  window.addEventListener("message", async (e) => {
    const port = e.ports && e.ports[0];
    if (e.origin !== location.origin || !port || !e.data || e.data.igd !== 1) return;
    try {
      if (e.data.op !== "profilePosts") throw new Error(`unknown op ${e.data.op}`);
      port.postMessage(await profilePosts(e.data.username, e.data.after));
    } catch (err) {
      port.postMessage({ error: String((err && err.message) || err) });
    }
  });
})();
