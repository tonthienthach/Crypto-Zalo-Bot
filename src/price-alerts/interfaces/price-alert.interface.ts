export type AlertDirection = 'above' | 'below';

/** `armed`: waiting for the price to cross; `fired`: already notified, waiting to re-arm. */
export type AlertState = 'armed' | 'fired';

export interface PriceAlert {
  id: number;
  chatId: string;
  /** Lowercase ticker symbol, as accepted by `/gia` (e.g. "btc"). */
  symbol: string;
  direction: AlertDirection;
  /** USD price level. */
  threshold: number;
  state: AlertState;
  /** ISO timestamp of the last successful notification, or null if never fired. */
  lastFiredAt: string | null;
  /** ISO timestamp of the last failed send attempt; cleared on success. Absent on older records. */
  lastFailedAt?: string | null;
  createdAt: string;
}

/** One attempted alert notification, kept for the success metric (spec EPIC-002-FR12). */
export interface AlertDelivery {
  alertId: number;
  chatId: string;
  symbol: string;
  direction: AlertDirection;
  threshold: number;
  priceUsd: number;
  delivered: boolean;
  attemptedAt: string;
}

/** Per-run metrics for the alert check (spec EPIC-002-NFR08). */
export interface AlertRunSummary {
  startedAt: string;
  evaluated: number;
  fired: number;
  failed: number;
  rearmed: number;
  /** Due alerts not sent this run because the send budget ran out; they stay armed for the next run. */
  deferred: number;
  durationMs: number;
  /** Signed ms from the nearest minute boundary: -100 means 100ms early, +2000 means 2s late. */
  driftMs: number;
}
