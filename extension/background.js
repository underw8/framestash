// Routes jobs from Instagram tabs to the igd panel, opening the panel first.
// sidePanel.open needs the user's click, so it is called before anything is awaited.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Jobs that arrived while the panel was still loading; it collects them on start.
// ponytail: kept in worker memory; the panel loads in about a second.
const pending = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "openPanel" && sender.tab) {
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
