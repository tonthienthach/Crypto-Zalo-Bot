import { ConfigService } from '@nestjs/config';
import { hashToRecord, SignalsStateService, utcDay } from './signals-state.service';

const mockTx = {
  del: jest.fn(),
  hset: jest.fn(),
  lpush: jest.fn(),
  ltrim: jest.fn(),
  set: jest.fn(),
  exec: jest.fn(),
};
const mockRedis = {
  hset: jest.fn(),
  hgetall: jest.fn(),
  sismember: jest.fn(),
  smembers: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  eval: jest.fn(),
  multi: jest.fn(() => mockTx),
};
jest.mock('@upstash/redis', () => ({ Redis: jest.fn(() => mockRedis) }));

describe('hashToRecord', () => {
  it('turns a flat reply into an object and passes objects through', () => {
    expect(hashToRecord(['a', '1', 'b', '2'])).toEqual({ a: '1', b: '2' });
    expect(hashToRecord({ a: '1' })).toEqual({ a: '1' });
    expect(hashToRecord(null)).toEqual({});
  });
});

describe('utcDay', () => {
  it('formats a UTC date', () => {
    expect(utcDay(Date.UTC(2026, 9, 7, 23, 59))).toBe('2026-10-07');
  });
});

describe('SignalsStateService', () => {
  let service: SignalsStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [mockTx.del, mockTx.hset, mockTx.lpush, mockTx.ltrim, mockTx.set]) {
      fn.mockReturnValue(mockTx);
    }
    mockTx.exec.mockResolvedValue([]);
    service = new SignalsStateService({
      get: () => 'https://test.upstash.io',
    } as unknown as ConfigService);
  });

  it('reads watchlists and skips values that are not JSON', async () => {
    mockRedis.hgetall.mockResolvedValue(['1', '["btc","eth"]', '2', 'oops']);
    expect(await service.getWatchlists()).toEqual({ '1': ['btc', 'eth'] });
  });

  it('turns signals off and on through the disabled set', async () => {
    await service.setEnabled('1', false);
    expect(mockRedis.sadd).toHaveBeenCalledWith('signals:off', '1');
    await service.setEnabled('1', true);
    expect(mockRedis.srem).toHaveBeenCalledWith('signals:off', '1');
    mockRedis.sismember.mockResolvedValue(1);
    expect(await service.isEnabled('1')).toBe(false);
  });

  it('replaces the mirror in one transaction, and only clears it when empty', async () => {
    await service.replaceWatchlists({ '1': ['btc'] });
    expect(mockTx.hset).toHaveBeenCalledWith('signals:watch', { '1': '["btc"]' });
    mockTx.hset.mockClear();
    await service.replaceWatchlists({});
    expect(mockTx.hset).not.toHaveBeenCalled();
    expect(mockTx.del).toHaveBeenCalledWith('signals:watch');
  });

  it('stores verdicts in a single EVAL keyed by coin, verdict and day', async () => {
    const at = Date.UTC(2026, 9, 7, 10);
    await service.recordVerdicts(
      'c1',
      [{ symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at }],
      at,
    );
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [, keys, args] = mockRedis.eval.mock.calls[0];
    expect(keys).toEqual(['signals:rec:c1']);
    expect(args.slice(3)).toEqual(['btc:buy:2026-10-07', `84000:${at}`]);
  });

  it('parses stored records and ignores ones before `since`', async () => {
    const at = Date.UTC(2026, 9, 7, 10);
    mockRedis.hgetall.mockResolvedValue([
      'btc:buy:2026-10-07',
      `84000:${at}`,
      'eth:sell:2026-10-01',
      `2500:${at - 6 * 86_400_000}`,
    ]);
    expect(await service.listRecords('c1', at - 1000)).toEqual([
      { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at },
    ]);
  });

  it('records a healthy run and stamps lastHealthy; other outcomes do not', async () => {
    const run = {
      at: '2026-10-07T12:00:00.000Z',
      coins: 1,
      chatsAlerted: 0,
      failures: 0,
      durationMs: 5,
    };
    await service.recordRun({ ...run, outcome: 'failed' });
    expect(mockTx.set).not.toHaveBeenCalled();
    await service.recordRun({ ...run, outcome: 'healthy' });
    expect(mockTx.set).toHaveBeenCalledWith('signals:last-healthy', run.at);
  });
});
