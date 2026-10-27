import { evaluateSignalsMonitor } from './signals-monitor';
import { SIGNALS_REMINDER_MS, SIGNALS_STALE_MS } from './signals.constants';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('evaluateSignalsMonitor', () => {
  it('stays quiet while runs are healthy and recent', () => {
    expect(evaluateSignalsMonitor(iso(T0), null, new Date(T0 + SIGNALS_STALE_MS - 1))).toBeNull();
  });

  it('never alarms when no healthy run was ever recorded (job not scheduled yet)', () => {
    expect(evaluateSignalsMonitor(null, null, new Date(T0 + 10 * SIGNALS_STALE_MS))).toBeNull();
  });

  it('says "down" once after 90 minutes without a healthy run (NFR07)', () => {
    const action = evaluateSignalsMonitor(iso(T0), null, new Date(T0 + SIGNALS_STALE_MS));
    expect(action).toEqual({
      kind: 'down',
      lastHealthyAt: iso(T0),
      silentForMs: SIGNALS_STALE_MS,
    });
  });

  it('does not repeat while the owner was told within 6 hours', () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    const now = new Date(T0 + SIGNALS_STALE_MS + SIGNALS_REMINDER_MS - 1);
    expect(evaluateSignalsMonitor(iso(T0), outage, now)).toBeNull();
  });

  it('reminds once the reminder window has passed', () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    const now = new Date(T0 + SIGNALS_STALE_MS + SIGNALS_REMINDER_MS);
    expect(evaluateSignalsMonitor(iso(T0), outage, now)).toMatchObject({
      kind: 'reminder',
      since: iso(T0),
    });
  });

  it('says "recovered" once a healthy run is recent again after the owner was told', () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    const healthyAgain = T0 + 4 * 60 * 60_000;
    const action = evaluateSignalsMonitor(
      iso(healthyAgain),
      outage,
      new Date(healthyAgain + 60_000),
    );
    expect(action).toEqual({
      kind: 'recovered',
      since: iso(T0),
      recoveredAt: iso(healthyAgain),
      downForMs: healthyAgain - T0,
    });
  });
});
