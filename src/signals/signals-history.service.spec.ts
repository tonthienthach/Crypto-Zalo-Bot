import { ConfigService } from '@nestjs/config';
import { CoingeckoService, CoingeckoUnavailableError } from '../coingecko/coingecko.service';
import {
  buildBackfillPoints,
  parseMembers,
  SignalsHistoryService,
} from './signals-history.service';
import { DAY_MS, HOUR_MS } from './signals.constants';

const mockTx = { zadd: jest.fn(), expire: jest.fn(), set: jest.fn(), exec: jest.fn() };
const mockRedis = {
  eval: jest.fn(),
  mget: jest.fn(),
  set: jest.fn(),
  multi: jest.fn(() => mockTx),
};
jest.mock('@upstash/redis', () => ({ Redis: jest.fn(() => mockRedis) }));

const NOW = Date.UTC(2026, 9, 7, 12, 20, 0);

describe('parseMembers', () => {
  it('parses "<ms>:<usd>", sorts oldest first and keeps the later sample per bucket', () => {
    const a = NOW - 3 * HOUR_MS;
    const points = parseMembers([`${NOW}:3`, `${a}:1`, `${a + 60_000}:2`], HOUR_MS);
    expect(points).toEqual([
      { t: a + 60_000, p: 2 },
      { t: NOW, p: 3 },
    ]);
  });

  it('skips malformed members and non-arrays', () => {
    expect(parseMembers(['junk', 'x:y', `${NOW}:5`], HOUR_MS)).toEqual([{ t: NOW, p: 5 }]);
    expect(parseMembers(null, HOUR_MS)).toEqual([]);
  });
});

describe('buildBackfillPoints', () => {
  it('keeps 8 days of hourly points and the last sample of each day for 90 days', () => {
    const chart = [];
    for (let h = 100 * 24; h >= 0; h--) chart.push({ t: NOW - h * HOUR_MS, p: h });

    const { hourly, daily } = buildBackfillPoints(chart, NOW);

    expect(hourly[0].t).toBeGreaterThanOrEqual(NOW - 8 * DAY_MS);
    expect(hourly.length).toBeLessThanOrEqual(8 * 24 + 1);
    expect(daily[0].t).toBeGreaterThanOrEqual(NOW - 90 * DAY_MS);
    expect(daily.length).toBeGreaterThanOrEqual(90);
    expect(daily.length).toBeLessThanOrEqual(91);
    const days = daily.map((point) => Math.floor(point.t / DAY_MS));
    expect(new Set(days).size).toBe(days.length);
  });
});

describe('SignalsHistoryService', () => {
  let service: SignalsHistoryService;
  const getMarketChart = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.zadd.mockReturnValue(mockTx);
    mockTx.expire.mockReturnValue(mockTx);
    mockTx.set.mockReturnValue(mockTx);
    mockTx.exec.mockResolvedValue([]);
    service = new SignalsHistoryService(
      { get: () => 'https://test.upstash.io' } as unknown as ConfigService,
      { getMarketChart } as unknown as CoingeckoService,
    );
  });

  it('snapshots all coins with a single EVAL', async () => {
    mockRedis.eval.mockResolvedValue(2);
    await service.snapshot({ btc: 84_000, eth: 2_500 }, NOW);

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [, keys, args] = mockRedis.eval.mock.calls[0];
    expect(keys).toEqual([
      'signals:hour:btc',
      'signals:day:btc',
      'signals:hour:eth',
      'signals:day:eth',
    ]);
    expect(args.slice(-2)).toEqual(['84000', '2500']);
  });

  it('does not touch Redis for an empty snapshot', async () => {
    await service.snapshot({}, NOW);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('reads all coins with a single EVAL and parses their members', async () => {
    mockRedis.eval.mockResolvedValue([[`${NOW}:84000`], []]);
    const result = await service.loadHourly(['btc', 'eth'], NOW);
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ btc: [{ t: NOW, p: 84_000 }], eth: [] });
  });

  it('backfills only coins with no flag, at most 5, and marks them filled', async () => {
    getMarketChart.mockResolvedValue([{ t: NOW, p: 1 }]);
    mockRedis.mget.mockResolvedValue([null, null, '1', null, null, '1', null, null]);

    const filled = await service.backfill(['a', 'b', 'c', 'd'], NOW);

    expect(filled).toEqual(['a', 'd']);
    expect(getMarketChart).toHaveBeenCalledTimes(2);
    expect(mockTx.set).toHaveBeenCalledWith('signals:bf:a', '1', expect.any(Object));
  });

  it('holds a coin for a while when its backfill fails', async () => {
    getMarketChart.mockRejectedValue(new CoingeckoUnavailableError('429'));
    mockRedis.mget.mockResolvedValue([null, null]);
    mockRedis.set.mockResolvedValue('OK');

    expect(await service.backfill(['xyz'], NOW)).toEqual([]);
    expect(mockRedis.set).toHaveBeenCalledWith('signals:bf-fail:xyz', '1', { ex: 7200 });
    expect(mockTx.set).not.toHaveBeenCalled();
  });
});
