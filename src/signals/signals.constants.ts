/** Strong swing: |change| vs 24h ago at or above this percent (spec EPIC-004-FR01). */
export const SWING_24H_PCT = 8;

/** Strong swing: |change| vs 72h ago at or above this percent (spec EPIC-004-FR01). */
export const SWING_72H_PCT = 15;

/** Bottom/top band of the 7-day range that maps to buy/sell, in percent (spec EPIC-004-FR02). */
export const BAND_PCT = 25;

/** Length of the range the verdict looks at, in days (spec EPIC-004-FR02). */
export const RANGE_DAYS = 7;

/** Minimum history needed before a verdict is given, in days (spec EPIC-004-AC11). */
export const MIN_HISTORY_DAYS = 7;

/**
 * How far from "24h ago" / "72h ago" a stored hourly point may be and still
 * count as that reference price (history has gaps when a run is missed).
 */
export const REFERENCE_TOLERANCE_MS = 90 * 60_000;

/** Float slack so a change of exactly the threshold counts as strong (spec EPIC-004-AC01). */
export const COMPARE_EPSILON = 1e-9;

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

/** At most one proactive signal message per chat per this window (spec EPIC-004-FR05). */
export const SEND_COOLDOWN_MS = HOUR_MS;

/** A coin already reported in the same direction is not reported again within this window (spec EPIC-004-FR06). */
export const REPEAT_WINDOW_MS = DAY_MS;

/** ...unless the move grew by at least this many percentage points since the last report (spec EPIC-004-FR06). */
export const REPEAT_EXTRA_PP = 5;

/** A verdict is scored by the price this long after it was given (spec EPIC-004-FR10, FR11). */
export const HORIZON_MS = 3 * DAY_MS;

/** Backtest looks at no more than this many days (spec EPIC-004-FR10). */
export const BACKTEST_DAYS = 90;

/** Backtest refuses a history shorter than this many days (spec EPIC-004-AC12). */
export const BACKTEST_MIN_DAYS = 14;

/** Hourly price points are kept this long: 7 days of range plus slack for the 7-day coverage check. */
export const HOURLY_RETENTION_MS = 8 * DAY_MS;

/** End-of-day price points are kept this long (spec EPIC-004-NFR04). */
export const DAILY_RETENTION_MS = 90 * DAY_MS;

/** A coin is backfilled from CoinGecko at most this many per run, to stay inside the free tier. */
export const MAX_BACKFILL_PER_RUN = 5;

/** After a failed backfill the coin is not retried for this long (an unknown coin would fail forever). */
export const BACKFILL_RETRY_HOLD_SECONDS = 2 * 60 * 60;

/** Coins asked about with /tinhieu but on nobody's watchlist, tracked so their verdicts can be scored (spec EPIC-004-FR11). */
export const MAX_EXTRA_TRACKED = 50;
export const EXTRA_TRACK_TTL_MS = 4 * DAY_MS;

/** Verdict records kept per chat, and for how long (spec EPIC-004-NFR09, NFR04). */
export const MAX_RECORDS_PER_CHAT = 1000;
export const RECORD_TTL_DAYS = 90;

/** Usage counters are kept for the 45-day success-metric window plus slack (spec EPIC-004-FR12). */
export const USAGE_TTL_SECONDS = 60 * 86_400;

/** The run lock only matters if a run dies before releasing it. */
export const RUN_LOCK_TTL_SECONDS = 120;

export const MAX_RUN_LOG_ENTRIES = 200;

/** The send phase of one check run stops after this long; chats not reached get their message on the next run. */
export const SIGNALS_SEND_BUDGET_MS = 20_000;

export const REDIS_KEYS = {
  /** Sorted set per coin: score = hour bucket start, member = "<sample ms>:<usd>". */
  hourly: (symbol: string) => `signals:hour:${symbol}`,
  /** Sorted set per coin: score = UTC day start, member = "<sample ms>:<usd>" (the day's last sample). */
  daily: (symbol: string) => `signals:day:${symbol}`,
  backfilled: (symbol: string) => `signals:bf:${symbol}`,
  backfillFailed: (symbol: string) => `signals:bf-fail:${symbol}`,
  /** Hash: chatId -> JSON array of watchlist symbols (a mirror of Postgres). */
  watchlists: 'signals:watch',
  /** Set of chatIds that turned proactive signals off. */
  disabled: 'signals:off',
  /** Hash: chatId -> JSON ChatSignalState. */
  sent: 'signals:sent',
  /** Hash per chat: "<symbol>:<verdict>:<day>" -> "<usd>:<ms>". */
  records: (chatId: string) => `signals:rec:${chatId}`,
  /** Sorted set: score = expiry ms, member = symbol. */
  extra: 'signals:extra',
  /** Hash per UTC day: "<chatId>|<kind>" -> count. */
  usage: (day: string) => `signals:use:${day}`,
  runLock: 'signals:run-lock',
  runs: 'signals:runs',
  lastHealthy: 'signals:last-healthy',
} as const;
