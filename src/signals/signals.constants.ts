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
