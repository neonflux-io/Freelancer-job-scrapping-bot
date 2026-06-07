"use strict";

(function initBackgroundHandlers() {
  const utils = self.FB.utils;
  const store = self.FB.store;
  const services = self.FB.services;

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function log(event, details = {}) {
    await store.appendLog({
      ts: Date.now(),
      event: String(event),
      details: utils.isObject(details) ? details : { value: String(details) }
    });
  }

  function buildJobText(job) {
    const lines = ["New Freelancer job.", `Title: ${job.title || "Untitled"}`];
    if (job.budgetText) lines.push(`Budget: ${job.budgetText}`);
    if (job.skillsText) lines.push(`Skills: ${job.skillsText}`);
    if (job.postedText) lines.push(`Posted: ${job.postedText}`);
    if (job.link)       lines.push(`Link: ${job.link}`);
    return lines.join("\n");
  }

  function buildBidResultText(header, job, reason) {
    const lines = [header, `Title: ${job.title || "Untitled"}`];
    if (job.budgetText) lines.push(`Budget: ${job.budgetText}`);
    if (job.skillsText) lines.push(`Skills: ${job.skillsText}`);
    if (job.postedText) lines.push(`Posted: ${job.postedText}`);
    if (job.clientCountry) lines.push(`Client Country: ${job.clientCountry}`);
    if (job.link)       lines.push(`Link: ${job.link}`);
    if (reason)         lines.push(`Reason: ${reason}`);
    return lines.join("\n");
  }

  function passesFilters(job, settings) {
    if (!job.id || !job.link) return false;
    if (utils.isBlockedCurrency(job.budgetText, settings.blockedCurrencies)) return false;
    return true;
  }

  let queueRunning = false;

  async function tryProcessQueue() {
    if (queueRunning) {
      await log("tryProcessQueue.skip", { reason: "already running" });
      return;
    }
    queueRunning = true;

    try {
      while (true) {
        const settings = await store.getSettings();
        if (!settings.monitorEnabled || settings.mode !== "auto_bid") {
          await log("tryProcessQueue.stopped", { monitorEnabled: settings.monitorEnabled, mode: settings.mode });
          break;
        }

        const queue = await store.getQueue();
        if (!queue.length) {
          await log("tryProcessQueue.empty_queue", {});
          break;
        }

        const job = queue.shift();
        await store.setQueue(queue);
        await log("tryProcessQueue.opening_tab", { id: job.id, title: job.title, queueLeft: queue.length });

        const tab = await chrome.tabs.create({ url: job.link, active: false });
        await log("tryProcessQueue.tab_created", { tabId: tab.id, url: job.link });

        const result = await waitForBidResult(tab.id, job);
        if (result?.clientCountry && !job.clientCountry) {
          job.clientCountry = String(result.clientCountry).trim();
        }
        await log("tryProcessQueue.bid_result", { id: job.id, success: result.success, reason: result.reason || null });

        await chrome.tabs.remove(tab.id).catch(() => {});

        if (result.success) {
          const applied = await store.getAppliedProjects();
          applied[job.id] = Date.now();
          await store.setAppliedProjects(applied);
          await log("tryProcessQueue.marked_applied", { id: job.id, title: job.title });
          if (settings.notifyOnSuccess && settings.telegramBotToken && settings.telegramChatId) {
            await services.sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, buildBidResultText("✅ Auto-bid placed.", job))
              .then(() => log("tryProcessQueue.success_telegram_sent", { id: job.id }))
              .catch(err => log("tryProcessQueue.success_telegram_error", { id: job.id, error: err.message }));
          }
        } else {
          if (settings.notifyOnFail && settings.telegramBotToken && settings.telegramChatId) {
            await services.sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, buildBidResultText("❌ Auto-bid failed.", job, result.reason))
              .then(() => log("tryProcessQueue.fail_telegram_sent", { id: job.id }))
              .catch(err => log("tryProcessQueue.fail_telegram_error", { id: job.id, error: err.message }));
          }
        }

        const delay = rand(8000, 18000);
        await log("tryProcessQueue.next_in", { ms: delay, nextQueueLength: queue.length });
        await new Promise(r => setTimeout(r, delay));
      }
    } finally {
      queueRunning = false;
    }
  }

  function waitForBidResult(tabId, job) {
    return new Promise(resolve => {
      const giveUpAt = Date.now() + 5 * 60 * 1000;

      function onTabReady(id, info) {
        if (id !== tabId || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(onTabReady);
        trySendBid();
      }

      function trySendBid() {
        if (Date.now() > giveUpAt) {
          resolve({ success: false, reason: "waitForBidResult: 5 min timeout reached" });
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: "DO_BID", job }, (res) => {
            if (chrome.runtime.lastError || !res) {
              setTimeout(trySendBid, 2000);
            } else {
              resolve(res);
            }
          });
        }, 1500);
      }

      chrome.tabs.onUpdated.addListener(onTabReady);
    });
  }

  async function addJobs(payload) {
    await log("addJobs.enter", { count: payload?.jobs?.length ?? 0 });

    const settings = await store.getSettings();
    if (!settings.monitorEnabled) {
      await log("addJobs.skip", { reason: "monitor disabled" });
      return { added: 0, skipped: 0 };
    }

    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    let added = 0;
    let skipped = 0;

    for (const rawJob of jobs) {
      const job = {
        id:            String(rawJob.id || "").trim(),
        link:          String(rawJob.link || "").trim(),
        title:         String(rawJob.title || "").trim(),
        budgetText:    String(rawJob.budgetText || "").trim(),
        skillsText:    String(rawJob.skillsText || "").trim(),
        postedText:    String(rawJob.postedText || "").trim(),
        clientCountry: String(rawJob.clientCountry || "").trim()
      };

      if (!passesFilters(job, settings)) {
        await log("addJobs.filtered_out", { id: job.id, title: job.title, budget: job.budgetText });
        skipped++;
        continue;
      }

      const applied = await store.getAppliedProjects();
      if (applied[job.id]) {
        await log("addJobs.already_applied", { id: job.id, title: job.title });
        skipped++;
        continue;
      }

      if (await store.wasRecentlySent(`job:${job.id}`)) {
        skipped++;
        continue;
      }

      if (settings.mode === "notify") {
        try {
          services.ensureTelegramConfigured(settings);
          await services.sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, buildJobText(job));
          await store.markAsSent(`job:${job.id}`);
          await log("addJobs.notified", { id: job.id, title: job.title });
          added++;
        } catch (err) {
          await log("addJobs.telegram_error", { id: job.id, title: job.title, error: err.message });
          skipped++;
        }
      } else {
        const queue = await store.getQueue();
        if (queue.some(q => q.id === job.id)) {
          await log("addJobs.already_in_queue", { id: job.id, title: job.title });
          skipped++;
          continue;
        }
        queue.push({ ...job, queuedAt: Date.now() });
        await store.setQueue(queue);
        await store.markAsSent(`job:${job.id}`);
        await log("addJobs.queued", { id: job.id, title: job.title });
        added++;
      }
    }

    await log("addJobs.done", { added, skipped });

    if (settings.mode === "auto_bid" && added > 0) {
      await tryProcessQueue();
    }

    return { added, skipped };
  }

  async function handleUnreadChanged(payload) {
    await log("handleUnreadChanged.enter", { prev: payload.previousUnread, curr: payload.currentUnread });

    const settings = await store.getSettings();
    if (!settings.monitorEnabled) {
      await log("handleUnreadChanged.skip", { reason: "monitor disabled" });
      return "disabled";
    }

    const curr = Math.max(0, Number(payload.currentUnread || 0));
    const prev = Math.max(0, Number(payload.previousUnread || 0));
    if (curr <= prev) {
      await log("handleUnreadChanged.skip", { reason: "no increase", prev, curr });
      return "no increase";
    }

    const key = `msg:${prev}->${curr}:${new Date().toISOString().slice(0, 16)}`;
    if (await store.wasRecentlySent(key)) {
      await log("handleUnreadChanged.skip", { reason: "duplicate within minute" });
      return "duplicate";
    }

    try {
      services.ensureTelegramConfigured(settings);
      await services.sendTelegramMessage(
        settings.telegramBotToken, settings.telegramChatId,
        ["Freelancer unread messages increased.", `Before: ${prev}  Now: ${curr}`].join("\n")
      );
      await store.markAsSent(key);
      await log("handleUnreadChanged.sent", { prev, curr });
      return "notified";
    } catch (err) {
      await log("handleUnreadChanged.telegram_error", { error: err.message });
      throw err;
    }
  }

  async function getSettingsWithStats() {
    const settings = await store.getSettings();
    const queue    = await store.getQueue();
    const history  = await store.getHistory();
    const logs     = await store.getLogs();
    return {
      settings,
      stats: { sentCount: Object.keys(history).length, queueCount: queue.length },
      logs
    };
  }

  self.FB.handlers = {
    IS_FIRST_TAB: async (_msg, sender) => {
      const tabs = await chrome.tabs.query({ url: "https://www.freelancer.com/*" });
      const sorted = tabs.slice().sort((a, b) => a.id - b.id);
      return sorted.length === 0 || sorted[0].id === sender.tab?.id;
    },
    ADD_JOBS:               (msg) => addJobs(msg.payload || {}),
    UNREAD_CHANGED:         (msg) => handleUnreadChanged(msg.payload || {}),
    QUEUE_CHECK:            () => tryProcessQueue(),
    GET_SETTINGS:           getSettingsWithStats,
    SAVE_SETTINGS:          (msg) => store.saveSettings(msg.settings || {}).then(s => ({ settings: s })),
    SEND_TEST_NOTIFICATION: async () => {
      const s = await store.getSettings();
      services.ensureTelegramConfigured(s);
      await services.sendTelegramMessage(s.telegramBotToken, s.telegramChatId,
        ["Freelancer Notifier test.", `Mode: ${s.mode}`, `Time: ${new Date().toLocaleString()}`].join("\n"));
      return "sent";
    },
    GENERATE_PROPOSAL: async (msg) => {
      const settings = await store.getSettings();
      const job = msg.payload?.job || {};
      const proposal = await services.generateLlamaProposal(
        settings.llamaHost,
        settings.llamaPrompt,
        job
      );
      return { proposal };
    },
    LOG_EVENT:  (msg) => log(msg.payload?.event || "content.log", msg.payload?.details || {}).then(() => "ok"),
    GET_LOGS:   async () => ({ logs: await store.getLogs() }),
    CLEAR_LOGS: async () => { await store.clearLogs(); return "cleared"; }
  };

  self.FB.tryProcessQueue = tryProcessQueue;
})();
