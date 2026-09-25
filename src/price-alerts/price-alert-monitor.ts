import {
  AlertRunSummary,
  MonitorDecision,
  MonitorState,
  OutageSignal,
  WatchdogState,
} from './interfaces/price-alert.interface';
import {
  OUTAGE_REMINDER_MS,
  OUTAGE_THRESHOLD_MS,
  WATCHER_SILENCE_MS,
} from './price-alerts.constants';

/**
 * The monitoring rules of EPIC-002-FIX as pure functions of (state, runs,
 * now), so every threshold is unit-tested with a fake clock and no mocks —
 * the same split as evaluateAlert() for the alerts themselves.
 *
 * Both evaluators return the state to store for either delivery outcome:
 * a message only counts as sent once Zalo accepted it (spec AC10).
 */

/** Runs logged before EPIC-002-FIX have no outcome; only completed runs were logged then. */
export function isHealthyRun(run: AlertRunSummary): boolean {
  return (run.outcome ?? 'healthy') === 'healthy';
}

/** Newest healthy run start in `runs` (any order), or null. */
export function latestHealthyAt(runs: AlertRunSummary[]): string | null {
  let latest: number | null = null;
  for (const run of runs) {
    const at = Date.parse(run.startedAt);
    if (isHealthyRun(run) && !Number.isNaN(at) && (latest === null || at > latest)) {
      latest = at;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * What was seen after `since` (spec EPIC-002-FIX-FR04, AC09): the non-healthy
 * runs by outcome, plus the rejected calls the guard counted in that time.
 * An empty result means nothing reached the check at all.
 */
export function classifySignal(
  runs: AlertRunSummary[],
  since: string,
  rejectedCount: number,
): OutageSignal {
  const sinceMs = Date.parse(since);
  const signal: OutageSignal = {};
  for (const run of runs) {
    if (isHealthyRun(run) || !(Date.parse(run.startedAt) > sinceMs)) continue;
    const kind = run.outcome as Exclude<AlertRunSummary['outcome'], 'healthy' | undefined>;
    signal[kind] = (signal[kind] ?? 0) + 1;
  }
  if (rejectedCount > 0) {
    signal.rejected = rejectedCount;
  }
  return signal;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * One watcher run (spec EPIC-002-FIX-FR03–FR06). `recentRuns` is the newest
 * slice of the run log; `rejectedSince` counts rejected calls since a given
 * moment, and is only consulted when a message is about to be sent.
 */
export function evaluateMonitor(
  state: MonitorState | null,
  recentRuns: AlertRunSummary[],
  now: Date,
  rejectedSince: (since: string) => number,
): MonitorDecision<MonitorState> {
  const nowIso = now.toISOString();
  const watcherStartedAt = state?.watcherStartedAt ?? nowIso;
  const lastHealthyAt = later(state?.lastHealthyAt ?? null, latestHealthyAt(recentRuns));
  const base: MonitorState = {
    watcherStartedAt,
    lastWatcherRunAt: nowIso,
    lastHealthyAt,
    outage: state?.outage ?? null,
  };
  const none = (next: MonitorState): MonitorDecision<MonitorState> => ({
    action: null,
    onSent: next,
    onNotSent: next,
  });

  const outage = base.outage;
  const healthySinceOutage =
    outage !== null &&
    lastHealthyAt !== null &&
    Date.parse(lastHealthyAt) > Date.parse(outage.since);
  if (outage && healthySinceOutage) {
    const cleared = { ...base, outage: null };
    // An outage the owner never heard about ends silently (spec EPIC-002-FIX-FR06).
    if (outage.notifiedAt === null) return none(cleared);
    return {
      action: {
        kind: 'recovered',
        since: outage.since,
        recoveredAt: lastHealthyAt!,
        downForMs: Date.parse(lastHealthyAt!) - Date.parse(outage.since),
      },
      onSent: cleared,
      // Kept, so the next watcher run retries the recovery message.
      onNotSent: base,
    };
  }

  // Silence is measured from the later of the last healthy run and the
  // watcher's own start: "never healthy" still alerts (spec AC06), and a
  // freshly started watcher doesn't alert on history it never saw.
  const since = later(lastHealthyAt, watcherStartedAt)!;
  const downForMs = now.getTime() - Date.parse(since);
  if (downForMs < OUTAGE_THRESHOLD_MS) {
    return none({ ...base, outage: null });
  }

  const current = outage ?? { since, notifiedAt: null };
  const dueKind =
    current.notifiedAt === null
      ? 'down'
      : now.getTime() - Date.parse(current.notifiedAt) >= OUTAGE_REMINDER_MS
        ? 'reminder'
        : null;
  const unsent = { ...base, outage: current };
  if (dueKind === null) return none(unsent);

  return {
    action: {
      kind: dueKind,
      lastHealthyAt,
      since: current.since,
      downForMs: now.getTime() - Date.parse(current.since),
      signal: classifySignal(recentRuns, current.since, rejectedSince(current.since)),
    },
    onSent: { ...base, outage: { ...current, notifiedAt: nowIso } },
    onNotSent: unsent,
  };
}

/**
 * The check's watch over the watcher (spec EPIC-002-FIX-FR07), run by the
 * per-minute check every few minutes. A watcher that never ran (not set up
 * yet) is not an outage — no alarm between deploy and scheduling it.
 */
export function evaluateWatchdog(
  state: WatchdogState | null,
  lastWatcherRunAt: string | null,
  now: Date,
): MonitorDecision<WatchdogState> {
  const outage = state?.outage ?? null;
  const none = (next: WatchdogState): MonitorDecision<WatchdogState> => ({
    action: null,
    onSent: next,
    onNotSent: next,
  });
  if (lastWatcherRunAt === null) return none({ outage: null });

  if (outage && Date.parse(lastWatcherRunAt) > Date.parse(outage.since)) {
    if (outage.notifiedAt === null) return none({ outage: null });
    return {
      action: {
        kind: 'watcher-recovered',
        since: outage.since,
        recoveredAt: lastWatcherRunAt,
        silentForMs: Date.parse(lastWatcherRunAt) - Date.parse(outage.since),
      },
      onSent: { outage: null },
      onNotSent: { outage },
    };
  }

  const silentForMs = now.getTime() - Date.parse(lastWatcherRunAt);
  if (silentForMs < WATCHER_SILENCE_MS) return none({ outage: null });

  const current = outage ?? { since: lastWatcherRunAt, notifiedAt: null };
  const due =
    current.notifiedAt === null ||
    now.getTime() - Date.parse(current.notifiedAt) >= OUTAGE_REMINDER_MS;
  if (!due) return none({ outage: current });

  return {
    action: { kind: 'watcher-down', lastWatcherRunAt, silentForMs },
    onSent: { outage: { ...current, notifiedAt: now.toISOString() } },
    onNotSent: { outage: current },
  };
}
