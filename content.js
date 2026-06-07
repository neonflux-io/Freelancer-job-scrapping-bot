"use strict";

(function () {
  if (window.__flInit) return;
  window.__flInit = true;

  const utils = self.FB.utils;
  const SETTINGS_KEY = self.FB.CONFIG.SETTINGS_KEY;

  let settings = { monitorEnabled: false, mode: "notify", blockedCurrencies: ["INR", "₹"], excludedCountries: [] };

  function isActive() { return Boolean(settings.monitorEnabled); }

  function normalizeSettings(raw) {
    const bc = Array.isArray(raw.blockedCurrencies)
      ? raw.blockedCurrencies.map(v => String(v).trim()).filter(Boolean)
      : ["INR", "₹"];
    const excludedCountries = Array.isArray(raw.excludedCountries)
      ? raw.excludedCountries.map(v => String(v).trim()).filter(Boolean)
      : [];
    return {
      monitorEnabled: raw.monitorEnabled !== false,
      mode: String(raw.mode || "") === "auto_bid" ? "auto_bid" : "notify",
      blockedCurrencies: bc.length ? bc : ["INR", "₹"],
      excludedCountries,
      minBudgetFixed: Math.max(0, Number(raw.minBudgetFixed || 0)),
      minBudgetHourly: Math.max(0, Number(raw.minBudgetHourly || 0)),
      bidFormTimeoutSec: Math.min(120, Math.max(5, Math.floor(Number(raw.bidFormTimeoutSec) || 15))),
      proposalSource: String(raw.proposalSource || "freelancer") === "llama" ? "llama" : "freelancer"
    };
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    settings = normalizeSettings(data[SETTINGS_KEY] || {});
  }

  function send(type, payload) {
    return chrome.runtime.sendMessage({ type, payload }).catch(() => null);
  }

  function log(event, details) { send("LOG_EVENT", { event, details }); }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function sleep(ms) { return new Promise(r => window.setTimeout(r, ms)); }
  async function sleepRand(minMs, maxMs) { await sleep(rand(minMs, maxMs)); }

  function waitFor(fn, maxMs) {
    const v = fn();
    if (v) return Promise.resolve(v);
    return new Promise(resolve => {
      const start = Date.now();
      const tid = window.setInterval(() => {
        const val = fn();
        if (val) { window.clearInterval(tid); resolve(val); return; }
        if (Date.now() - start >= maxMs) { window.clearInterval(tid); resolve(null); }
      }, 500);
    });
  }

  async function humanClick(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleepRand(600, 1400);
    el.click();
  }

  let jobScanTimer = null;
  const seenJobIds = new Set();

  async function isFirstFreelancerTab() {
    const res = await send("IS_FIRST_TAB");
    return res?.result === true;
  }

  function startJobScan() {
    if (jobScanTimer) return;
    isFirstFreelancerTab().then(isFirst => {
      if (!isFirst) return;
      sleepRand(1000, 4000).then(() => {
        scanJobs();
        scheduleNextScan();
      });
    });
  }

  function scheduleNextScan() {
    jobScanTimer = window.setTimeout(async () => {
      const btn = document.querySelector("fl-button[fltrackinglabel='RecentProjectsButton'] button");
      if (btn) {
        await humanClick(btn);
        await sleepRand(800, 2000);
      }
      scanJobs();
      scheduleNextScan();
    }, rand(25000, 40000));
  }

  function stopJobScan() {
    if (!jobScanTimer) return;
    window.clearTimeout(jobScanTimer);
    jobScanTimer = null;
  }

  function scanJobs() {
    const jobs = [];
    document.querySelectorAll("app-project-item").forEach(el => {
      const job = extractJob(el);
      if (!job || seenJobIds.has(job.id)) return;
      seenJobIds.add(job.id);
      jobs.push(job);
    });
    if (jobs.length) send("ADD_JOBS", { jobs });
  }

  function extractJob(el) {
    const href = el.querySelector("a[href*='/projects/']")?.getAttribute("href") || "";
    if (!href) return null;
    return {
      id: href,
      link: href.startsWith("http") ? href : `https://www.freelancer.com${href}`,
      title: utils.cleanText(
        el.querySelector("p.NotificationDetail.font-bold.text-foreground")?.textContent ||
        el.querySelector("a[href*='/projects/']")?.textContent
      ) || "New Job",
      budgetText:    utils.cleanText(el.querySelector("fl-budget")?.textContent),
      skillsText:    utils.cleanText(
        el.querySelector("p.NotificationDetail.text-foreground.mr-none")?.textContent ||
        Array.from(el.querySelectorAll("fl-tag .Content")).map(n => n.textContent).join(", ")
      ),
      postedText:    utils.cleanText(
        el.querySelector("fl-relative-time span")?.textContent ||
        el.querySelector("fl-relative-time")?.textContent
      ),
      clientCountry: ""
    };
  }

  let msgTimer = null;
  let lastUnread = null;

  function startMsgMonitor() {
    if (msgTimer) return;
    checkUnread();
    scheduleNextMsgCheck();
  }

  function scheduleNextMsgCheck() {
    msgTimer = window.setTimeout(() => {
      checkUnread();
      scheduleNextMsgCheck();
    }, rand(4000, 7000));
  }

  function stopMsgMonitor() {
    if (!msgTimer) return;
    window.clearTimeout(msgTimer);
    msgTimer = null;
    lastUnread = null;
  }

  function checkUnread() {
    const el = document.querySelector("fl-icon[title='Messages'] + fl-unread-indicator");
    const raw = String(el?.getAttribute("data-counter") || el?.querySelector(".UnreadIndicator-counter")?.textContent || "").trim();
    const count = isFinite(parseInt(raw, 10)) ? parseInt(raw, 10) : (el ? 1 : 0);
    if (lastUnread === null) { lastUnread = count; return; }
    if (count > lastUnread) send("UNREAD_CHANGED", { previousUnread: lastUnread, currentUnread: count });
    lastUnread = count;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "DO_BID") return false;
    runAutoBid(msg.job).then(sendResponse);
    return true;
  });

  async function runAutoBid(job) {
    log("runAutoBid.enter", { id: job.id, title: job.title });
    const applyPageClientCountry = (await waitFor(() => extractClientCountryFromApplyPage() || null, 8000)) || "";

    const bidForm = await waitFor(() =>
      document.querySelector("app-bid-form") || document.getElementById("descriptionTextArea"), settings.bidFormTimeoutSec * 1000);
    if (!bidForm) {
      log("runAutoBid.fail", { reason: "bid form not found after 15s" });
      return { success: false, reason: "Bid form not found", clientCountry: applyPageClientCountry };
    }

    if (utils.isExcludedCountry(applyPageClientCountry, settings.excludedCountries || [])) {
      log("runAutoBid.skip_excluded_country", {
        id: job.id,
        title: job.title,
        clientCountry: applyPageClientCountry
      });
      return {
        success: false,
        reason: `Excluded client country: ${applyPageClientCountry}`,
        clientCountry: applyPageClientCountry
      };
    }

    const budgetInfo = extractBudgetInfoFromApplyPage();
    if (budgetInfo && budgetInfo.amount !== null) {
      const typeLabel = budgetInfo.isHourly ? "hourly" : "fixed";
      const min = budgetInfo.isHourly ? settings.minBudgetHourly : settings.minBudgetFixed;
      if (min > 0 && budgetInfo.amount < min) {
        log("runAutoBid.budget_below_min", { amount: budgetInfo.amount, min, type: typeLabel });
        return {
          success: false,
          reason: `Budget too low (${typeLabel}): $${budgetInfo.amount} < $${min}`,
          clientCountry: applyPageClientCountry
        };
      }
    }

    let proposal;

    if (settings.proposalSource === "llama") {
      const description = extractJobDescriptionFromApplyPage();
      log("runAutoBid.llama_generating", { id: job.id });
      const res = await send("GENERATE_PROPOSAL", { job: { ...job, description } });
      if (!res?.ok || !res?.result?.proposal) {
        log("runAutoBid.fail", { reason: res?.error || "Llama proposal generation failed" });
        return { success: false, reason: res?.error || "Llama proposal generation failed", clientCountry: applyPageClientCountry };
      }
      proposal = res.result.proposal;
      const textarea = document.getElementById("descriptionTextArea");
      if (!textarea) {
        log("runAutoBid.fail", { reason: "Proposal textarea not found" });
        return { success: false, reason: "Proposal textarea not found", clientCountry: applyPageClientCountry };
      }
      await pasteIntoTextarea(textarea, proposal);
      log("runAutoBid.llama_proposal_filled", { length: proposal.length });
      await sleepRand(800, 1500);
    } else {
      await sleepRand(1000, 2500);

      const aiBtn = await waitFor(findAiButton, 15000);
      if (!aiBtn) {
        log("runAutoBid.fail", { reason: "AI button not found after 15s" });
        return { success: false, reason: "AI button not found", clientCountry: applyPageClientCountry };
      }

      await humanClick(aiBtn);
      log("runAutoBid.ai_clicked", {});

      proposal = await waitFor(() => {
        const text = String(document.getElementById("descriptionTextArea")?.value || "").trim();
        return text.length >= 100 ? text : null;
      }, 60000);
      if (!proposal) {
        log("runAutoBid.fail", { reason: "AI proposal not ready after 60s" });
        return { success: false, reason: "AI proposal timeout", clientCountry: applyPageClientCountry };
      }

      log("runAutoBid.proposal_ready", { length: proposal.length });
      await sleepRand(1500, 3000);
    }

    const placeBtn = await waitFor(findPlaceBidButton, 15000);
    if (!placeBtn) {
      log("runAutoBid.fail", { reason: "Place Bid button not found" });
      return { success: false, reason: "Place Bid button not found", clientCountry: applyPageClientCountry };
    }
    if (placeBtn.disabled) {
      log("runAutoBid.fail", { reason: "Place Bid button is disabled" });
      return { success: false, reason: "Place Bid button disabled", clientCountry: applyPageClientCountry };
    }

    await humanClick(placeBtn);
    await sleep(5000);

    const stillThere = findPlaceBidButton();
    if (stillThere) {
      log("runAutoBid.fail", { reason: "Place Bid button still present after 5s" });
      return {
        success: false,
        reason: "Place Bid button still present after submit — bid blocked (attachment or other requirement)",
        clientCountry: applyPageClientCountry
      };
    }

    log("runAutoBid.success", { id: job.id });
    return { success: true, clientCountry: applyPageClientCountry };
  }

  function findAiButton() {
    const btn = document.querySelector("fl-button[fltrackinglabel='AiGeneratedBid'] button");
    if (btn && !btn.disabled) return btn;
    return Array.from(document.querySelectorAll("button"))
      .find(b => /write\s+my\s+bid/i.test(b.textContent) && !b.disabled) || null;
  }

  function findPlaceBidButton() {
    return document.querySelector("fl-button[fltrackinglabel='PlaceBidButton'] button") ||
      Array.from(document.querySelectorAll("button")).find(b => /place\s+bid/i.test(b.textContent)) || null;
  }

  function extractClientCountryFromApplyPage() {
    const flagImg = document.querySelector("app-employer-info fl-flag img[title], app-employer-info fl-flag img[alt]");
    if (!flagImg) return "";

    const title = utils.cleanText(flagImg.getAttribute("title"));
    if (title) return title;

    const alt = utils.cleanText(flagImg.getAttribute("alt"));
    const fromAlt = alt.match(/flag\s+of\s+(.+)/i)?.[1];
    if (fromAlt) return utils.cleanText(fromAlt);

    return utils.cleanText(flagImg.closest(".RowWrapper")?.querySelector("p")?.textContent);
  }

  function extractJobDescriptionFromApplyPage() {
    const el = document.querySelector("app-project-details-description .ProjectDescription");
    return utils.cleanText(el?.textContent) || "";
  }

  async function pasteIntoTextarea(textarea, text) {
    await humanClick(textarea);
    await sleepRand(400, 800);

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(textarea, text);
    textarea.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste",
      data: text
    }));

    await sleepRand(300, 600);
    textarea.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }

  function extractBudgetInfoFromApplyPage() {
    const p = document.querySelector("app-project-details-budget .ProjectViewDetails-budget p");
    if (!p) return null;
    const text = utils.cleanText(p.textContent);
    const isHourly = /per\s+hour/i.test(text);
    const matches = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
    if (!matches) return { isHourly, amount: null };
    const values = matches.map(Number).filter(v => Number.isFinite(v) && v > 0);
    return { isHourly, amount: values.length ? Math.max(...values) : null };
  }

  function applySettings() {
    if (isActive()) { startJobScan(); startMsgMonitor(); }
    else            { stopJobScan();  stopMsgMonitor();  }
  }

  async function init() {
    await loadSettings();
    applySettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[SETTINGS_KEY]) return;
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue || {});
      applySettings();
    });

    let lastUrl = window.location.href;
    new MutationObserver(() => {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      if (isActive()) scanJobs();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  init().catch(err => console.error("[fl]", err));
})();
