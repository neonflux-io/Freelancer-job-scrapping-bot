"use strict";

self.FB = self.FB || {};

self.FB.CONFIG = {
  SETTINGS_KEY: "settings",
  HISTORY_KEY: "notificationHistory",
  LOGS_KEY: "debugLogs",
  QUEUE_KEY: "autoBidQueue",
  ACTIVE_KEY: "autoBidActive",
  APPLIED_KEY: "appliedProjects",
  HISTORY_MAX_ITEMS: 2000,
  LOGS_MAX_ITEMS: 300,
  HISTORY_TTL_MS: 14 * 24 * 60 * 60 * 1000,
  ACTIVE_TTL_MS: 10 * 60 * 1000,
  DEFAULT_SETTINGS: {
    monitorEnabled: true,
    mode: "notify",
    telegramBotToken: "",
    telegramChatId: "",
    minBudgetFixed: 0,
    minBudgetHourly: 0,
    blockedCurrencies: ["INR", "₹"],
    excludedCountries: ["india", "pakistan", "nigeria"],
    notifyOnSuccess: true,
    notifyOnFail: true,
    bidFormTimeoutSec: 15,
    proposalSource: "freelancer",
    llamaHost: "llama.orsentra.com",
    llamaPrompt: "Write a professional freelancer bid proposal for the following job.\n\n{jobDescription}\n\nWrite a compelling, personalized proposal addressing the client's specific needs. Be concise and direct."
  }
};

self.FB.utils = {
  isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  },

  cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  },

  normalizeProjectHref(href) {
    const trimmed = String(href || "").trim();
    if (!trimmed) {
      return "";
    }

    try {
      const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, "https://www.freelancer.com");
      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return "";
    }
  },

  createFallbackId(input) {
    const source = `${input.title}|${input.budgetText}|${input.skillsText}`.toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash << 5) - hash + source.charCodeAt(i);
      hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
  },

  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch (_error) {
      return String(url || "").trim();
    }
  },

  parseBudgetAmountUsdLike(budgetText) {
    const source = String(budgetText || "").replace(/,/g, "");
    const matches = source.match(/\$\s*(\d+(?:\.\d+)?)/g);
    if (!matches || !matches.length) {
      return null;
    }

    const values = matches
      .map((match) => Number(match.replace(/[^\d.]/g, "")))
      .filter((num) => Number.isFinite(num));

    return values.length ? Math.max(...values) : null;
  },

  isBlockedCurrency(budgetText, blockedCurrencies) {
    const source = String(budgetText || "").toUpperCase();
    return blockedCurrencies.some((currency) => source.includes(String(currency).toUpperCase()));
  },

  normalizeCountryName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  isExcludedCountry(projectCountry, excludedCountries) {
    const normalizedProjectCountry = this.normalizeCountryName(projectCountry);
    if (!normalizedProjectCountry) {
      return false;
    }

    return excludedCountries
      .map((country) => this.normalizeCountryName(country))
      .filter(Boolean)
      .includes(normalizedProjectCountry);
  },

  randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
};
