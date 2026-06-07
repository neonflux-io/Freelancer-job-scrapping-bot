"use strict";

(function initBackgroundRouter() {
  const store = self.FB.store;
  const handlers = self.FB.handlers;

  chrome.runtime.onInstalled.addListener(async () => {
    await store.ensureDefaults();
    await store.pruneHistory();
    await store.pruneAppliedProjects();
    chrome.alarms.create("queueCheck", { periodInMinutes: 2 });
  });

  chrome.runtime.onStartup.addListener(async () => {
    await store.ensureDefaults();
    await store.pruneHistory();
    await store.pruneAppliedProjects();
    chrome.alarms.create("queueCheck", { periodInMinutes: 2 });
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "queueCheck") self.FB.tryProcessQueue();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) {
      sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
      return false;
    }
    Promise.resolve()
      .then(() => handler(message || {}, sender))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
