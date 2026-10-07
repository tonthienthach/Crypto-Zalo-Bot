/**
 * Opt-in integration test: runs the real SignalsHistoryService and
 * SignalsStateService (Lua scripts included) against a real Redis through
 * the real @upstash/redis driver. Skipped unless REDIS_INT_URL is set, so
 * CI's `npm run test:e2e` stays self-contained. Local setup is the same as
 * test/price-alerts.redis.e2e-spec.ts:
 *
 *   REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local \
 *     npm run test:e2e -- signals.redis
 *
 * WARNING: flushes the target database before each test — never point it at
 * a real Upstash instance.
 */
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { CoingeckoService, CoingeckoUnavailableError } from '../src/coingecko/coingecko.service';
import { SignalsHistoryService } from '../src/signals/signals-history.service';
import { SignalsStateService } from '../src/signals/signals-state.service';
import {
  DAY_MS,
  HOUR_MS,
  MAX_EXTRA_TRACKED,
  MAX_RECORDS_PER_CHAT,
} from '../src/signals/signals.constants';

const url = process.env.REDIS_INT_URL;
const token = process.env.REDIS_INT_TOKEN ?? 'local';
const describeIfRedis = url ? describe : describe.skip;

const NOW = Date.UTC(2026, 9, 7, 12, 20, 0);

