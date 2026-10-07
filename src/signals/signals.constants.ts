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
