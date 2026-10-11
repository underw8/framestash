// Content script on instagram.com: buttons, and a relay between the Framestash panel
// and the page-world script. Saving happens in the panel (manager.js), which
// holds the folder where pages can't reach it. naming.js is in scope.

// ---- relay: panel -> page world -> panel ----
// The field is "op", not "procedure": other extensions' page scripts may answer messages
// with a "procedure" field, and their reply would reach our port first.
// Replies are untrusted (any page script can answer); the panel validates records.

function pageCall(op, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "no answer from page script (reload the tab)" }), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && typeof e.data === "object" ? e.data : { error: "malformed reply" });
    };
    window.postMessage({ framestash: 1, op, ...args }, location.origin, [ch.port2]);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === "bridge") {
    pageCall(msg.op, msg.args || {}).then(sendResponse);
    return true;
  }
  if (msg.type === "ping") { sendResponse("framestash"); return false; }
  if (msg.type === "status") setStatus(msg.text, msg.kind);
  return false;
});

// ---- UI ----

// Stroke icons drawn for Framestash (24-unit grid, 2-unit stroke, round caps).
const ICONS = {
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  dismiss: '<path d="M7 12h10"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const panel = document.createElement("div");
panel.className = "framestash-panel";
panel.innerHTML = `
  <div class="framestash-row">
    <button class="framestash-go" type="button">${icon("download")}<span></span></button>
  </div>
  <div class="framestash-row">
    <button class="framestash-stories" type="button" title="Active stories and all highlights" hidden>${icon("download")}Stories</button>
    <button class="framestash-open framestash-icon" type="button" title="Open or close the Framestash panel" aria-label="Open or close the Framestash panel">${icon("panel")}</button>
  </div>
  <div class="framestash-card"><span class="framestash-wordmark">framestash<i></i></span><span class="framestash-status" aria-live="polite"></span>
    <button class="framestash-close" type="button" title="Dismiss" aria-label="Dismiss">${icon("dismiss")}</button></div>`;
const goButton = panel.querySelector(".framestash-go");
const goLabel = goButton.querySelector("span");
const storiesButton = panel.querySelector(".framestash-stories");
const statusLine = panel.querySelector(".framestash-status");

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

const panelHint = "Framestash couldn't open its panel. Click the Framestash icon in the toolbar, then try again.";

// Page scripts can call .click() on our buttons; only real user clicks may start
// downloads, or any script on instagram.com could fill the collection.
const onUserClick = (el, handler) => el.addEventListener("click", (e) => { if (e.isTrusted) handler(e); });

// After Framestash is updated or reloaded, scripts already in this tab are cut off from it,
// and chrome.runtime calls throw synchronously instead of rejecting.
const cutOff = () => !chrome.runtime || !chrome.runtime.id;
const reloadHint = () => setStatus("Framestash was updated: reload this page.", "warn");

async function send(job) {
  if (cutOff()) return reloadHint();
  setStatus("Sending to Framestash…");
  try {
    const r = await chrome.runtime.sendMessage({ type: "enqueue", job });
    if (!r || !r.queued) return setStatus((r && r.reason) || panelHint, "warn");
    if (r.opening) return setStatus("Opening the Framestash panel…");
    setStatus(r.position > 1 ? `Queued in Framestash (${r.position - 1} ahead)` : "Starting…");
  } catch {
    setStatus(panelHint, "warn");
  }
}

// A route already has the shape of a job ({kind, username | shortcode | id}).
onUserClick(goButton, () => {
  const route = routeFromPath(location.pathname);
  if (route) send(route);
});

onUserClick(storiesButton, () => {
  const route = routeFromPath(location.pathname);
  if (route && route.kind === "profile") send({ kind: "stories", username: route.username, withHighlights: true });
});

onUserClick(panel.querySelector(".framestash-close"), () => setStatus(""));

onUserClick(panel.querySelector(".framestash-open"), async () => {
  if (cutOff()) return reloadHint();
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: "openPanel" }); } catch { /* reported below */ }
  if (!r || !r.ok) setStatus("Click the Framestash icon in the toolbar to open the panel.", "warn");
});

