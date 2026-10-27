import { SignalsMonitorAction, SignalsOutage } from './interfaces/signal.interface';
import { SIGNALS_REMINDER_MS, SIGNALS_STALE_MS } from './signals.constants';

/**
 * The rule for telling the owner the signals check stopped (spec
 * EPIC-004-NFR07). Pure, so every threshold is unit-tested with a fake
 * clock. `lastHealthyAt` is the last healthy run, `outage` what the owner
 * was last told.
 *
 * - no healthy run for SIGNALS_STALE_MS -> "down", once; then one reminder
 *   per SIGNALS_REMINDER_MS while it lasts
 * - healthy again after the owner was told -> "recovered", once
 * - never healthy (the job is not scheduled yet) is not an outage: no alarm
 *   between the deploy and the first scheduled run
 */
export function evaluateSignalsMonitor(
  lastHealthyAt: string | null,
  outage: SignalsOutage | null,
  now: Date,
): SignalsMonitorAction | null {
  if (lastHealthyAt === null) return null;
  const silentForMs = now.getTime() - Date.parse(lastHealthyAt);

  if (silentForMs < SIGNALS_STALE_MS) {
    if (!outage) return null;
    return {
      kind: 'recovered',
      since: outage.since,
      recoveredAt: lastHealthyAt,
      downForMs: Date.parse(lastHealthyAt) - Date.parse(outage.since),
    };
  }

  if (!outage) return { kind: 'down', lastHealthyAt, silentForMs };
  if (now.getTime() - Date.parse(outage.notifiedAt) >= SIGNALS_REMINDER_MS) {
    return { kind: 'reminder', since: outage.since, lastHealthyAt, silentForMs };
  }
  return null;
}
