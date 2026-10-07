import { evaluateSignal } from './signal-evaluator';
import { PricePoint } from './interfaces/signal.interface';
import { DAY_MS, HOUR_MS } from './signals.constants';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

/** Hourly points over `days` days, `priceAt(hoursAgo)` gives each price. */
function history(days: number, priceAt: (hoursAgo: number) => number): PricePoint[] {
  const points: PricePoint[] = [];
  for (let h = days * 24; h >= 1; h--) {
    points.push({ t: NOW - h * HOUR_MS, p: priceAt(h) });
  }
  return points;
}

describe('evaluateSignal', () => {
  describe('strong swing (AC01)', () => {
    it('is strong on a 16% drop vs 24h ago', () => {
      const points = history(8, (h) => (h >= 24 ? 100_000 : 100_000));
      const result = evaluateSignal(points, 84_000, NOW);
      expect(result.strong).toBe(true);
      expect(result.change24hPct).toBeCloseTo(-16, 5);
      expect(result.direction).toBe('down');
      expect(result.window).toBe('24h');
    });

    it('is not strong at +7.5% / 24h and +11.1% / 72h', () => {
      const points = history(8, (h) => (h >= 72 ? 90_000 : h >= 24 ? 93_000 : 99_000));
      const result = evaluateSignal(points, 100_000, NOW);
      expect(result.change24hPct).toBeCloseTo(7.5, 1);
      expect(result.change72hPct).toBeCloseTo(11.1, 1);
      expect(result.strong).toBe(false);
      expect(result.verdict).toBeNull();
    });

    it('counts exactly 15% vs 72h ago as strong', () => {
      const points = history(8, (h) => (h === 72 ? 100_000 : h === 24 ? 112_000 : 110_000));
      const result = evaluateSignal(points, 115_000, NOW);
      expect(result.change72hPct).toBeCloseTo(15, 9);
      expect(result.strong).toBe(true);
      expect(result.window).toBe('72h');
    });

    it('picks the larger move when both windows trigger', () => {
      const points = history(8, (h) => (h >= 72 ? 120_000 : h >= 24 ? 100_000 : 95_000));
      const result = evaluateSignal(points, 90_000, NOW);
      expect(result.window).toBe('72h');
      expect(result.movePct).toBeCloseTo(-25, 5);
    });
  });

  describe('verdict from the 7-day range (AC02)', () => {
    // Range 80k-120k, 24h ago 100k.
    const rangeHistory = (): PricePoint[] => {
      const points = history(8, () => 100_000);
      points[points.length - 100] = { t: points[points.length - 100].t, p: 80_000 };
      points[points.length - 120] = { t: points[points.length - 120].t, p: 120_000 };
      return points;
    };

    it('buy near the bottom', () => {
      const result = evaluateSignal(rangeHistory(), 84_000, NOW);
      expect(result.positionPct).toBeCloseTo(10, 5);
      expect(result.verdict).toBe('buy');
    });

    it('sell near the top', () => {
      const result = evaluateSignal(rangeHistory(), 116_000, NOW);
      expect(result.positionPct).toBeCloseTo(90, 5);
      expect(result.verdict).toBe('sell');
    });

    it('watch in the middle', () => {
      const points = rangeHistory().map((point) => ({
        ...point,
        p: point.p === 100_000 ? 92_000 : point.p,
      }));
      const result = evaluateSignal(points, 100_000, NOW);
      expect(result.strong).toBe(true);
      expect(result.positionPct).toBeCloseTo(50, 5);
      expect(result.verdict).toBe('watch');
    });

    it('treats exactly 25% as buy', () => {
      const points = rangeHistory().map((point) => ({
        ...point,
        p: point.p === 100_000 ? 110_000 : point.p,
      }));
      const result = evaluateSignal(points, 90_000, NOW);
      expect(result.positionPct).toBeCloseTo(25, 9);
      expect(result.verdict).toBe('buy');
    });
  });

  it('gives no verdict for a mild move (AC03)', () => {
    const points = history(8, (h) => (h >= 72 ? 1_000 / 1.05 : h >= 24 ? 1_000 / 1.03 : 1_000));
    const result = evaluateSignal(points, 1_000, NOW);
    expect(result.strong).toBe(false);
    expect(result.verdict).toBeNull();
    expect(result.insufficientData).toBe(false);
  });

  it('reports insufficient data when history is under 7 days (AC11)', () => {
    const result = evaluateSignal(
      history(5, () => 100_000),
      80_000,
      NOW,
    );
    expect(result.insufficientData).toBe(true);
    expect(result.verdict).toBeNull();
    expect(result.strong).toBe(false);
  });

  it('reports insufficient data when no point is near 24h/72h ago', () => {
    const points: PricePoint[] = [
      { t: NOW - 8 * DAY_MS, p: 100_000 },
      { t: NOW - 6 * HOUR_MS, p: 100_000 },
    ];
    expect(evaluateSignal(points, 80_000, NOW).insufficientData).toBe(true);
  });

  it('tolerates a gap of up to 90 minutes around the reference time', () => {
    const points = history(8, () => 100_000).filter((p) => p.t !== NOW - 24 * HOUR_MS);
    const result = evaluateSignal(points, 80_000, NOW);
    expect(result.change24hPct).toBeCloseTo(-20, 5);
  });

  it('puts a flat range at the middle', () => {
    const result = evaluateSignal(
      history(8, () => 100_000),
      100_000,
      NOW,
    );
    expect(result.positionPct).toBe(50);
  });

  it('honours custom thresholds', () => {
    const points = history(8, () => 100_000);
    const result = evaluateSignal(points, 95_000, NOW, {
      swing24hPct: 5,
      swing72hPct: 10,
      bandPct: 25,
    });
    expect(result.strong).toBe(true);
  });
});
