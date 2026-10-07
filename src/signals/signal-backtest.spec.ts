import { runBacktest, scoreRecords } from './signal-backtest';
import { PricePoint, SignalRecord } from './interfaces/signal.interface';
import { DAY_MS, HOUR_MS } from './signals.constants';

const flat = (n: number, price = 100): number[] => Array(n).fill(price);

/** Eight flat days, a 16% drop held three days, then a close that is right (90) or wrong (80) for a buy. */
function buyBlock(right: boolean): number[] {
  return [
    ...flat(8),
    84,
    84,
    84,
    ...(right ? [90, 92, 94, 96, 98, 100] : [80, 83, 86, 89, 92, 95, 98, 100]),
  ];
}

/** Eight flat days, an 18% jump held three days, then a close that is right (110) or wrong (125) for a sell. */
function sellBlock(right: boolean): number[] {
  return [
    ...flat(8),
    118,
    118,
    118,
    ...(right ? [110, 108, 106, 104, 102, 100] : [125, 120, 115, 110, 105, 100]),
  ];
}

describe('runBacktest', () => {
  it('counts 6 buys (4 right) and 5 sells (2 right), merging consecutive days (AC12)', () => {
    const closes = [
      ...buyBlock(true),
      ...sellBlock(true),
      ...buyBlock(true),
      ...sellBlock(false),
      ...buyBlock(false),
      ...sellBlock(true),
      ...buyBlock(true),
      ...sellBlock(false),
      ...buyBlock(false),
      ...sellBlock(false),
      ...buyBlock(true),
    ];

    const result = runBacktest(closes);

    expect(result.insufficient).toBe(false);
    expect(result.days).toBe(closes.length);
    expect(result.buy).toEqual({ scored: 6, correct: 4 });
    expect(result.sell).toEqual({ scored: 5, correct: 2 });
  });

  it('leaves out a signal that is under 3 days old', () => {
    const closes = [...flat(10), 84, 84];
    const result = runBacktest(closes);
    expect(result.buy.scored).toBe(0);
  });

  it('refuses a history under 14 days', () => {
    const result = runBacktest(flat(13));
    expect(result.insufficient).toBe(true);
    expect(result.days).toBe(13);
    expect(result.buy.scored + result.sell.scored).toBe(0);
  });

  it('is deterministic', () => {
    const closes = [...buyBlock(true), ...sellBlock(false)];
    expect(runBacktest(closes)).toEqual(runBacktest(closes));
  });
});

describe('scoreRecords', () => {
  const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
  const history = (price: number): Record<string, PricePoint[]> => ({
    btc: [
      { t: T0 + 1 * DAY_MS, p: 85_000 },
      { t: T0 + 3 * DAY_MS + HOUR_MS, p: price },
    ],
  });
  const buy: SignalRecord = { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: T0 };

  it('scores a buy as right when the price 3 days later is higher (AC13)', () => {
    const card = scoreRecords([buy], history(90_000), T0 + 4 * DAY_MS);
    expect(card.buy).toEqual({ scored: 1, correct: 1 });
    expect(card.pending).toBe(0);
  });

  it('scores a buy as wrong when the price is lower', () => {
    const card = scoreRecords([buy], history(80_000), T0 + 4 * DAY_MS);
    expect(card.buy).toEqual({ scored: 1, correct: 0 });
  });

  it('scores a sell as right when the price is lower', () => {
    const sell: SignalRecord = { ...buy, verdict: 'sell', priceUsd: 95_000 };
    const card = scoreRecords([sell], history(90_000), T0 + 4 * DAY_MS);
    expect(card.sell).toEqual({ scored: 1, correct: 1 });
  });

  it('keeps a verdict pending before 3 days, and when no later price exists', () => {
    expect(scoreRecords([buy], history(90_000), T0 + 2 * DAY_MS).pending).toBe(1);
    expect(scoreRecords([buy], { btc: [{ t: T0 + DAY_MS, p: 1 }] }, T0 + 5 * DAY_MS).pending).toBe(
      1,
    );
  });

  it('counts the same coin, verdict and day once', () => {
    const again: SignalRecord = { ...buy, at: T0 + 2 * HOUR_MS };
    const card = scoreRecords([buy, again], history(90_000), T0 + 4 * DAY_MS);
    expect(card.buy.scored).toBe(1);
  });
});
