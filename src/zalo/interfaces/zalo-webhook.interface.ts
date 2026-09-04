/**
 * Inbound webhook payload shape sent by the Zalo Bot Platform when a user
 * sends a message to the bot. Modeled after the Zalo Bot API's documented
 * "update" object (Telegram-Bot-API-like shape). Verify field names against
 * the current official docs before going live — see docs/SETUP.md.
 */
export interface ZaloWebhookChat {
  id: string;
  type?: string;
}

export interface ZaloWebhookFrom {
  id: string;
  display_name?: string;
}

export interface ZaloWebhookMessage {
  message_id?: string;
  text?: string;
  chat: ZaloWebhookChat;
  from?: ZaloWebhookFrom;
  date?: number;
}

export interface ZaloWebhookUpdate {
  update_id?: string | number;
  event_name?: string;
  message?: ZaloWebhookMessage;
}

/** Response payload from the Zalo Bot "send message" API call. */
export interface ZaloSendMessageResponse {
  ok?: boolean;
  result?: unknown;
  description?: string;
}