describeIfRedis('Signals stores against a real Redis (integration)', () => {
  const redis = new Redis({ url: url ?? 'http://unused', token });
  const getMarketChart = jest.fn();
  let history: SignalsHistoryService;
  let state: SignalsStateService;

  beforeEach(async () => {
    await redis.flushdb();
    getMarketChart.mockReset();
    const config: Record<string, unknown> = { 'redis.restUrl': url, 'redis.restToken': token };
    const configService = { get: (key: string) => config[key] } as unknown as ConfigService;
    history = new SignalsHistoryService(configService, {
      getMarketChart,
    } as unknown as CoingeckoService);
    state = new SignalsStateService(configService);
  });

  describe('history', () => {
    it('writes one hourly and one daily point per coin, idempotent within the hour', async () => {
      await history.snapshot({ btc: 84_000, eth: 2_500 }, NOW);
      await history.snapshot({ btc: 84_500, eth: 2_510 }, NOW + 5 * 60_000);

      const hourly = await history.loadHourly(['btc', 'eth'], NOW + 10 * 60_000);
      expect(hourly.btc).toEqual([{ t: NOW + 5 * 60_000, p: 84_500 }]);
      expect(hourly.eth).toEqual([{ t: NOW + 5 * 60_000, p: 2_510 }]);
      const daily = await history.loadDaily(['btc'], NOW + 10 * 60_000);
      expect(daily.btc).toEqual([{ t: NOW + 5 * 60_000, p: 84_500 }]);
    });

    it('keeps a new point per hour and cuts hourly points older than 8 days', async () => {
      await history.snapshot({ btc: 100 }, NOW - 9 * DAY_MS);
      await history.snapshot({ btc: 101 }, NOW - HOUR_MS);
      await history.snapshot({ btc: 102 }, NOW);

      const hourly = await history.loadHourly(['btc'], NOW);
      expect(hourly.btc.map((point) => point.p)).toEqual([101, 102]);
      // 11:20 and 12:20 share a UTC day, so the day keeps its last sample.
      const daily = await history.loadDaily(['btc'], NOW);
      expect(daily.btc.map((point) => point.p)).toEqual([100, 102]);
    });

    it('returns an empty list for a coin with no history', async () => {
      expect(await history.loadHourly(['doge'], NOW)).toEqual({ doge: [] });
    });

    it('stores prices that look like JSON numbers or are tiny', async () => {
      await history.snapshot({ shib: 0.00001234, pepe: 1e-7 }, NOW);
      const hourly = await history.loadHourly(['shib', 'pepe'], NOW);
      expect(hourly.shib[0].p).toBeCloseTo(0.00001234, 12);
      expect(hourly.pepe[0].p).toBeCloseTo(1e-7, 12);
    });

    it('backfills once from the market chart and then not again', async () => {
      const chart = [];
      for (let h = 90 * 24; h >= 0; h--) chart.push({ t: NOW - h * HOUR_MS, p: 100 + (h % 7) });
      getMarketChart.mockResolvedValue(chart);

      expect(await history.backfill(['btc'], NOW)).toEqual(['btc']);
      expect(await history.backfill(['btc'], NOW)).toEqual([]);
      expect(getMarketChart).toHaveBeenCalledTimes(1);

      const hourly = await history.loadHourly(['btc'], NOW);
      expect(hourly.btc.length).toBeGreaterThanOrEqual(8 * 24);
      expect(hourly.btc.length).toBeLessThanOrEqual(8 * 24 + 1);
      const daily = await history.loadDaily(['btc'], NOW);
      expect(daily.btc.length).toBeGreaterThanOrEqual(90);
    });

    it('holds a coin whose backfill failed, and does not mark it as filled', async () => {
      getMarketChart.mockRejectedValue(new CoingeckoUnavailableError('429'));
      expect(await history.backfill(['xyz'], NOW)).toEqual([]);
      expect(await history.backfill(['xyz'], NOW)).toEqual([]);
      expect(getMarketChart).toHaveBeenCalledTimes(1);
      expect(await redis.exists('signals:bf:xyz')).toBe(0);
    });

    it('backfills at most 5 coins per call', async () => {
      getMarketChart.mockResolvedValue([{ t: NOW, p: 1 }]);
      const filled = await history.backfill(['a', 'b', 'c', 'd', 'e', 'f', 'g'], NOW);
      expect(filled).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('watchlist mirror and preferences', () => {
    it('round-trips watchlists, including numeric-looking chat ids', async () => {
      await state.setWatchlist('12345678901234567890', ['btc', 'eth']);
      await state.setWatchlist('abc-1', ['sol']);
      expect(await state.getWatchlists()).toEqual({
        '12345678901234567890': ['btc', 'eth'],
        'abc-1': ['sol'],
      });

      await state.removeWatchlist('abc-1');
      expect(Object.keys(await state.getWatchlists())).toEqual(['12345678901234567890']);

      await state.replaceWatchlists({ x: ['doge'] });
      expect(await state.getWatchlists()).toEqual({ x: ['doge'] });
      await state.replaceWatchlists({});
      expect(await state.getWatchlists()).toEqual({});
    });

    it('keeps the on/off switch across service instances (AC14)', async () => {
      expect(await state.isEnabled('1')).toBe(true);
      await state.setEnabled('1', false);
      const config: Record<string, unknown> = { 'redis.restUrl': url, 'redis.restToken': token };
      const again = new SignalsStateService({
        get: (key: string) => config[key],
      } as unknown as ConfigService);
      expect(await again.isEnabled('1')).toBe(false);
      expect(await again.listDisabled()).toEqual(new Set(['1']));
      await again.setEnabled('1', true);
      expect(await state.isEnabled('1')).toBe(true);
    });

    it('stores what a chat was last told', async () => {
      const sent = {
        lastSentAt: NOW,
        coins: { btc: { sentAt: NOW, direction: 'down' as const, movePct: -16 } },
      };
      await state.setSentState('7', sent);
      expect(await state.getSentStates()).toEqual({ '7': sent });
    });
  });

  describe('verdict records', () => {
    it('keeps the first record per coin, verdict and day (AC13)', async () => {
      await state.recordVerdicts(
        'c1',
        [{ symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: NOW }],
        NOW,
      );
      await state.recordVerdicts(
        'c1',
        [
          { symbol: 'btc', verdict: 'buy', priceUsd: 85_000, at: NOW + HOUR_MS },
          { symbol: 'btc', verdict: 'sell', priceUsd: 90_000, at: NOW + HOUR_MS },
        ],
        NOW + HOUR_MS,
      );

      const records = await state.listRecords('c1', 0);
      expect(records).toEqual([
        { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: NOW },
        { symbol: 'btc', verdict: 'sell', priceUsd: 90_000, at: NOW + HOUR_MS },
      ]);
      expect(await state.listRecords('c1', NOW + 1)).toHaveLength(1);
    });

    it('drops records older than 90 days and caps a chat at 1000', async () => {
      const old = NOW - 100 * DAY_MS;
      await state.recordVerdicts(
        'c2',
        [{ symbol: 'btc', verdict: 'buy', priceUsd: 1, at: old }],
        NOW,
      );
      expect(await state.listRecords('c2', 0)).toEqual([]);

      const many = Array.from({ length: MAX_RECORDS_PER_CHAT + 5 }, (_, i) => ({
        symbol: `coin${i}`,
        verdict: 'buy' as const,
        priceUsd: 1,
        at: NOW - i * 60_000,
      }));
      await state.recordVerdicts('c3', many, NOW);
      const kept = await state.listRecords('c3', 0);
      expect(kept).toHaveLength(MAX_RECORDS_PER_CHAT);
      expect(kept.some((record) => record.symbol === `coin${MAX_RECORDS_PER_CHAT + 4}`)).toBe(
        false,
      );
    });
  });

  describe('extra tracked coins', () => {
    it('tracks up to the cap, always accepts a coin already tracked, and expires', async () => {
      for (let i = 0; i < MAX_EXTRA_TRACKED; i++) {
        expect(await state.trackExtra(`c${i}`, NOW)).toBe(true);
      }
      expect(await state.trackExtra('overflow', NOW)).toBe(false);
      expect(await state.trackExtra('c0', NOW)).toBe(true);
      expect(await state.listExtra(NOW)).toHaveLength(MAX_EXTRA_TRACKED);
      expect(await state.listExtra(NOW + 5 * DAY_MS)).toEqual([]);
      expect(await state.trackExtra('overflow', NOW + 5 * DAY_MS)).toBe(true);
    });
  });

  describe('run lock, run log and usage', () => {
    it('lets one run hold the lock at a time and only the owner release it', async () => {
      const first = await state.acquireRunLock();
      expect(first).not.toBeNull();
      expect(await state.acquireRunLock()).toBeNull();
      await state.releaseRunLock('not-the-token');
      expect(await state.acquireRunLock()).toBeNull();
      await state.releaseRunLock(first!);
      expect(await state.acquireRunLock()).not.toBeNull();
    });

    it('logs runs newest first and stamps the last healthy one', async () => {
      const run = (at: string, outcome: 'healthy' | 'failed') => ({
        at,
        outcome,
        coins: 3,
        chatsAlerted: 1,
        failures: 0,
        durationMs: 900,
      });
      await state.recordRun(run('2026-10-07T12:00:00.000Z', 'healthy'));
      await state.recordRun(run('2026-10-07T12:30:00.000Z', 'failed'));

      const runs = await state.listRecentRuns(10);
      expect(runs.map((entry) => entry.at)).toEqual([
        '2026-10-07T12:30:00.000Z',
        '2026-10-07T12:00:00.000Z',
      ]);
      expect(await state.getLastHealthyAt()).toBe('2026-10-07T12:00:00.000Z');
    });

    it('counts usage per chat and kind per day', async () => {
      await state.recordUsage('c1', 'command', NOW);
      await state.recordUsage('c1', 'command', NOW);
      await state.recordUsage('c1', 'alert', NOW);
      const hash = await redis.hgetall<Record<string, number>>('signals:use:2026-10-07');
      expect(hash).toEqual({ 'c1|command': 2, 'c1|alert': 1 });
      expect(await redis.ttl('signals:use:2026-10-07')).toBeGreaterThan(0);
    });
  });
});
