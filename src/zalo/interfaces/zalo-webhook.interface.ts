/**
 * Inbound webhook payload sent by the Zalo Bot Platform when an event
 * happens (e.g. a user sends a message). Confirmed against the official
 * docs at https://bot.zaloplatforms.com/docs/webhook/ — the whole update is
 * wrapped in `{ ok, result }`, mirroring the shape of the Bot API's own
 * responses:
 *
 * {
 *   "ok": true,
 *   "result": {
 *     "message": {
 *       "from": { "id": "...", "display_name": "Ted", "is_bot": false },
 *       "chat": { "id": "...", "chat_type": "PRIVATE" },
 *       "text": "Xin chào",
 *       "message_id": "...",
 *       "date": 1750316131602
 *     },
 *     "event_name": "message.text.received"
 *   }
 * }
 */
export interface ZaloWebhookChat {
  id: string;
  chat_type?: 'PRIVATE' | 'GROUP' | string;
}

export interface ZaloWebhookFrom {
  id: string;
  display_name?: string;
  is_bot?: boolean;
}

export interface ZaloWebhookMessage {
  message_id?: string;
  text?: string;
  chat: ZaloWebhookChat;
  from?: ZaloWebhookFrom;
  date?: number;
}

export interface ZaloWebhookResult {
  event_name?: string;
  message?: ZaloWebhookMessage;
}

export interface ZaloWebhookUpdate {
  ok?: boolean;
  result?: ZaloWebhookResult;
}

/** Response payload from the Zalo Bot "send message" API call. */
export interface ZaloSendMessageResponse {
  ok?: boolean;
  result?: unknown;
  description?: string;
}
