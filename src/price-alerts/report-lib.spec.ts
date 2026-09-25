// The report is a plain Node script (scripts/), tested from here so it runs under `npm test`.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const lib = require('../../scripts/price-alerts-report.lib');

const T = Date.parse('2026-09-25T00:00:00.000Z');
const min = (n: number) => n * 60_000;

function run(offsetMs: number, outcome?: string) {
  return {
    startedAt: new Date(T + offsetMs).toISOString(),
    ...(outcome ? { outcome } : {}),
    durationMs: 500,
    fired: 0,
    failed: 0,
    rearmed: 0,
    deferred: 0,
  };
}

/** Healthy runs every minute over [fromMin, toMin). */
function healthyEveryMinute(fromMin: number, toMin: number) {
  return Array.from({ length: toMin - fromMin }, (_, i) => run(min(fromMin + i), 'healthy'));
}

describe('price-alerts report lib (EPIC-002-FIX-FR09)', () => {
  it('finds one 52-minute outage made of "not called" then "rejected" (FIX-AC14)', () => {
    // 0..9 healthy, then 32 min with nothing, then 20 min of rejected calls, then healthy again.
    const lastHealthyBefore = 9;
    const runs = [...healthyEveryMinute(0, 10), ...healthyEveryMinute(61, 70)];
    const rejected = new Map<number, number>();
    for (let m = lastHealthyBefore + 32; m < lastHealthyBefore + 52; m++) {
      rejected.set(T + min(m), 1);
    }

    const outages = lib.buildOutages(runs, rejected, T, T + min(70));

    expect(outages).toHaveLength(1);
    expect(outages[0]).toMatchObject({
      start: T + min(9),
      end: T + min(61),
      durationMs: min(52),
      ongoing: false,
      notCalled: true,
      counts: { rejected: 20, 'no-price': 0, failed: 0, skipped: 0 },
    });
  });

  it('reports an outage made only of rejected calls without "not called"', () => {
    const runs = [...healthyEveryMinute(0, 1), ...healthyEveryMinute(21, 22)];
    const rejected = new Map<number, number>();
    for (let m = 1; m < 21; m++) rejected.set(T + min(m), 3);

    const [outage] = lib.buildOutages(runs, rejected, T, T + min(22));

    expect(outage.notCalled).toBe(false);
    expect(outage.counts.rejected).toBe(60);
  });

  it('marks an outage still open at the end of the window as ongoing, and ignores short gaps', () => {
    const runs = [
      ...healthyEveryMinute(0, 5),
      ...healthyEveryMinute(15, 20), // 10-minute gap: not an outage
      run(min(25), 'no-price'),
    ];

    const outages = lib.buildOutages(runs, new Map(), T, T + min(60));

    expect(outages).toHaveLength(1);
    expect(outages[0]).toMatchObject({ start: T + min(19), ongoing: true });
    expect(outages[0].counts['no-price']).toBe(1);
  });

  it('computes AC18 gaps over healthy runs only, reading pre-FIX runs as healthy', () => {
    const runs = [run(0), run(min(1)), run(min(1) + 1000, 'skipped'), run(min(2), 'healthy')];

    const stats = lib.healthyStats(runs);

    expect(stats.count).toBe(3);
    expect(stats.gapP95).toBe(min(1));
    expect(stats.lastHealthyAt).toBe(T + min(2));
  });

  it('counts outcomes and flattens per-day rejection hashes', () => {
    const rejected = lib.flattenRejections({
      '2026-09-25': { '23:59': 2 },
      '2026-09-26': { '00:00': '3' },
    });
    expect(rejected.get(Date.parse('2026-09-26T00:00:00.000Z'))).toBe(3);

    expect(lib.countOutcomes([run(0), run(1, 'failed')], rejected)).toEqual({
      healthy: 1,
      'no-price': 0,
      failed: 1,
      skipped: 0,
      rejected: 5,
    });
  });
});
