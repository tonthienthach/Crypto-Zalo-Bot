/** One stored price sample: epoch milliseconds and USD price. */
export interface PricePoint {
  t: number;
  p: number;
}

export type Verdict = 'buy' | 'sell' | 'watch';

export type SwingDirection = 'up' | 'down';

export interface SignalThresholds {
  swing24hPct: number;
  swing72hPct: number;
  bandPct: number;
}

export interface SignalResult {
  /** True when the history does not cover MIN_HISTORY_DAYS; no verdict is given. */
  insufficientData: boolean;
  /** Signed percent change vs 24h ago; null when no stored point is close enough. */
  change24hPct: number | null;
  change72hPct: number | null;
  /** Strong swing (spec EPIC-004-FR01). */
  strong: boolean;
  /** Direction of the dominant triggered change; null when not strong. */
  direction: SwingDirection | null;
  /** Signed percent of the dominant triggered change; null when not strong. */
  movePct: number | null;
  /** Which window triggered (the larger |change| when both did); null when not strong. */
  window: '24h' | '72h' | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  /** Position of the current price in the 7-day range, 0 (low) to 100 (high). */
  positionPct: number | null;
  /** buy / sell / watch for strong swings only; null otherwise. */
  verdict: Verdict | null;
  priceUsd: number;
}
