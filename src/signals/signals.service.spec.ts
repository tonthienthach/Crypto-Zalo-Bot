import { ConfigService } from '@nestjs/config';
import { CoingeckoService, CoingeckoUnavailableError } from '../coingecko/coingecko.service';
import { PricePoint } from './interfaces/signal.interface';
import { SignalsHistoryService } from './signals-history.service';
import { SignalsStateService } from './signals-state.service';
import { SignalsService } from './signals.service';
import { DAY_MS, HOUR_MS } from './signals.constants';

const NOW = Date.UTC(2026, 9, 7, 12, 20, 0);

function hourly(days: number, price: (hoursAgo: number) => number): PricePoint[] {
  const points: PricePoint[] = [];
  for (let h = days * 24; h >= 1; h--) points.push({ t: NOW - h * HOUR_MS, p: price(h) });
  return points;
}

describe('SignalsService', () => {
  const getPricesBySymbols = jest.fn();
  const getMarketChart = jest.fn();
  const resolveSymbolToId = jest.fn((symbol: string) => symbol);
  const snapshot = jest.fn().mockResolvedValue(undefined);
  const backfill = jest.fn().mockResolvedValue([]);
  const loadHourly = jest.fn();
  const loadDaily = jest.fn();
  const trackExtra = jest.fn();
  const listRecords = jest.fn();
  const recordVerdicts = jest.fn().mockResolvedValue(undefined);
  let service: SignalsService;

  beforeEach(() => {
    jest.clearAllMocks();
    snapshot.mockResolvedValue(undefined);
    backfill.mockResolvedValue([]);
    recordVerdicts.mockResolvedValue(undefined);
    service = new SignalsService(
      { get: () => undefined } as unknown as ConfigService,
      { getPricesBySymbols, getMarketChart, resolveSymbolToId } as unknown as CoingeckoService,
      { snapshot, backfill, loadHourly, loadDaily } as unknown as SignalsHistoryService,
      { trackExtra, listRecords, recordVerdicts } as unknown as SignalsStateService,
    );
  });

  describe('getSignalsForSymbols', () => {
    it('looks prices up once, saves the sample, backfills, and evaluates each coin', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', priceUsd: 84_000 },
        { id: 'ethereum', symbol: 'eth', priceUsd: 2_500 },
      ]);
      loadHourly.mockResolvedValue({
        btc: hourly(8, () => 100_000),
        eth: hourly(8, () => 2_500),
      });

      const signals = await service.getSignalsForSymbols(['btc', 'eth'], NOW);

      expect(getPricesBySymbols).toHaveBeenCalledTimes(1);
      expect(snapshot).toHaveBeenCalledWith({ btc: 84_000, eth: 2_500 }, NOW);
      expect(backfill).toHaveBeenCalledWith(['btc', 'eth'], NOW);
      expect(signals.map((s) => [s.symbol, s.result.strong])).toEqual([
        ['btc', true],
        ['eth', false],
      ]);
      expect(signals[0].result.verdict).toBe('buy');
    });

    it('leaves out a coin the price source did not return', async () => {
      getPricesBySymbols.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', priceUsd: 84_000 }]);
      loadHourly.mockResolvedValue({ btc: hourly(8, () => 100_000) });

      const signals = await service.getSignalsForSymbols(['btc', 'zzz'], NOW);

      expect(signals.map((s) => s.symbol)).toEqual(['btc']);
    });

    it('still evaluates when the backfill step throws', async () => {
      getPricesBySymbols.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', priceUsd: 100 }]);
      backfill.mockRejectedValue(new Error('redis'));
      loadHourly.mockResolvedValue({ btc: [] });

      const signals = await service.getSignalsForSymbols(['btc'], NOW);

      expect(signals[0].result.insufficientData).toBe(true);
    });

    it('does nothing for an empty list', async () => {
      expect(await service.getSignalsForSymbols([], NOW)).toEqual([]);
      expect(getPricesBySymbols).not.toHaveBeenCalled();
    });
  });

  describe('getSignalFor', () => {
    it('tracks the coin and evaluates it from stored history', async () => {
      getPricesBySymbols.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', priceUsd: 84_000 }]);
      trackExtra.mockResolvedValue(true);
      loadHourly.mockResolvedValue({ btc: hourly(8, () => 100_000) });

      const result = await service.getSignalFor('btc', NOW);

      expect(result.tracked).toBe(true);
      expect(result.signal.result.verdict).toBe('buy');
      expect(snapshot).toHaveBeenCalled();
    });

    it('evaluates from the live chart and stores nothing when the cap is reached', async () => {
      getPricesBySymbols.mockResolvedValue([{ id: 'bitcoin', symbol: 'btc', priceUsd: 84_000 }]);
      trackExtra.mockResolvedValue(false);
      getMarketChart.mockResolvedValue(hourly(30, () => 100_000));

      const result = await service.getSignalFor('btc', NOW);

      expect(result.tracked).toBe(false);
      expect(result.signal.result.strong).toBe(true);
      expect(snapshot).not.toHaveBeenCalled();
    });

    it('reports insufficient data, not an outage, for a coin CoinGecko has no chart for', async () => {
      getPricesBySymbols.mockResolvedValue([{ id: 'x', symbol: 'x', priceUsd: 1 }]);
      trackExtra.mockResolvedValue(false);
      getMarketChart.mockRejectedValue(new CoingeckoUnavailableError('404'));

      const result = await service.getSignalFor('x', NOW);

      expect(result.signal.result.insufficientData).toBe(true);
    });
  });

  describe('backtest', () => {
    it('uses stored daily history when it is long enough', async () => {
      const daily = Array.from({ length: 30 }, (_, i) => ({ t: NOW - (30 - i) * DAY_MS, p: 100 }));
      loadDaily.mockResolvedValue({ btc: daily });

      const result = await service.backtest('btc', NOW);

      expect(result.insufficient).toBe(false);
      expect(result.days).toBe(30);
      expect(getMarketChart).not.toHaveBeenCalled();
    });

    it('falls back to a live chart, not stored, when stored history is short', async () => {
      loadDaily.mockResolvedValue({ btc: [] });
      getMarketChart.mockResolvedValue(hourly(60, () => 100));

      const result = await service.backtest('btc', NOW);

      expect(result.insufficient).toBe(false);
      expect(result.days).toBeGreaterThanOrEqual(59);
      expect(snapshot).not.toHaveBeenCalled();
    });

    it('is insufficient for a coin with no chart anywhere', async () => {
      loadDaily.mockResolvedValue({ x: [] });
      getMarketChart.mockRejectedValue(new CoingeckoUnavailableError('404'));

      const result = await service.backtest('x', NOW);

      expect(result).toMatchObject({ insufficient: true, days: 0 });
    });
  });

  describe('scorecard', () => {
    it('scores recorded verdicts against stored prices (AC13)', async () => {
      const at = NOW - 4 * DAY_MS;
      listRecords.mockResolvedValue([{ symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at }]);
      loadHourly.mockResolvedValue({ btc: [] });
      loadDaily.mockResolvedValue({ btc: [{ t: at + 3 * DAY_MS + HOUR_MS, p: 90_000 }] });

      const card = await service.scorecard('c1', NOW);

      expect(card.buy).toEqual({ scored: 1, correct: 1 });
      expect(listRecords).toHaveBeenCalledWith('c1', NOW - 30 * DAY_MS);
    });

    it('is empty without records and reads no history', async () => {
      listRecords.mockResolvedValue([]);
      const card = await service.scorecard('c1', NOW);
      expect(card).toEqual({
        buy: { scored: 0, correct: 0 },
        sell: { scored: 0, correct: 0 },
        pending: 0,
      });
      expect(loadHourly).not.toHaveBeenCalled();
    });
  });

  describe('recordSentVerdicts', () => {
    it('records only buy and sell verdicts', async () => {
      const result = (verdict: 'buy' | 'sell' | 'watch' | null, priceUsd: number) =>
        ({ verdict, priceUsd }) as never;
      await service.recordSentVerdicts(
        'c1',
        [
          { symbol: 'btc', result: result('buy', 84_000) },
          { symbol: 'eth', result: result('watch', 2_500) },
          { symbol: 'sol', result: result(null, 100) },
          { symbol: 'xrp', result: result('sell', 3) },
        ],
        NOW,
      );

      expect(recordVerdicts).toHaveBeenCalledWith(
        'c1',
        [
          { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: NOW },
          { symbol: 'xrp', verdict: 'sell', priceUsd: 3, at: NOW },
        ],
        NOW,
      );
    });
  });
});
