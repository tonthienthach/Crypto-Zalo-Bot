/**
 * Inbound webhook payload sent by the Zalo Bot Platform when an event
 * happens (e.g. a user sends a message). CONFIRMED LIVE against a real
 * webhook call from production (2026-09-04) — the update is a FLAT object,
 * not wrapped in `{ ok, result }` as an earlier reading of the docs
 * suggested:
 *
 * {
 *   "event_name": "message.text.received",
 *   "message": {
 *     "date": 1788543207731,
 *     "chat": { "chat_type": "PRIVATE", "id": "edd5f2ef42baabe4f2ab" },
 *     "message_id": "02b8d8946c41fe18a757",
 *     "from": { "id": "edd5f2ef42baabe4f2ab", "is_bot": false, "display_name": "..." },
 *     "text": "/help"
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

export interface ZaloWebhookUpdate {
  event_name?: string;
  message?: ZaloWebhookMessage;
}

/** Response payload from the Zalo Bot "send message" API call. */
export interface ZaloSendMessageResponse {
  ok?: boolean;
  result?: unknown;
  description?: string;
}
