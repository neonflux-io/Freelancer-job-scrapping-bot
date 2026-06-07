"use strict";

const el = {
  telegramBotToken:  document.getElementById("telegramBotToken"),
  telegramChatId:    document.getElementById("telegramChatId"),
  mode:              document.getElementById("mode"),
  proposalSource:    document.getElementById("proposalSource"),
  llamaHost:         document.getElementById("llamaHost"),
  llamaPrompt:       document.getElementById("llamaPrompt"),
  bidFormTimeoutSec: document.getElementById("bidFormTimeoutSec"),
  minBudgetFixed:    document.getElementById("minBudgetFixed"),
  minBudgetHourly:   document.getElementById("minBudgetHourly"),
  blockedCurrencies: document.getElementById("blockedCurrencies"),
  excludedCountries: document.getElementById("excludedCountries"),
  notifyOnSuccess:   document.getElementById("notifyOnSuccess"),
  notifyOnFail:      document.getElementById("notifyOnFail"),
  saveBtn:           document.getElementById("saveBtn"),
  testBtn:           document.getElementById("testBtn"),
  refreshLogsBtn:    document.getElementById("refreshLogsBtn"),
  clearLogsBtn:      document.getElementById("clearLogsBtn"),
  logsOutput:        document.getElementById("logsOutput"),
  status:            document.getElementById("status")
};

boot().catch((err) => setStatus(err.message, true));

el.saveBtn.addEventListener("click", async () => {
  try {
    setStatus("Saving...");
    await msg({ type: "SAVE_SETTINGS", settings: readForm() });
    setStatus("Settings saved.");
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
});

el.testBtn.addEventListener("click", async () => {
  try {
    setStatus("Sending...");
    await msg({ type: "SEND_TEST_NOTIFICATION" });
    setStatus("Test notification sent.");
  } catch (err) {
    setStatus(`Test failed: ${err.message}`, true);
  }
});

el.refreshLogsBtn.addEventListener("click", async () => {
  try {
    const result = await msg({ type: "GET_LOGS" });
    renderLogs(result.logs || []);
    setStatus("Logs refreshed.");
  } catch (err) {
    setStatus(`Refresh failed: ${err.message}`, true);
  }
});

el.clearLogsBtn.addEventListener("click", async () => {
  try {
    await msg({ type: "CLEAR_LOGS" });
    renderLogs([]);
    setStatus("Logs cleared.");
  } catch (err) {
    setStatus(`Clear failed: ${err.message}`, true);
  }
});

async function boot() {
  const result = await msg({ type: "GET_SETTINGS" });
  renderSettings(result.settings);
  renderLogs(result.logs || []);
  setStatus("Ready.");
}

function readForm() {
  return {
    mode:              String(el.mode.value || "notify"),
    telegramBotToken:  el.telegramBotToken.value.trim(),
    telegramChatId:    el.telegramChatId.value.trim(),
    proposalSource:    String(el.proposalSource.value || "freelancer"),
    llamaHost:         el.llamaHost.value.trim() || "llama.orsentra.com",
    llamaPrompt:       el.llamaPrompt.value.trim(),
    bidFormTimeoutSec: Number(el.bidFormTimeoutSec.value || 15),
    minBudgetFixed:    Number(el.minBudgetFixed.value || 0),
    minBudgetHourly:   Number(el.minBudgetHourly.value || 0),
    blockedCurrencies: el.blockedCurrencies.value.split(",").map((s) => s.trim()).filter(Boolean),
    excludedCountries: el.excludedCountries.value.split(",").map((s) => s.trim()).filter(Boolean),
    notifyOnSuccess:   el.notifyOnSuccess.checked,
    notifyOnFail:      el.notifyOnFail.checked
  };
}

function renderSettings(settings) {
  el.mode.value              = settings.mode || "notify";
  el.telegramBotToken.value  = settings.telegramBotToken || "";
  el.telegramChatId.value    = settings.telegramChatId || "";
  el.proposalSource.value    = settings.proposalSource || "freelancer";
  el.llamaHost.value         = settings.llamaHost || "llama.orsentra.com";
  el.llamaPrompt.value       = settings.llamaPrompt || "";
  el.bidFormTimeoutSec.value = Number.isFinite(Number(settings.bidFormTimeoutSec)) ? Number(settings.bidFormTimeoutSec) : 15;
  el.minBudgetFixed.value    = Number.isFinite(Number(settings.minBudgetFixed))  ? Number(settings.minBudgetFixed)  : 0;
  el.minBudgetHourly.value   = Number.isFinite(Number(settings.minBudgetHourly)) ? Number(settings.minBudgetHourly) : 0;
  el.blockedCurrencies.value = Array.isArray(settings.blockedCurrencies) ? settings.blockedCurrencies.join(", ") : "";
  el.excludedCountries.value = Array.isArray(settings.excludedCountries) ? settings.excludedCountries.join(", ") : "";
  el.notifyOnSuccess.checked = settings.notifyOnSuccess !== false;
  el.notifyOnFail.checked    = settings.notifyOnFail !== false;
}

function renderLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) {
    el.logsOutput.textContent = "No logs.";
    return;
  }
  el.logsOutput.textContent = logs.map((entry) => {
    const time    = entry?.ts ? new Date(entry.ts).toLocaleTimeString() : "?";
    const event   = String(entry?.event || "?");
    const details = entry?.details && Object.keys(entry.details).length
      ? " " + JSON.stringify(entry.details)
      : "";
    return `[${time}] ${event}${details}`;
  }).join("\n");
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.className   = isError ? "status error" : "status ok";
}

async function msg(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error("No response from background");
  if (!response.ok) throw new Error(response.error || "Unknown error");
  return response.result;
}
