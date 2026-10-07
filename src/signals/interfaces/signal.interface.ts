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

/** What a chat was last told, kept to enforce spec EPIC-004-FR05 and FR06. */
export interface ChatSignalState {
  /** Epoch ms of the last proactive signal message; null when none. */
  lastSentAt: number | null;
  /** Per coin symbol: what the last message said. */
  coins: Record<string, { sentAt: number; direction: SwingDirection; movePct: number }>;
}

export interface CoinSignal {
  symbol: string;
  result: SignalResult;
}

/** A buy/sell verdict that was actually sent to a chat (spec EPIC-004-FR11). */
export interface SignalRecord {
  symbol: string;
  verdict: 'buy' | 'sell';
  priceUsd: number;
  /** Epoch ms the verdict was given. */
  at: number;
}

export interface VerdictTally {
  /** Signals old enough to be scored. */
  scored: number;
  correct: number;
}

export interface BacktestResult {
  /** True when the history is too short to backtest; the tallies are empty. */
  insufficient: boolean;
  /** Days of history actually used. */
  days: number;
  buy: VerdictTally;
  sell: VerdictTally;
}

export interface Scorecard {
  buy: VerdictTally;
  sell: VerdictTally;
  /** Verdicts not yet 3 days old (or with no later price to score against). */
  pending: number;
}
