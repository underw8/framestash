// Content script on instagram.com: buttons, and a relay between the igd panel
// and the page-world script. Saving happens in the panel (manager.js), which
// holds the folder where pages can't reach it. naming.js is in scope.

// ---- relay: panel -> page world -> panel ----
// The field is "op", not "procedure": the old extension's page script answers any
// message with a "procedure" field, and its reply would reach our port first.
// Replies are untrusted (any page script can answer); the panel validates records.

function pageCall(op, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "no answer from page script (reload the tab)" }), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && typeof e.data === "object" ? e.data : { error: "malformed reply" });
    };
    window.postMessage({ igd: 1, op, ...args }, location.origin, [ch.port2]);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === "bridge") {
    pageCall(msg.op, msg.args || {}).then(sendResponse);
    return true;
  }
  if (msg.type === "ping") { sendResponse("igd"); return false; }
  if (msg.type === "status") setStatus(msg.text, msg.kind);
  return false;
});

// ---- UI ----

// Stroke icons drawn for igd (24-unit grid, 2-unit stroke, round caps).
const ICONS = {
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  check: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const panel = document.createElement("div");
panel.className = "igd-panel";
panel.innerHTML = `
  <div class="igd-row">
    <button class="igd-go" type="button">${icon("download")}<span></span></button>
    <button class="igd-stories" type="button" title="Active stories and all highlights" hidden>${icon("download")}Stories</button>
    <button class="igd-check igd-icon" type="button" title="Check collection (read-only)" aria-label="Check collection">${icon("check")}</button>
    <button class="igd-open igd-icon" type="button" title="Open the igd panel" aria-label="Open the igd panel">${icon("panel")}</button>
  </div>
  <div class="igd-card"><span class="igd-wordmark">igd<i></i></span><span class="igd-status" aria-live="polite"></span></div>`;
const goButton = panel.querySelector(".igd-go");
const goLabel = goButton.querySelector("span");
const storiesButton = panel.querySelector(".igd-stories");
const statusLine = panel.querySelector(".igd-status");

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

const panelHint = "igd couldn't open its panel. Click the igd icon in the toolbar, then try again.";

// Page scripts can call .click() on our buttons; only real user clicks may start
// downloads, or any script on instagram.com could fill the collection.
const onUserClick = (el, handler) => el.addEventListener("click", (e) => { if (e.isTrusted) handler(e); });

async function send(job) {
  // After igd is updated, scripts already in this tab are cut off from it.
  if (!chrome.runtime || !chrome.runtime.id) return setStatus("igd was updated: reload this page.", "warn");
  setStatus("Sending to igd…");
  try {
    const r = await chrome.runtime.sendMessage({ type: "enqueue", job });
    if (!r || !r.queued) return setStatus((r && r.reason) || panelHint, "warn");
    if (r.opening) return setStatus("Opening the igd panel…");
    setStatus(r.position > 1 ? `Queued in igd (${r.position - 1} ahead)` : "Starting…");
  } catch {
    setStatus(panelHint, "warn");
  }
}

function jobForRoute(route) {
  if (route.kind === "profile") return { kind: "profile", username: route.username };
  if (route.kind === "post") return { kind: "post", shortcode: route.shortcode };
  if (route.kind === "stories") return { kind: "stories", username: route.username, withHighlights: false };
  return { kind: "highlight", id: route.id };
}

onUserClick(goButton, () => {
  const route = routeFromPath(location.pathname);
  if (route) send(jobForRoute(route));
});

onUserClick(storiesButton, () => {
  const route = routeFromPath(location.pathname);
  if (route && route.kind === "profile") send({ kind: "stories", username: route.username, withHighlights: true });
});

onUserClick(panel.querySelector(".igd-check"), () => send({ kind: "check" }));

onUserClick(panel.querySelector(".igd-open"), async () => {
  const r = await chrome.runtime.sendMessage({ type: "openPanel" }).catch(() => null);
  if (!r || !r.ok) setStatus("Click the igd icon in the toolbar to open the panel.", "warn");
});

// ---- per-item buttons on grid tiles and feed posts ----
// The shortcode comes from the post link inside each tile or article, so no
// Instagram class names or React internals are involved.

const POST_LINK = 'a[href*="/p/"], a[href*="/reel/"]';

function addItemButton(host, shortcode, top) {
  if (host.querySelector(":scope > .igd-item")) return;
  if (getComputedStyle(host).position === "static") host.classList.add("igd-host");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "igd-item";
  button.title = "Save this post (igd)";
  button.innerHTML = icon("download");
  button.dataset.shortcode = shortcode;
  if (top) button.style.top = `${top}px`;
  host.append(button);
}

function scanItems() {
  // Grid tiles: the link itself wraps the thumbnail.
  for (const a of document.querySelectorAll(POST_LINK)) {
    const shortcode = shortcodeFromPath(new URL(a.href, location.origin).pathname);
    if (shortcode && a.querySelector("img, video")) addItemButton(a, shortcode);
  }
  // Feed posts: an <article> whose links include the post's permalink.
  for (const article of document.querySelectorAll("article")) {
    const link = [...article.querySelectorAll(POST_LINK)]
      .map((a) => shortcodeFromPath(new URL(a.href, location.origin).pathname))
      .find(Boolean);
    if (!link) continue;
    // Sit on the media's top-left corner, below the post header.
    const media = [...article.querySelectorAll("img, video")].find((m) => m.getBoundingClientRect().width >= 200);
    const top = media ? Math.round(media.getBoundingClientRect().top - article.getBoundingClientRect().top) + 8 : 64;
    addItemButton(article, link, top);
  }
}

// Capture phase, so the tile's link never navigates and Instagram's handlers never see the click.
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element && e.target.closest(".igd-item");
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.isTrusted) send({ kind: "post", shortcode: button.dataset.shortcode });
}, true);

