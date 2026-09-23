/**
 * Opt-in integration test: runs the real PriceAlertsService against a real
 * Redis through the real @upstash/redis driver (EPIC-001 lesson: prove the
 * actual driver, not just mocked calls). Skipped unless REDIS_INT_URL is set,
 * so CI's `npm run test:e2e` stays self-contained. Local setup (see
 * docs/epics/EPIC-002/artifacts/plan.md §6):
 *
 *   docker network create ea-net
 *   docker run -d --name ea-redis --network ea-net redis:7-alpine
 *   docker run -d --name ea-srh --network ea-net -p 8079:80 -e SRH_MODE=env \
 *     -e SRH_TOKEN=local -e SRH_CONNECTION_STRING=redis://ea-redis:6379 \
 *     hiett/serverless-redis-http
 *   REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local \
 *     npm run test:e2e -- price-alerts.redis
 *
 * WARNING: flushes the target database before each test — never point it at
 * a real Upstash instance.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Redis } from '@upstash/redis';
import { CoingeckoService } from '../src/coingecko/coingecko.service';
import {
  AlertLimitReachedError,
  AlertNotFoundError,
  PriceAlertsService,
} from '../src/price-alerts/price-alerts.service';

const url = process.env.REDIS_INT_URL;
const token = process.env.REDIS_INT_TOKEN ?? 'local';
const describeIfRedis = url ? describe : describe.skip;

describeIfRedis('PriceAlertsService against a real Redis (integration)', () => {
  let service: PriceAlertsService;
  const redis = new Redis({ url: url ?? 'http://unused', token });
  const getPricesBySymbols = jest.fn();

  beforeEach(async () => {
    await redis.flushdb();
    getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 95000 }]);

    const config: Record<string, unknown> = { 'redis.restUrl': url, 'redis.restToken': token };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceAlertsService,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        { provide: CoingeckoService, useValue: { getPricesBySymbols } },
      ],
    }).compile();
    service = moduleRef.get(PriceAlertsService);
  });

  it('creates, lists and deletes per chat without touching other chats (AC01, AC11)', async () => {
    const a1 = await service.create('chat-a', 'btc', 'above', 100000);
    const a2 = await service.create('chat-a', 'btc', 'below', 90000);
    await service.create('chat-b', 'btc', 'above', 120000);

    expect([a1.position, a2.position]).toEqual([1, 2]);
    expect((await service.listByChat('chat-a')).map((a) => a.threshold)).toEqual([100000, 90000]);

    const deleted = await service.deleteByIndex('chat-a', 2);
    expect(deleted.threshold).toBe(90000);
    expect((await service.listByChat('chat-a')).map((a) => a.threshold)).toEqual([100000]);
    expect((await service.listByChat('chat-b')).map((a) => a.threshold)).toEqual([120000]);
    expect(await service.listAll()).toHaveLength(2);

    await expect(service.deleteByIndex('chat-a', 99)).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  it('rejects the 11th alert of a chat (AC10)', async () => {
    for (let i = 1; i <= 10; i++) {
      await service.create('chat-a', 'btc', 'above', 100000 + i);
    }
    await expect(service.create('chat-a', 'btc', 'above', 200000)).rejects.toBeInstanceOf(
      AlertLimitReachedError,
    );
    expect(await service.listByChat('chat-a')).toHaveLength(10);
  });

  it('never resurrects an alert deleted mid-run: updateState uses SET XX (AC14)', async () => {
    const { alert } = await service.create('chat-a', 'btc', 'above', 100000);

    await expect(service.updateState({ ...alert, state: 'fired' })).resolves.toBe(true);
    expect((await service.listAll())[0].state).toBe('fired');

    await service.deleteByIndex('chat-a', 1);
    await expect(service.updateState({ ...alert, state: 'armed' })).resolves.toBe(false);
    expect(await redis.exists(`price-alerts:alert:${alert.id}`)).toBe(0);
  });

  it('lets only one run hold the lock at a time (AC14)', async () => {
    await expect(service.acquireRunLock()).resolves.toBe(true);
    await expect(service.acquireRunLock()).resolves.toBe(false);
    expect(await redis.ttl('price-alerts:run-lock')).toBeGreaterThan(0);

    await service.releaseRunLock();
    await expect(service.acquireRunLock()).resolves.toBe(true);
  });

  it('keeps delivery and run logs readable and capped (AC17)', async () => {
    for (let i = 0; i < 1445; i++) {
      await service.recordRun({
        startedAt: new Date(Date.UTC(2026, 8, 23, 0, i)).toISOString(),
        evaluated: i,
        fired: 0,
        failed: 0,
        rearmed: 0,
        durationMs: 10,
        driftMs: 0,
      });
    }
    await service.recordDelivery({
      alertId: 1,
      chatId: 'chat-a',
      symbol: 'btc',
      direction: 'above',
      threshold: 100000,
      priceUsd: 100200,
      delivered: true,
      attemptedAt: '2026-09-23T01:00:00.000Z',
    });

    const runs = await service.listRuns();
    expect(runs).toHaveLength(1440);
    expect(runs[0].evaluated).toBe(1444);
    expect(await service.listDeliveries()).toEqual([
      expect.objectContaining({ chatId: 'chat-a', delivered: true, priceUsd: 100200 }),
    ]);
  }, 60_000);
});
