"use strict";

(function initBackgroundStore() {
  const cfg = self.FB.CONFIG;
  const utils = self.FB.utils;

  function normalizeSettings(settings) {
    const blockedCurrencies = Array.isArray(settings.blockedCurrencies)
      ? settings.blockedCurrencies.map((value) => String(value || "").trim()).filter(Boolean)
      : cfg.DEFAULT_SETTINGS.blockedCurrencies;

    const excludedCountries = Array.isArray(settings.excludedCountries)
      ? settings.excludedCountries.map((value) => String(value || "").trim()).filter(Boolean)
      : cfg.DEFAULT_SETTINGS.excludedCountries;

    const minBudgetFixed = Number.isFinite(Number(settings.minBudgetFixed))
      ? Math.max(0, Number(settings.minBudgetFixed))
      : 0;

    const minBudgetHourly = Number.isFinite(Number(settings.minBudgetHourly))
      ? Math.max(0, Number(settings.minBudgetHourly))
      : 0;

    const mode = String(settings.mode || "notify").trim() === "auto_bid" ? "auto_bid" : "notify";

    return {
      monitorEnabled: Boolean(settings.monitorEnabled),
      mode,
      telegramBotToken: String(settings.telegramBotToken || "").trim(),
      telegramChatId: String(settings.telegramChatId || "").trim(),
      minBudgetFixed,
      minBudgetHourly,
      blockedCurrencies: blockedCurrencies.length ? blockedCurrencies : cfg.DEFAULT_SETTINGS.blockedCurrencies,
      excludedCountries,
      notifyOnSuccess: settings.notifyOnSuccess !== false,
      notifyOnFail: settings.notifyOnFail !== false,
      bidFormTimeoutSec: Math.min(120, Math.max(5, Math.floor(Number(settings.bidFormTimeoutSec) || 15))),
      proposalSource: String(settings.proposalSource || "freelancer") === "llama" ? "llama" : "freelancer",
      llamaHost: String(settings.llamaHost || "llama.orsentra.com").trim() || "llama.orsentra.com",
      llamaPrompt: String(settings.llamaPrompt || cfg.DEFAULT_SETTINGS.llamaPrompt).trim() || cfg.DEFAULT_SETTINGS.llamaPrompt
    };
  }

  async function getSettings() {
    const data = await chrome.storage.local.get([cfg.SETTINGS_KEY]);
    return normalizeSettings({ ...cfg.DEFAULT_SETTINGS, ...(data[cfg.SETTINGS_KEY] || {}) });
  }

  async function saveSettings(partialSettings) {
    const current = await getSettings();
    const merged = normalizeSettings({ ...current, ...partialSettings });
    await chrome.storage.local.set({ [cfg.SETTINGS_KEY]: merged });
    return merged;
  }

  async function ensureDefaults() {
    await saveSettings({});
  }

  async function getMap(key) {
    const data = await chrome.storage.local.get([key]);
    return utils.isObject(data[key]) ? data[key] : {};
  }

  async function setMap(key, map) {
    await chrome.storage.local.set({ [key]: map });
  }

  async function getArray(key) {
    const data = await chrome.storage.local.get([key]);
    return Array.isArray(data[key]) ? data[key] : [];
  }

  async function setArray(key, arr) {
    await chrome.storage.local.set({ [key]: arr });
  }

  async function getHistory() {
    return getMap(cfg.HISTORY_KEY);
  }

  async function wasRecentlySent(key) {
    const history = await getHistory();
    return Boolean(history[key]);
  }

  async function markAsSent(key) {
    const history = await getHistory();
    history[key] = Date.now();
    const entries = Object.entries(history)
      .sort((a, b) => b[1] - a[1])
      .slice(0, cfg.HISTORY_MAX_ITEMS);
    await setMap(cfg.HISTORY_KEY, Object.fromEntries(entries));
  }

  async function pruneHistory() {
    const history = await getHistory();
    const now = Date.now();
    const entries = Object.entries(history)
      .filter(([, timestamp]) => Number.isFinite(timestamp) && now - timestamp <= cfg.HISTORY_TTL_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, cfg.HISTORY_MAX_ITEMS);
    await setMap(cfg.HISTORY_KEY, Object.fromEntries(entries));
  }

  async function getQueue() {
    return getArray(cfg.QUEUE_KEY);
  }

  async function setQueue(queue) {
    await setArray(cfg.QUEUE_KEY, queue);
  }

  async function getActiveProject() {
    const data = await chrome.storage.local.get([cfg.ACTIVE_KEY]);
    return utils.isObject(data[cfg.ACTIVE_KEY]) ? data[cfg.ACTIVE_KEY] : null;
  }

  async function setActiveProject(active) {
    await chrome.storage.local.set({ [cfg.ACTIVE_KEY]: active || null });
  }

  async function getAppliedProjects() {
    return getMap(cfg.APPLIED_KEY);
  }

  async function setAppliedProjects(applied) {
    await setMap(cfg.APPLIED_KEY, applied);
  }

  async function pruneAppliedProjects() {
    const applied = await getAppliedProjects();
    const now = Date.now();
    const next = Object.fromEntries(
      Object.entries(applied).filter(([, timestamp]) => Number.isFinite(timestamp) && now - timestamp <= cfg.HISTORY_TTL_MS)
    );
    await setAppliedProjects(next);
  }

  async function getLogs() {
    const data = await chrome.storage.local.get([cfg.LOGS_KEY]);
    return Array.isArray(data[cfg.LOGS_KEY]) ? data[cfg.LOGS_KEY] : [];
  }

  async function appendLog(entry) {
    const logs = await getLogs();
    logs.unshift(entry);
    await chrome.storage.local.set({ [cfg.LOGS_KEY]: logs.slice(0, cfg.LOGS_MAX_ITEMS) });
  }

  async function clearLogs() {
    await chrome.storage.local.set({ [cfg.LOGS_KEY]: [] });
  }

  self.FB.store = {
    normalizeSettings,
    getSettings,
    saveSettings,
    ensureDefaults,
    getHistory,
    wasRecentlySent,
    markAsSent,
    pruneHistory,
    getQueue,
    setQueue,
    getActiveProject,
    setActiveProject,
    getAppliedProjects,
    setAppliedProjects,
    pruneAppliedProjects,
    getLogs,
    appendLog,
    clearLogs
  };
})();