let scanTimer = 0;
new MutationObserver((records) => {
  // Ignore our own insertions so adding buttons doesn't retrigger the scan.
  if (records.every((r) => [...r.addedNodes].every((n) => n.classList && n.classList.contains("igd-item")))) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanItems, 300);
}).observe(document.body, { childList: true, subtree: true });
scanItems();

// Instagram's floating Messages button opens into a 360 px panel in the same corner.
// Find whichever is there (the fixed element under a point near the corner) and sit
// above the button or to the left of the panel. Instagram's class names are never used.
function placePanel() {
  const target = document.elementsFromPoint(innerWidth - 60, innerHeight - 60).find((e) => !panel.contains(e));
  let fixed = target;
  while (fixed && fixed !== document.body && getComputedStyle(fixed).position !== "fixed") fixed = fixed.parentElement;
  const r = fixed && fixed !== document.body ? fixed.getBoundingClientRect() : null;
  if (!r || r.width > innerWidth / 2) {
    panel.style.right = panel.style.bottom = "";
  } else if (r.height > 120) {
    panel.style.right = `${Math.round(innerWidth - r.left + 12)}px`; // Messages panel open: go left of it
    panel.style.bottom = `${Math.round(innerHeight - r.bottom)}px`;
  } else {
    panel.style.right = `${Math.round(innerWidth - r.right)}px`; // above the Messages button
    panel.style.bottom = `${Math.round(innerHeight - r.top + 12)}px`;
  }
}

// ponytail: polling the URL is simpler than hooking history; 500 ms is plenty for a button.
// The panel stays on every page so jobs started from tiles can report; the main
// button only shows on profile, post and story pages.
let shownPath = null;
setInterval(() => {
  if (!panel.isConnected) document.body.append(panel);
  placePanel();
  if (shownPath === location.pathname) return;
  shownPath = location.pathname;
  const route = routeFromPath(location.pathname);
  setStatus("");
  goButton.hidden = !route;
  storiesButton.hidden = !route || route.kind !== "profile";
  const labels = {
    profile: () => `Download @${route.username}`,
    post: () => "Save post",
    stories: () => `Save @${route.username}'s stories`,
    highlight: () => "Save highlight",
  };
  if (route) goLabel.textContent = labels[route.kind]();
}, 500);
