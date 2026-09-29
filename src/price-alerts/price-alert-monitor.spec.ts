import {
  AlertRunSummary,
  MonitorState,
  RunOutcome,
  WatchdogState,
} from './interfaces/price-alert.interface';
import {
  classifySignal,
  evaluateMonitor,
  evaluateWatchdog,
  latestHealthyAt,
} from './price-alert-monitor';

const T = Date.parse('2026-09-25T03:00:00.000Z');
const min = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

function run(offsetMs: number, outcome?: RunOutcome): AlertRunSummary {
  return {
    startedAt: iso(offsetMs),
    ...(outcome ? { outcome } : {}),
    evaluated: 0,
    fired: 0,
    failed: 0,
    rearmed: 0,
    deferred: 0,
    durationMs: 500,
    driftMs: 0,
  };
}

function state(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    watcherStartedAt: iso(-min(60)),
    lastWatcherRunAt: iso(-min(5)),
    lastHealthyAt: iso(0),
    outage: null,
    ...overrides,
  };
}

const noRejections = () => 0;

describe('latestHealthyAt / classifySignal', () => {
  it('treats runs logged before EPIC-002-FIX (no outcome) as healthy', () => {
    expect(latestHealthyAt([run(0), run(min(1), 'failed')])).toBe(iso(0));
    expect(latestHealthyAt([run(min(1), 'no-price')])).toBeNull();
  });

  it('names what was seen after the last healthy run, with counts (FIX-AC09)', () => {
    const runs = [run(0, 'healthy'), run(min(1), 'no-price'), run(min(2), 'no-price')];
    expect(classifySignal(runs, iso(0), 0)).toEqual({ 'no-price': 2 });
    expect(classifySignal([], iso(0), 20)).toEqual({ rejected: 20 });
    expect(classifySignal([run(0, 'healthy')], iso(0), 0)).toEqual({});
    expect(classifySignal([run(min(3), 'failed'), run(min(4), 'skipped')], iso(0), 3)).toEqual({
      failed: 1,
      skipped: 1,
      rejected: 3,
    });
  });
});

describe('evaluateMonitor', () => {
  it('stays quiet at T+14 and sends one full "down" message in [T+15, T+20] (FIX-AC05)', () => {
    expect(evaluateMonitor(state(), [run(0)], at(min(14)), noRejections).action).toBeNull();

    for (const offset of [min(15), min(20)]) {
      const decision = evaluateMonitor(state(), [run(0)], at(offset), noRejections);
      expect(decision.action).toEqual({
        kind: 'down',
        lastHealthyAt: iso(0),
        since: iso(0),
        downForMs: offset,
        signal: {},
      });
      expect(decision.onSent.outage).toEqual({ since: iso(0), notifiedAt: iso(offset) });
      expect(decision.onNotSent.outage).toEqual({ since: iso(0), notifiedAt: null });
    }
  });

  it('alerts with "never" when there was no healthy run since the watcher started (FIX-AC06)', () => {
    // First watcher run at S: nothing to report yet.
    const first = evaluateMonitor(null, [run(0, 'no-price')], at(0), noRejections);
    expect(first.action).toBeNull();
    expect(first.onSent.watcherStartedAt).toBe(iso(0));

    const decision = evaluateMonitor(first.onSent, [], at(min(20)), noRejections);
    expect(decision.action).toMatchObject({ kind: 'down', lastHealthyAt: null, since: iso(0) });
  });

  it('does not alert a fresh watcher on history it never saw', () => {
    const decision = evaluateMonitor(null, [run(-min(120))], at(0), noRejections);
    expect(decision.action).toBeNull();
    expect(decision.onSent.lastHealthyAt).toBe(iso(-min(120)));
  });

  it('keeps retrying the "down" message until it is delivered (FIX-AC10)', () => {
    const first = evaluateMonitor(state(), [run(0)], at(min(16)), noRejections);
    const retry = evaluateMonitor(first.onNotSent, [], at(min(21)), noRejections);
    expect(retry.action).toMatchObject({ kind: 'down', since: iso(0), downForMs: min(21) });
  });

  it('sends nothing more for 6h after a delivered message, then one reminder (FIX-AC07)', () => {
    let current = evaluateMonitor(state(), [run(0)], at(min(15)), noRejections).onSent;
    const notifiedAt = min(15);
    for (const offset of [min(60), min(5 * 60 + 59)]) {
      const decision = evaluateMonitor(current, [], at(notifiedAt + offset), noRejections);
      expect(decision.action).toBeNull();
      current = decision.onSent;
    }
    const reminder = evaluateMonitor(current, [], at(notifiedAt + min(6 * 60)), noRejections);
    expect(reminder.action).toMatchObject({
      kind: 'reminder',
      since: iso(0),
      downForMs: notifiedAt + min(6 * 60),
    });
  });

  it('sends one "recovered" message after a notified outage, then nothing (FIX-AC08)', () => {
    const down = evaluateMonitor(state(), [run(0)], at(min(20)), noRejections).onSent;
    const recovered = evaluateMonitor(down, [run(min(40))], at(min(42)), noRejections);
    expect(recovered.action).toEqual({
      kind: 'recovered',
      since: iso(0),
      recoveredAt: iso(min(40)),
      downForMs: min(40),
    });
    expect(recovered.onSent.outage).toBeNull();
    // Not delivered: the outage is kept so the next run retries the message.
    expect(recovered.onNotSent.outage).not.toBeNull();

    const after = evaluateMonitor(recovered.onSent, [run(min(46))], at(min(47)), noRejections);
    expect(after.action).toBeNull();
  });

  it('dates the recovery at the FIRST healthy run after the outage, not the newest (verify finding #4)', () => {
    const down = evaluateMonitor(state(), [run(0)], at(min(20)), noRejections).onSent;
    // The watcher runs at 35: healthy runs at 31..34 since the check came back at 31.
    const runs = [run(min(34)), run(min(33)), run(min(32)), run(min(31)), run(min(29), 'failed')];

    const recovered = evaluateMonitor(down, runs, at(min(35)), noRejections);

    expect(recovered.action).toEqual({
      kind: 'recovered',
      since: iso(0),
      recoveredAt: iso(min(31)),
      downForMs: min(31),
    });
    // The state still remembers the newest healthy run.
    expect(recovered.onSent.lastHealthyAt).toBe(iso(min(34)));
  });

  it('falls back to the newest healthy run when the first one left the window', () => {
    const down = evaluateMonitor(state(), [run(0)], at(min(20)), noRejections).onSent;
    const stored = { ...down, lastHealthyAt: iso(min(50)) };

    const recovered = evaluateMonitor(stored, [], at(min(55)), noRejections);

    expect(recovered.action).toMatchObject({ kind: 'recovered', recoveredAt: iso(min(50)) });
  });

  it('sends nothing for a 10-minute gap that recovers, or for an unnotified outage (FIX-AC08)', () => {
    const gap = evaluateMonitor(state(), [run(min(10))], at(min(11)), noRejections);
    expect(gap.action).toBeNull();

    const neverSent = evaluateMonitor(state(), [run(0)], at(min(20)), noRejections).onNotSent;
    const back = evaluateMonitor(neverSent, [run(min(25))], at(min(26)), noRejections);
    expect(back.action).toBeNull();
    expect(back.onSent.outage).toBeNull();
  });

  it('does not flap around the threshold: one outage ends only on a healthy run', () => {
    const down = evaluateMonitor(state(), [run(0)], at(min(15)), noRejections).onSent;
    const stillDown = evaluateMonitor(down, [run(min(16), 'no-price')], at(min(20)), noRejections);
    expect(stillDown.action).toBeNull();
    expect(stillDown.onSent.outage?.since).toBe(iso(0));
  });

  it('reports rejected calls since the outage began (FIX-AC09)', () => {
    const rejectedSince = jest.fn().mockReturnValue(18);
    const decision = evaluateMonitor(state(), [], at(min(20)), rejectedSince);
    expect(rejectedSince).toHaveBeenCalledWith(iso(0));
    expect(decision.action).toMatchObject({ kind: 'down', signal: { rejected: 18 } });
  });

  it('only counts rejections when a message is due', () => {
    const rejectedSince = jest.fn().mockReturnValue(5);
    evaluateMonitor(state(), [run(0)], at(min(5)), rejectedSince);
    expect(rejectedSince).not.toHaveBeenCalled();
  });

  it('records its heartbeat on every run (FIX-FR07)', () => {
    const decision = evaluateMonitor(state(), [run(0)], at(min(1)), noRejections);
    expect(decision.onSent.lastWatcherRunAt).toBe(iso(min(1)));
    expect(decision.onNotSent.lastWatcherRunAt).toBe(iso(min(1)));
  });
});

