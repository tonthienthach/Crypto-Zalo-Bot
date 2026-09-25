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
  /** Failed send attempts in a row; reset to 0 on success. Absent on older records. */
  consecutiveFailures?: number;
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

/**
 * How one authenticated call to the alert check ended (spec EPIC-002-FIX-FR02):
 * - `healthy`: ran to completion and, when alerts exist, priced at least one of them
 * - `no-price`: ran to completion, but the price source returned nothing for any alert
 * - `failed`: an unhandled error ended the run
 * - `skipped`: another run still held the lock
 * Calls rejected by the secret guard never reach the handler; they are counted
 * separately (see PriceAlertsService.recordRejections).
 */
export type RunOutcome = 'healthy' | 'no-price' | 'failed' | 'skipped';

/** Per-run metrics for the alert check (spec EPIC-002-NFR08). */
export interface AlertRunSummary {
  startedAt: string;
  /** Absent on runs logged before EPIC-002-FIX, which only logged completed runs: read those as `healthy`. */
  outcome?: RunOutcome;
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