// ---- per-item buttons on grid tiles and feed posts ----
// The shortcode comes from the post link inside each tile or article, so no
// Instagram class names or React internals are involved.

const POST_LINK = 'a[href*="/p/"], a[href*="/reel/"]';

const hasItemButton = (host) => host.querySelector(":scope > .framestash-item");

function addItemButton(host, shortcode) {
  if (getComputedStyle(host).position === "static") host.classList.add("framestash-host");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "framestash-item";
  button.title = "Save this post (Framestash)";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = icon("download");
  button.dataset.shortcode = shortcode;
  host.append(button);
}

const linkCode = (a) => shortcodeFromPath(new URL(a.href, location.origin).pathname);
const articleCode = (article) => [...article.querySelectorAll(POST_LINK)].map(linkCode).find(Boolean);

function scanItems() {
  // Grid tiles: the link itself wraps the thumbnail.
  for (const a of document.querySelectorAll(POST_LINK)) {
    if (hasItemButton(a)) continue;
    const shortcode = linkCode(a);
    if (shortcode && a.querySelector("img, video")) addItemButton(a, shortcode);
  }
}

// ---- native-style buttons: a download icon in each post's or reel's action icons ----
// Action bars are found by structure (3+ aligned ~24 px icon buttons; your own posts show only Like, Comment, Save), never by class
// names or English labels; actionBarSpot picks the row or column and the slot.

function iconButtons(root) {
  const found = new Set();
  for (const svg of root.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (Math.abs(r.width - 24) > 4 || Math.abs(r.height - 24) > 4) continue;
    const b = svg.closest('button, [role="button"]');
    if (!b || !root.contains(b) || b.classList.contains("framestash-act")) continue;
    // Action icons are small; a whole grid tile can also be a button holding a 24 px badge.
    const br = b.getBoundingClientRect();
    if (br.width <= 64 && br.height <= 64) found.add(b);
  }
  return [...found];
}

// The bar's own post link; "" when none or ambiguous (a reels feed), resolved from the URL on click.
function barShortcode(bar, host) {
  for (let e = bar; e; e = e === host ? null : e.parentElement) {
    const codes = new Set([...e.querySelectorAll(POST_LINK)].map(linkCode).filter(Boolean));
    if (codes.size) return codes.size === 1 ? [...codes][0] : "";
  }
  return "";
}

function scanActionBars(host, shortcode) {
  const buttons = iconButtons(host);
  const thin = (e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) <= 96; };
  const bars = new Map(); // closest ancestor holding 3+ icon buttons -> its buttons
  for (const b of buttons) {
    for (let e = b.parentElement; e && host.contains(e); e = e.parentElement) {
      let inside = buttons.filter((x) => e.contains(x));
      if (inside.length < 3) continue;
      // Grow to the whole strip: post pages split the row into Like…Share and a separate bookmark group.
      for (let p = e.parentElement; p && host.contains(p) && thin(p); p = p.parentElement) {
        const more = buttons.filter((x) => p.contains(x));
        if (more.length > inside.length) { e = p; inside = more; }
      }
      bars.set(e, inside);
      break;
    }
  }
  // Inner bars first, so an outer group that holds the same row is then skipped.
  for (const [bar, own] of [...bars].sort((a, b) => a[1].length - b[1].length)) {
    if (bar.querySelector(".framestash-act")) continue;
    if (!thin(bar)) continue; // a grid row whose tiles carry badges is not an action strip
    const spot = actionBarSpot(own.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    if (!spot) continue;
    // Insert after the icon's own wrapper (the highest one holding no other icon), so the
    // new icon becomes a sibling in the row or column.
    let slot = own[spot.after];
    while (slot.parentElement !== bar && own.filter((x) => slot.parentElement.contains(x)).length === 1) slot = slot.parentElement;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "framestash-act";
    button.title = "Save this post (Framestash)";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = icon("download");
    button.dataset.shortcode = shortcode || barShortcode(bar, host);
    // A grid row (narrow post pages) would wrap a new item onto its own line, so the
    // icon joins the bookmark's cell instead, laid out as a row.
    if (getComputedStyle(bar).display.endsWith("grid")) {
      slot.classList.add("framestash-actcell");
      slot.append(button);
    } else slot.insertAdjacentElement("afterend", button);
  }
}

