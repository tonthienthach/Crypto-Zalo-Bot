import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoingeckoService, UnknownCoinSymbolsError } from '../coingecko/coingecko.service';
import { PriceAlert } from './interfaces/price-alert.interface';
import {
  AlertConditionAlreadyMetError,
  AlertLimitReachedError,
  AlertNotFoundError,
  PriceAlertsService,
} from './price-alerts.service';

const mockTx = {
  set: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  del: jest.fn(),
  lpush: jest.fn(),
  ltrim: jest.fn(),
  exec: jest.fn(),
};
const mockRedis = {
  scard: jest.fn(),
  incr: jest.fn(),
  smembers: jest.fn(),
  mget: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  multi: jest.fn(() => mockTx),
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedis),
}));

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 1,
    chatId: 'chat-1',
    symbol: 'btc',
    direction: 'above',
    threshold: 100000,
    state: 'armed',
    lastFiredAt: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('PriceAlertsService', () => {
  let service: PriceAlertsService;
  let getPricesBySymbols: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of [
      mockTx.set,
      mockTx.sadd,
      mockTx.srem,
      mockTx.del,
      mockTx.lpush,
      mockTx.ltrim,
    ]) {
      fn.mockReturnValue(mockTx);
    }
    mockTx.exec.mockResolvedValue([]);
    getPricesBySymbols = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceAlertsService,
        { provide: ConfigService, useValue: { get: () => 'https://test.upstash.io' } },
        { provide: CoingeckoService, useValue: { getPricesBySymbols } },
      ],
    }).compile();

    service = moduleRef.get(PriceAlertsService);
  });

  describe('create', () => {
    it('writes the alert key and both id sets, and returns its list position (AC01)', async () => {
      mockRedis.scard.mockResolvedValue(2);
      getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 95000 }]);
      mockRedis.incr.mockResolvedValue(7);

      const created = await service.create('chat-1', 'btc', 'above', 100000);

      expect(created.position).toBe(3);
      expect(created.currentPriceUsd).toBe(95000);
      expect(created.alert).toMatchObject({
        id: 7,
        chatId: 'chat-1',
        symbol: 'btc',
        direction: 'above',
        threshold: 100000,
        state: 'armed',
        lastFiredAt: null,
      });
      expect(mockTx.set).toHaveBeenCalledWith('price-alerts:alert:7', created.alert);
      expect(mockTx.sadd).toHaveBeenCalledWith('price-alerts:ids', 7);
      expect(mockTx.sadd).toHaveBeenCalledWith('price-alerts:chat:chat-1', 7);
      expect(mockTx.exec).toHaveBeenCalled();
    });

    it('rejects an 11th alert without looking up the price (AC10)', async () => {
      mockRedis.scard.mockResolvedValue(10);

      await expect(service.create('chat-1', 'btc', 'above', 100000)).rejects.toBeInstanceOf(
        AlertLimitReachedError,
      );
      expect(getPricesBySymbols).not.toHaveBeenCalled();
      expect(mockRedis.incr).not.toHaveBeenCalled();
    });

    it('rejects a condition that is already met, writing nothing (AC07)', async () => {
      mockRedis.scard.mockResolvedValue(0);
      getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 110000 }]);

      const error = await service.create('chat-1', 'btc', 'above', 100000).catch((e) => e);

      expect(error).toBeInstanceOf(AlertConditionAlreadyMetError);
      expect(error.currentPriceUsd).toBe(110000);
      expect(mockRedis.incr).not.toHaveBeenCalled();
      expect(mockTx.exec).not.toHaveBeenCalled();
    });

    it('lets UnknownCoinSymbolsError through unchanged, like /gia (AC09)', async () => {
      mockRedis.scard.mockResolvedValue(0);
      getPricesBySymbols.mockRejectedValue(new UnknownCoinSymbolsError(['xyzabc']));

      await expect(service.create('chat-1', 'xyzabc', 'above', 1)).rejects.toBeInstanceOf(
        UnknownCoinSymbolsError,
      );
    });
  });

  describe('listByChat / deleteByIndex', () => {
    it('returns a chat alerts sorted by id, skipping ids whose key is gone', async () => {
      mockRedis.smembers.mockResolvedValue([5, 2, 9]);
      mockRedis.mget.mockResolvedValue([alert({ id: 5 }), null, alert({ id: 2 })]);

      const alerts = await service.listByChat('chat-1');

      expect(mockRedis.mget).toHaveBeenCalledWith(
        'price-alerts:alert:5',
        'price-alerts:alert:2',
        'price-alerts:alert:9',
      );
      expect(alerts.map((a) => a.id)).toEqual([2, 5]);
    });

    it('does not call MGET for a chat with no alerts', async () => {
      mockRedis.smembers.mockResolvedValue([]);

      await expect(service.listByChat('chat-1')).resolves.toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('deletes the alert at a 1-based position of the chat list (AC11)', async () => {
      mockRedis.smembers.mockResolvedValue([3, 8]);
      mockRedis.mget.mockResolvedValue([alert({ id: 3 }), alert({ id: 8 })]);

      const deleted = await service.deleteByIndex('chat-1', 2);

      expect(deleted.id).toBe(8);
      expect(mockTx.del).toHaveBeenCalledWith('price-alerts:alert:8');
      expect(mockTx.srem).toHaveBeenCalledWith('price-alerts:ids', 8);
      expect(mockTx.srem).toHaveBeenCalledWith('price-alerts:chat:chat-1', 8);
    });

    it('throws AlertNotFoundError for a position the list does not have (AC11)', async () => {
      mockRedis.smembers.mockResolvedValue([3]);
      mockRedis.mget.mockResolvedValue([alert({ id: 3 })]);

      await expect(service.deleteByIndex('chat-1', 99)).rejects.toBeInstanceOf(AlertNotFoundError);
      expect(mockTx.exec).not.toHaveBeenCalled();
    });
  });

  describe('check-run helpers', () => {
    it('updateState writes with XX and reports whether the key still existed (AC14)', async () => {
      mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
      const fired = alert({ state: 'fired', lastFiredAt: '2026-09-23T01:00:00.000Z' });

      await expect(service.updateState(fired)).resolves.toBe(true);
      await expect(service.updateState(fired)).resolves.toBe(false);
      expect(mockRedis.set).toHaveBeenCalledWith('price-alerts:alert:1', fired, { xx: true });
    });

    it('acquireRunLock uses SET NX with a TTL (AC14)', async () => {
      mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

      await expect(service.acquireRunLock()).resolves.toBe(true);
      await expect(service.acquireRunLock()).resolves.toBe(false);
      expect(mockRedis.set).toHaveBeenCalledWith('price-alerts:run-lock', expect.any(String), {
        nx: true,
        ex: 120,
      });
    });

    it('caps the delivery and run logs with LTRIM (AC17)', async () => {
      await service.recordRun({
        startedAt: '2026-09-23T01:00:00.000Z',
        evaluated: 3,
        fired: 1,
        failed: 0,
        rearmed: 0,
        durationMs: 420,
        driftMs: 800,
      });

      expect(mockTx.lpush).toHaveBeenCalledWith(
        'price-alerts:runs',
        expect.objectContaining({ fired: 1 }),
      );
      expect(mockTx.ltrim).toHaveBeenCalledWith('price-alerts:runs', 0, 1439);
    });
  });
});
