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
  alert: (id: number) => `price-alerts:alert:${id}`,
  chatIds: (chatId: string) => `price-alerts:chat:${chatId}`,
  runLock: 'price-alerts:run-lock',
  deliveries: 'price-alerts:deliveries',
  runs: 'price-alerts:runs',
} as const;

/**
 * Run lock TTL. A check run takes well under 15s (spec EPIC-002-NFR02), so
 * this only matters if a run crashes before releasing the lock — the next
 * runs are then skipped for at most this long instead of forever.
 */
export const RUN_LOCK_TTL_SECONDS = 120;

/** Delivery log kept in Redis, newest first — enough to cover the 30-day success metric. */
export const MAX_DELIVERY_LOG_ENTRIES = 1000;

/** Run summaries kept in Redis, newest first — 24h at one run per minute (spec EPIC-002-AC18). */
export const MAX_RUN_LOG_ENTRIES = 1440;