function scanNative() {
  for (const article of document.querySelectorAll("article")) {
    const code = articleCode(article);
    if (code && !article.querySelector(".framestash-act")) scanActionBars(article, code);
  }
  // A post opened from a grid is a dialog over the page; only the dialog holds its action row.
  const route = routeFromPath(location.pathname);
  const host = document.querySelector('[role="dialog"]') || document.querySelector("main");
  // The reels feed starts at /reels/ and only gets /reels/<code>/ once the user scrolls.
  const reelsFeed = /^\/reels\/?$/.test(location.pathname);
  if ((reelsFeed || (route && route.kind === "post")) && host && !host.querySelector("article")) scanActionBars(host, "");
}

// Capture phase, so the tile's link never navigates and Instagram's handlers never see the click.
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element && e.target.closest(".framestash-item, .framestash-act");
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.isTrusted) return;
  const route = routeFromPath(location.pathname);
  const shortcode = button.dataset.shortcode || (route && route.kind === "post" ? route.shortcode : "");
  if (!shortcode) {
    return setStatus(/^\/reels\/?$/.test(location.pathname)
      ? "Instagram hasn't put this reel's link in the address yet. Scroll to the next reel and back, then try again."
      : "Framestash couldn't tell which post this is. Open the post and try again.", "warn");
  }
  send({ kind: "post", shortcode });
}, true);

// Instagram's floating Messages button opens into a 360 px panel in the same corner.
// Find whichever is there (the fixed element under a point near the corner) and sit
// above the button or to the left of the panel. Instagram's class names are never used.
function placePanel() {
  // right/bottom of fixed elements are measured from the viewport minus scrollbars.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const target = document.elementsFromPoint(vw - 60, vh - 60).find((e) => !panel.contains(e));
  let fixed = target;
  while (fixed && fixed !== document.body && getComputedStyle(fixed).position !== "fixed") fixed = fixed.parentElement;
  const r = fixed && fixed !== document.body ? fixed.getBoundingClientRect() : null;
  if (!r || r.width > vw / 2) {
    panel.style.right = panel.style.bottom = "";
  } else if (r.height > 120) {
    panel.style.right = `${Math.round(vw - r.left + 12)}px`; // Messages panel open: go left of it
    panel.style.bottom = `${Math.round(vh - r.bottom)}px`;
  } else {
    panel.style.right = `${Math.round(vw - r.right)}px`; // above the Messages button
    panel.style.bottom = `${Math.round(vh - r.top + 12)}px`;
  }
}

// One 500 ms poll for URL changes, new tiles/posts and placement; simpler than
// history hooks plus a MutationObserver. Ceiling: a selector pass per tick on very long feeds.
// The panel stays on every page so jobs started from tiles can report; the main
// button only shows on profile, post and story pages.
let shownPath = null;
function updateForPage() {
  if (shownPath === location.pathname) return;
  shownPath = location.pathname;
  const route = routeFromPath(location.pathname);
  setStatus("");
  goButton.hidden = !route;
  storiesButton.hidden = !route || route.kind !== "profile";
  if (route) {
    goLabel.textContent = {
      profile: `Download @${route.username}`,
      post: "Save post",
      stories: `Save @${route.username}'s stories`,
      highlight: "Save highlight",
    }[route.kind];
  }
}

// Each step is isolated: a failure in one (e.g. an unexpected page structure while
// scanning) must not stop the page's buttons from updating.
setInterval(() => {
  for (const step of [() => { if (!panel.isConnected) document.body.append(panel); }, updateForPage, placePanel, scanItems, scanNative]) {
    try { step(); } catch (e) { console.warn("[framestash]", e); }
  }
}, 500);
