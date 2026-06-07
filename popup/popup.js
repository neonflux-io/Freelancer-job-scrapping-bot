"use strict";

const el = {
  botToggleBtn:  document.getElementById("botToggleBtn"),
  botStatusText: document.getElementById("botStatusText"),
  testBtn:       document.getElementById("testBtn"),
  optionsBtn:    document.getElementById("optionsBtn"),
  status:        document.getElementById("status"),
  sentCount:     document.getElementById("sentCount"),
  queueCount:    document.getElementById("queueCount"),
  activeProject: document.getElementById("activeProject")
};

boot().catch((err) => setStatus(err.message, true));

el.botToggleBtn.addEventListener("click", async () => {
  try {
    const current = await msg({ type: "GET_SETTINGS" });
    const nextEnabled = !Boolean(current.settings?.monitorEnabled);
    await msg({ type: "SAVE_SETTINGS", settings: { monitorEnabled: nextEnabled } });
    setBotState(nextEnabled);
    setStatus(nextEnabled ? "Bot started." : "Bot stopped.");
  } catch (err) {
    setStatus(`Toggle failed: ${err.message}`, true);
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

el.optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function boot() {
  const result = await msg({ type: "GET_SETTINGS" });
  setBotState(Boolean(result.settings?.monitorEnabled));
  renderStats(result.stats);
  setStatus("Ready.");
}

function setBotState(enabled) {
  el.botStatusText.textContent = enabled ? "Running" : "Stopped";
  el.botToggleBtn.textContent  = enabled ? "Stop bot" : "Start bot";
  el.botToggleBtn.className    = enabled ? "btn btn-primary mt-small" : "btn btn-secondary mt-small";
}

function renderStats(stats) {
  el.sentCount.textContent     = `Notifications tracked: ${Number(stats?.sentCount || 0)}`;
  el.queueCount.textContent    = `Queue: ${Number(stats?.queueCount || 0)} jobs`;
  const activeId = String(stats?.activeProjectId || "").trim();
  el.activeProject.textContent = activeId ? `Active: ${activeId}` : "";
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
