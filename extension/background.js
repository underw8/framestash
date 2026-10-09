// Routes jobs from Instagram tabs to the igd panel, opening the panel first.
// sidePanel.open needs the user's click, so it is called before anything is awaited.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Jobs that arrived while the panel was still loading; it collects them on start.
// ponytail: kept in worker memory; the panel loads in about a second.
const pending = [];

// Windows with an open igd panel: each open panel holds a port named "panel:<windowId>",
// so the in-page panel button can close it again without awaiting anything first.
const openPanels = new Set();
chrome.runtime.onConnect.addListener((port) => {
  const m = /^panel:(\d+)$/.exec(port.name);
  if (!m || port.sender.tab) return;
  const windowId = Number(m[1]);
  openPanels.add(windowId);
  port.onDisconnect.addListener(() => openPanels.delete(windowId));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "openPanel" && sender.tab) {
    if (openPanels.has(sender.tab.windowId)) {
      chrome.runtime.sendMessage({ type: "closePanel", windowId: sender.tab.windowId }).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }
    chrome.sidePanel.open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, reason: e.message }));
    return true;
  }
  if (msg.type === "enqueue" && sender.tab) {
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    const delivery = { type: "job", job: msg.job, tabId: sender.tab.id, url: sender.url || "" };
    chrome.runtime.sendMessage(delivery)
      .then((r) => sendResponse(r || { queued: false, reason: "igd panel did not answer" }))
      .catch(() => {
        pending.push(delivery);
        sendResponse({ queued: true, opening: true });
      });
    return true;
  }
  if (msg.type === "managerReady" && !sender.tab) {
    sendResponse(pending.splice(0));
    return false;
  }
  return false;
});
