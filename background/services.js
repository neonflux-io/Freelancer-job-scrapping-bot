"use strict";

(function initBackgroundServices() {
  async function sendTelegramMessage(token, chatId, text) {
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Telegram API error (${response.status}): ${bodyText}`);
    }
  }

  function ensureTelegramConfigured(settings) {
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      throw new Error("Telegram Bot Token and Chat ID are required");
    }
  }

  async function generateLlamaProposal(host, promptTemplate, job) {
    const prompt = promptTemplate.replace(/\{jobDescription\}/g, String(job.description || ""));

    const url = `https://${host}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
        min_tokens: 100,
        temperature: 0.7
      })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Llama API error (${response.status}): ${bodyText}`);
    }

    const data = JSON.parse(bodyText);
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Llama returned an empty proposal");
    if (text.length < 150) throw new Error(`Llama proposal too short (${text.length} chars)`);
    return text;
  }

  self.FB.services = {
    sendTelegramMessage,
    ensureTelegramConfigured,
    generateLlamaProposal
  };
})();
