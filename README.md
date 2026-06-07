# Freelancer Unified Notifier

Single Chrome extension that merges both previous projects:

- Job detection from Freelancer pages.
- Unread message increase detection.
- Telegram delivery from a single background service.
- Mode switch: notify-only or auto-bid queue.
- Gemini-generated proposal text for auto-bid mode.

## Project Structure

- manifest.json: Chrome extension manifest.
- background.js: Background loader for modular background files.
- shared/common.js: Shared constants and utility helpers.
- background/store.js: Settings/history/queue storage utilities.
- background/services.js: Telegram and Gemini API services.
- background/handlers.js: Event handlers for jobs/messages/queue.
- background/router.js: Runtime message router and lifecycle hooks.
- content/state.js: Content runtime state and settings projection.
- content/monitors.js: Job and unread-message monitors.
- content/auto-bid.js: Queue runner and bid-form automation.
- content/main.js: Content bootstrap and orchestration.
- popup/popup.html: Popup UI.
- popup/popup.css: Popup styles.
- popup/popup.js: Popup behavior.

## Why This Structure Is Better

- One extension, one source of truth for settings.
- No hardcoded credentials in source.
- Message alerts only on unread increase, not continuous spam loops.
- Shared dedupe history for both event types.
- Clear separation between page monitoring and notification delivery.
- Auto-bid mode processes queued projects one by one.
- In auto-bid mode, project alerts are suppressed and Telegram alerts are sent only when apply fails.

## Installation

1. Open chrome://extensions/
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the freelancer-merged folder.

## Initial Setup

1. Open the extension popup.
2. Fill Telegram bot token and chat ID.
3. Choose project mode:
	- notify: send notifications for new projects.
	- auto_bid: queue projects and attempt bid submission one by one.
4. Fill Gemini API key (required for auto_bid mode) and optional model.
5. Fill profile name, profile content, and optional portfolios (used to generate proposal text).
6. Enable monitors you want.
7. Click Save settings.
8. Optionally click Send test notification.

## Notes

- Budget filter currently reads dollar amounts when present.
- Blocked currencies are string-based and case-insensitive.
- Notification history is retained in local storage and pruned automatically.
- In auto-bid mode, queue status and active project id are visible in the popup.
- Auto-bid only updates the proposal textarea and submits Place Bid.
- If auto-bid fails, Telegram gets failure notification; successful auto-bids do not trigger new-project Telegram alerts.
