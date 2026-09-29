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

/** Outcomes that can explain a stretch without healthy runs, as counted by the watcher (spec EPIC-002-FIX-FR04). */
export type OutageSignalKind = 'rejected' | 'no-price' | 'failed' | 'skipped';

/** What was seen during an outage: counts per kind. Empty means nothing called the check at all. */
export type OutageSignal = Partial<Record<OutageSignalKind, number>>;

/** An outage the watcher has noticed (≥ OUTAGE_THRESHOLD_MS without a healthy run). */
export interface OutageState {
  /** Start of the silence: the last healthy run, or the watcher's start if there never was one. */
  since: string;
  /** When the owner was last told about this outage; null until a message is actually delivered. */
  notifiedAt: string | null;
}

/** The watcher's own state, written on every watcher run (spec EPIC-002-FIX-FR03). */
export interface MonitorState {
  /** First watcher run: the baseline when no healthy run has ever been seen (spec EPIC-002-FIX-AC06). */
  watcherStartedAt: string;
  /** Latest watcher run — the heartbeat the check itself watches (spec EPIC-002-FIX-FR07). */
  lastWatcherRunAt: string;
  /** Newest healthy run seen so far, kept here because the run log window may no longer hold it. */
  lastHealthyAt: string | null;
  outage: OutageState | null;
  /** Whether OWNER_CHAT_ID was set on the last watcher run, for the report (spec EPIC-002-FIX-AC11). */
  ownerChatConfigured?: boolean;
}

/** The check's view of the watcher (spec EPIC-002-FIX-FR07): an outage of the watcher itself. */
export interface WatchdogState {
  outage: OutageState | null;
}

/** A message the monitor sends the owner. */
export type MonitorAction =
  | {
      kind: 'down' | 'reminder';
      /** null: no healthy run since the watcher started (spec EPIC-002-FIX-AC06). */
      lastHealthyAt: string | null;
      since: string;
      downForMs: number;
      signal: OutageSignal;
    }
  | { kind: 'recovered'; since: string; recoveredAt: string; downForMs: number }
  | { kind: 'watcher-down'; lastWatcherRunAt: string; silentForMs: number }
  | { kind: 'watcher-recovered'; since: string; recoveredAt: string; silentForMs: number };

/**
 * Result of one evaluation. The state to persist depends on whether the
 * owner actually got the message: "notified" is only ever stored after a
 * delivered send (spec EPIC-002-FIX-AC10).
 */
export interface MonitorDecision<S> {
  action: MonitorAction | null;
  onSent: S;
  onNotSent: S;
}

/** One owner notification attempt, kept for the report (spec EPIC-002-FIX-FR09d, NFR10). */
export interface MonitorNotice {
  kind: MonitorAction['kind'] | 'state-unreadable';
  at: string;
  delivered: boolean;
}

/**
 * Which owner message a hold covers (spec EPIC-002-FIX-NFR05). Each kind has
 * its own hold, so holding one message never delays another: a "can't read
 * state" notice doesn't hold back a real "down" or "recovered" (NFR01).
 * "down" and its 6-hourly "reminder" share one.
 */
export type NoticeHoldKind =
  'state-unreadable' | 'outage' | 'recovered' | 'watcher-down' | 'watcher-recovered';

/**
 * A held message: sent at `at`, about the outage that began at `since`
 * (absent for "state-unreadable"). A hold only covers the same outage, so a
 * new outage within the hour is still reported.
 */
export interface NoticeHold {
  at: string;
  since?: string;
}
