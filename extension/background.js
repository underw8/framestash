// Opens the igd panel and answers for it when it isn't open.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const managerOpen = async () =>
  (await chrome.runtime.getContexts({})).some((c) => (c.documentUrl || "").endsWith("/manager.html"));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "openPanel" && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id })
      .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, reason: e.message }));
    return true;
  }
  if (msg.type === "enqueue") {
    // The panel answers jobs itself; only answer when it isn't there.
    managerOpen().then((open) => {
      if (!open) sendResponse({ queued: false, reason: "Open the igd panel (toolbar icon), then try again." });
    });
    return true;
  }
  return false;
});