describe('evaluateWatchdog', () => {
  const quiet: WatchdogState = { outage: null };

  it('raises no alarm for a watcher that never ran (not set up yet)', () => {
    expect(evaluateWatchdog(null, null, at(min(600))).action).toBeNull();
  });

  it('alerts once the watcher is silent 30 minutes, and by W+35 at the latest (FIX-AC13)', () => {
    expect(evaluateWatchdog(quiet, iso(0), at(min(29))).action).toBeNull();
    const down = evaluateWatchdog(quiet, iso(0), at(min(35)));
    expect(down.action).toEqual({
      kind: 'watcher-down',
      lastWatcherRunAt: iso(0),
      silentForMs: min(35),
    });
    expect(down.onSent.outage).toEqual({ since: iso(0), notifiedAt: iso(min(35)) });
    expect(down.onNotSent.outage).toEqual({ since: iso(0), notifiedAt: null });
  });

  it('follows the 6h reminder rule while the watcher stays silent', () => {
    const down = evaluateWatchdog(quiet, iso(0), at(min(30))).onSent;
    expect(evaluateWatchdog(down, iso(0), at(min(30 + 5 * 60))).action).toBeNull();
    expect(evaluateWatchdog(down, iso(0), at(min(30 + 6 * 60))).action?.kind).toBe('watcher-down');
  });

  it('sends one "recovered" message when the watcher runs again (FIX-AC13)', () => {
    const down = evaluateWatchdog(quiet, iso(0), at(min(35))).onSent;
    const back = evaluateWatchdog(down, iso(min(50)), at(min(51)));
    expect(back.action).toEqual({
      kind: 'watcher-recovered',
      since: iso(0),
      recoveredAt: iso(min(50)),
      silentForMs: min(50),
    });
    expect(back.onSent.outage).toBeNull();
    expect(evaluateWatchdog(back.onSent, iso(min(55)), at(min(56))).action).toBeNull();
  });

  it('ends an unnotified watcher outage silently', () => {
    const unsent = evaluateWatchdog(quiet, iso(0), at(min(35))).onNotSent;
    const back = evaluateWatchdog(unsent, iso(min(40)), at(min(41)));
    expect(back.action).toBeNull();
    expect(back.onSent.outage).toBeNull();
  });
});
