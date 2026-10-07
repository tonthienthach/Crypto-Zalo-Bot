import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { CoingeckoService } from '../coingecko/coingecko.service';
import { MarketChartPoint } from '../coingecko/interfaces/coingecko-response.interface';
import { PricePoint } from './interfaces/signal.interface';
import {
  BACKFILL_RETRY_HOLD_SECONDS,
  BACKTEST_DAYS,
  DAILY_RETENTION_MS,
  DAY_MS,
  HOUR_MS,
  HOURLY_RETENTION_MS,
  MAX_BACKFILL_PER_RUN,
  REDIS_KEYS,
} from './signals.constants';

/**
 * Writes one price sample per coin: the hour's sample replaces an earlier one
 * from the same hour (so a double run is idempotent), the day's last sample
 * replaces the day's earlier one, and anything past retention is cut. One
 * command for any number of coins. KEYS are (hourly, daily) pairs; ARGV is
 * t, hourBucket, dayBucket, hourCutoff, dayCutoff, hourTtl, dayTtl, then one
 * price per pair.
 */
const SNAPSHOT_SCRIPT = `
local t, hb, db = ARGV[1], ARGV[2], ARGV[3]
for i = 1, #KEYS, 2 do
  local price = ARGV[8 + (i - 1) / 2]
  redis.call("ZREMRANGEBYSCORE", KEYS[i], hb, hb)
  redis.call("ZADD", KEYS[i], hb, t .. ":" .. price)
  redis.call("ZREMRANGEBYSCORE", KEYS[i], "-inf", "(" .. ARGV[4])
  redis.call("EXPIRE", KEYS[i], ARGV[6])
  redis.call("ZREMRANGEBYSCORE", KEYS[i + 1], db, db)
  redis.call("ZADD", KEYS[i + 1], db, t .. ":" .. price)
  redis.call("ZREMRANGEBYSCORE", KEYS[i + 1], "-inf", "(" .. ARGV[5])
  redis.call("EXPIRE", KEYS[i + 1], ARGV[7])
end
return #KEYS / 2
`;

/** Reads every key's members with score >= ARGV[1], in one command. */
const READ_SCRIPT = `
local out = {}
for i = 1, #KEYS do
  out[i] = redis.call("ZRANGEBYSCORE", KEYS[i], ARGV[1], "+inf")
end
return out
`;

/** Splits "<ms>:<usd>" members into points, oldest first, one per bucket (the later sample wins). */
export function parseMembers(members: unknown, bucketMs: number): PricePoint[] {
  if (!Array.isArray(members)) return [];
  const byBucket = new Map<number, PricePoint>();
  for (const member of members) {
    const [t, p] = String(member).split(':');
    const point = { t: Number(t), p: Number(p) };
    if (!Number.isFinite(point.t) || !Number.isFinite(point.p)) continue;
    const bucket = Math.floor(point.t / bucketMs);
    const existing = byBucket.get(bucket);
    if (!existing || point.t > existing.t) byBucket.set(bucket, point);
  }
  return Array.from(byBucket.values()).sort((a, b) => a.t - b.t);
}

/**
 * Splits a CoinGecko history into the points we keep: every hour of the last
 * HOURLY_RETENTION_MS, and the last sample of each UTC day.
 */
export function buildBackfillPoints(
  chart: MarketChartPoint[],
  now: number,
): { hourly: PricePoint[]; daily: PricePoint[] } {
  const hourlyCutoff = now - HOURLY_RETENTION_MS;
  const hourly = parseHistory(
    chart.filter((point) => point.t >= hourlyCutoff),
    HOUR_MS,
  );
  const daily = parseHistory(
    chart.filter((point) => point.t >= now - DAILY_RETENTION_MS),
    DAY_MS,
  );
  return { hourly, daily };
}

function parseHistory(points: MarketChartPoint[], bucketMs: number): PricePoint[] {
  return parseMembers(
    points.map((point) => `${point.t}:${point.p}`),
    bucketMs,
  );
}

/**
 * Price history per coin, in Upstash Redis (not Postgres: the signals check
 * runs every 30 minutes and would keep the Neon compute awake, see
 * docs/ARCHITECTURE.md). The client does not auto-parse replies, so chat ids
 * and numbers that look like JSON are never turned into numbers.
 */
