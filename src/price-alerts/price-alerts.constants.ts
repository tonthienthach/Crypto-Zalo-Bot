/** Hard cap on alerts a single chat may hold at once (spec EPIC-002-FR04). */
export const MAX_ALERTS_PER_CHAT = 10;

/**
 * A fired alert only re-arms once price has moved back this far past the
 * threshold (0.5%), so a price hovering right at the level doesn't flap
 * between fired/armed on every check (spec EPIC-002-FR06).
 */
export const REARM_BUFFER_RATIO = 0.005;

/** At most one message per alert within this window, even across re-arms (spec EPIC-002-FR07). */
export const ALERT_COOLDOWN_MS = 15 * 60_000;

/** Upper bound (inclusive) on an alert threshold, in USD (spec EPIC-002-NFR06). */
export const MAX_ALERT_THRESHOLD = 1e12;

/** Max decimal places accepted in an alert threshold (spec EPIC-002-NFR06). */
export const MAX_THRESHOLD_DECIMALS = 8;

/** Max length of a coin symbol accepted in /canhbao (spec EPIC-002-NFR06). */
export const MAX_ALERT_SYMBOL_LENGTH = 20;

/**
 * Upstash Redis keys. Each alert lives in its own key so state updates can
 * use `SET ... XX` (write only if the key still exists) — an alert deleted
 * by its chat mid-check is never resurrected by the check writing it back.
 */
export const REDIS_KEYS = {
  nextId: 'price-alerts:next-id',
  allIds: 'price-alerts:ids',
  alert: (id: number | string) => `price-alerts:alert:${id}`,
  chatIds: (chatId: string) => `price-alerts:chat:${chatId}`,
  runLock: 'price-alerts:run-lock',
  deliveries: 'price-alerts:deliveries',
  deliveryFailures: 'price-alerts:delivery-failures',
  runs: 'price-alerts:runs',
} as const;

/**
 * Run lock TTL. A check run takes well under 15s (spec EPIC-002-NFR02), so
 * this only matters if a run crashes before releasing the lock — the next
 * runs are then skipped for at most this long instead of forever.
 */
export const RUN_LOCK_TTL_SECONDS = 120;

/**
 * A failed send is retried on the very next runs (spec EPIC-002-AC13), but
 * after this many consecutive failures the alert backs off to one attempt
 * per ALERT_RETRY_BACKOFF_MS. A brief Zalo blip is retried within the
 * latency target, while a chat that blocked the bot doesn't cost an
 * 8s-timeout Zalo call every minute forever.
 */
export const ALERT_FAILURES_BEFORE_BACKOFF = 3;
export const ALERT_RETRY_BACKOFF_MS = 5 * 60_000;

/**
 * No new sends are started once a run's send phase (after the price lookup)
 * has been going this long; the remaining due alerts stay armed for the next
 * run. With Zalo's 8s send timeout this bounds the send phase at ~14s (spec
 * EPIC-002-NFR02) however many alerts are due.
 */
export const RUN_SEND_BUDGET_MS = 6_000;

/**
 * Successful deliveries kept in Redis, newest first — enough to cover the
 * 30-day success metric. Failures go to a separate capped list so a chat
 * that keeps failing can't push successful deliveries out.
 */
export const MAX_DELIVERY_LOG_ENTRIES = 1000;
export const MAX_DELIVERY_FAILURE_LOG_ENTRIES = 1000;

/** Run summaries kept in Redis, newest first — 24h at one run per minute (spec EPIC-002-AC18). */
export const MAX_RUN_LOG_ENTRIES = 1440;