@Injectable()
export class SignalsHistoryService {
  private readonly logger = new Logger(SignalsHistoryService.name);
  private readonly redis: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly coingeckoService: CoingeckoService,
  ) {
    this.redis = new Redis({
      url: this.configService.get<string>('redis.restUrl')!,
      token: this.configService.get<string>('redis.restToken')!,
      automaticDeserialization: false,
    });
  }

  /** Records `prices` (symbol -> USD) as of `now`. Two samples in one hour keep the later one. */
  async snapshot(prices: Record<string, number>, now: number): Promise<void> {
    const symbols = Object.keys(prices);
    if (symbols.length === 0) return;
    const hourBucket = Math.floor(now / HOUR_MS) * HOUR_MS;
    const dayBucket = Math.floor(now / DAY_MS) * DAY_MS;
    const keys = symbols.flatMap((symbol) => [REDIS_KEYS.hourly(symbol), REDIS_KEYS.daily(symbol)]);
    await this.redis.eval(SNAPSHOT_SCRIPT, keys, [
      String(now),
      String(hourBucket),
      String(dayBucket),
      String(now - HOURLY_RETENTION_MS),
      String(now - DAILY_RETENTION_MS),
      String(Math.ceil(HOURLY_RETENTION_MS / 1000) + 3600),
      String(Math.ceil(DAILY_RETENTION_MS / 1000) + 86_400),
      ...symbols.map((symbol) => String(prices[symbol])),
    ]);
  }

  /** Hourly points of the last HOURLY_RETENTION_MS per coin, oldest first. */
  async loadHourly(symbols: string[], now: number): Promise<Record<string, PricePoint[]>> {
    return this.read(symbols, REDIS_KEYS.hourly, String(now - HOURLY_RETENTION_MS), HOUR_MS);
  }

  /** End-of-day points of the last BACKTEST_DAYS per coin, oldest first. */
  async loadDaily(symbols: string[], now: number): Promise<Record<string, PricePoint[]>> {
    return this.read(symbols, REDIS_KEYS.daily, String(now - (BACKTEST_DAYS + 1) * DAY_MS), DAY_MS);
  }

  /**
   * Fills history once for coins seen for the first time, from CoinGecko's
   * market chart. At most MAX_BACKFILL_PER_RUN coins per call; a coin that
   * fails (unknown to CoinGecko, rate limited) is held for a while so it
   * does not burn a call every run. The "filled" flag is only set on success.
   * Returns the symbols filled.
   */
  async backfill(symbols: string[], now: number): Promise<string[]> {
    if (symbols.length === 0) return [];
    const flags = await this.redis.mget<(string | null)[]>(
      ...symbols.flatMap((symbol) => [
        REDIS_KEYS.backfilled(symbol),
        REDIS_KEYS.backfillFailed(symbol),
      ]),
    );
    const due = symbols
      .filter((_, i) => flags[i * 2] === null && flags[i * 2 + 1] === null)
      .slice(0, MAX_BACKFILL_PER_RUN);

    const filled: string[] = [];
    for (const symbol of due) {
      try {
        const chart = await this.coingeckoService.getMarketChart(symbol, BACKTEST_DAYS);
        await this.writeBackfill(symbol, buildBackfillPoints(chart, now));
        filled.push(symbol);
      } catch (error) {
        this.logger.warn(`Backfill failed for ${symbol}: ${(error as Error).message}`);
        await this.redis
          .set(REDIS_KEYS.backfillFailed(symbol), '1', { ex: BACKFILL_RETRY_HOLD_SECONDS })
          .catch(() => undefined);
      }
    }
    return filled;
  }

  private async writeBackfill(
    symbol: string,
    points: { hourly: PricePoint[]; daily: PricePoint[] },
  ): Promise<void> {
    const toEntry = (point: PricePoint, bucketMs: number) => ({
      score: Math.floor(point.t / bucketMs) * bucketMs,
      member: `${point.t}:${point.p}`,
    });
    const tx = this.redis.multi();
    if (points.hourly.length > 0) {
      const [first, ...rest] = points.hourly.map((point) => toEntry(point, HOUR_MS));
      tx.zadd(REDIS_KEYS.hourly(symbol), first, ...rest);
      tx.expire(REDIS_KEYS.hourly(symbol), Math.ceil(HOURLY_RETENTION_MS / 1000) + 3600);
    }
    if (points.daily.length > 0) {
      const [first, ...rest] = points.daily.map((point) => toEntry(point, DAY_MS));
      tx.zadd(REDIS_KEYS.daily(symbol), first, ...rest);
      tx.expire(REDIS_KEYS.daily(symbol), Math.ceil(DAILY_RETENTION_MS / 1000) + 86_400);
    }
    tx.set(REDIS_KEYS.backfilled(symbol), '1', { ex: Math.ceil(DAILY_RETENTION_MS / 1000) });
    await tx.exec();
  }

  private async read(
    symbols: string[],
    keyOf: (symbol: string) => string,
    fromScore: string,
    bucketMs: number,
  ): Promise<Record<string, PricePoint[]>> {
    if (symbols.length === 0) return {};
    const reply = await this.redis.eval<string[], unknown[]>(READ_SCRIPT, symbols.map(keyOf), [
      fromScore,
    ]);
    const out: Record<string, PricePoint[]> = {};
    symbols.forEach((symbol, i) => {
      out[symbol] = parseMembers(reply[i], bucketMs);
    });
    return out;
  }
}
