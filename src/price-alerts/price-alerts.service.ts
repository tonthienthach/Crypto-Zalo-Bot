import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { CoingeckoService } from '../coingecko/coingecko.service';
import {
  AlertDelivery,
  AlertDirection,
  AlertRunSummary,
  PriceAlert,
} from './interfaces/price-alert.interface';
import { isConditionMet } from './price-alert-evaluator';
import {
  MAX_ALERTS_PER_CHAT,
  MAX_DELIVERY_LOG_ENTRIES,
  MAX_RUN_LOG_ENTRIES,
  REDIS_KEYS,
  RUN_LOCK_TTL_SECONDS,
} from './price-alerts.constants';

/** Raised when a chat already holds MAX_ALERTS_PER_CHAT alerts. */
export class AlertLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`Chat already has the maximum of ${limit} alerts`);
  }
}

/** Raised when the requested condition is already true at the current price (spec EPIC-002-FR10). */
export class AlertConditionAlreadyMetError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly currentPriceUsd: number,
  ) {
    super(`Alert condition for ${symbol} is already met at ${currentPriceUsd}`);
  }
}

/** Raised when "/canhbao xoa <n>" names a position the chat's list doesn't have. */
export class AlertNotFoundError extends Error {
  constructor(public readonly index: number) {
    super(`No alert at position ${index}`);
  }
}

export interface CreatedAlert {
  alert: PriceAlert;
  /** 1-based position in the chat's "/canhbao" list. */
  position: number;
  currentPriceUsd: number;
}

/**
 * Persistence for price alerts, backed by Upstash Redis (Vercel Marketplace
 * integration) over its REST API — like the Neon HTTP driver for
 * subscribers, no long-lived connection to manage across cold starts.
 * Alerts deliberately live here and not in Postgres: the alert check runs
 * every minute, which would keep the Neon compute from ever scaling to zero
 * and exhaust its free-plan quota (see docs/ARCHITECTURE.md).
 */
@Injectable()
export class PriceAlertsService {
  private readonly redis: Redis;
  private readonly runLockToken = randomUUID();

  constructor(
    private readonly configService: ConfigService,
    private readonly coingeckoService: CoingeckoService,
  ) {
    this.redis = new Redis({
      url: this.configService.get<string>('redis.restUrl')!,
      token: this.configService.get<string>('redis.restToken')!,
    });
  }

  /**
   * Creates an alert for a chat after checking the per-chat cap and that
   * the condition isn't already true at the current price. Throws
   * UnknownCoinSymbolsError / CoingeckoUnavailableError from the price
   * lookup unchanged, so the webhook replies exactly as it does for /gia.
   *
   * The cap check and the write are not atomic: two simultaneous creates
   * from one chat could land it at 11. Accepted — UserThrottlerGuard already
   * rate-limits commands per chat, and one extra alert is harmless.
   */
  async create(
    chatId: string,
    symbol: string,
    direction: AlertDirection,
    threshold: number,
  ): Promise<CreatedAlert> {
    const existingCount = await this.redis.scard(REDIS_KEYS.chatIds(chatId));
    if (existingCount >= MAX_ALERTS_PER_CHAT) {
      throw new AlertLimitReachedError(MAX_ALERTS_PER_CHAT);
    }

    const [coin] = await this.coingeckoService.getPricesBySymbols([symbol]);
    if (isConditionMet(direction, threshold, coin.priceUsd)) {
      throw new AlertConditionAlreadyMetError(symbol, coin.priceUsd);
    }

    const id = await this.redis.incr(REDIS_KEYS.nextId);
    const alert: PriceAlert = {
      id,
      chatId,
      symbol,
      direction,
      threshold,
      state: 'armed',
      lastFiredAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.redis
      .multi()
      .set(REDIS_KEYS.alert(id), alert)
      .sadd(REDIS_KEYS.allIds, id)
      .sadd(REDIS_KEYS.chatIds(chatId), id)
      .exec();

    return { alert, position: existingCount + 1, currentPriceUsd: coin.priceUsd };
  }

  /** A chat's alerts, oldest first — the order "/canhbao" numbers them in. */
  async listByChat(chatId: string): Promise<PriceAlert[]> {
    const ids = await this.redis.smembers(REDIS_KEYS.chatIds(chatId));
    return this.loadAlerts(ids);
  }

  /** Deletes the alert at a 1-based position of the chat's own list, so a chat can only delete its own. */
  async deleteByIndex(chatId: string, index: number): Promise<PriceAlert> {
    const alerts = await this.listByChat(chatId);
    const alert = alerts[index - 1];
    if (!alert) {
      throw new AlertNotFoundError(index);
    }
    await this.redis
      .multi()
      .del(REDIS_KEYS.alert(alert.id))
      .srem(REDIS_KEYS.allIds, alert.id)
      .srem(REDIS_KEYS.chatIds(chatId), alert.id)
      .exec();
    return alert;
  }

  /** Every alert across all chats, for the periodic check. */
  async listAll(): Promise<PriceAlert[]> {
    const ids = await this.redis.smembers(REDIS_KEYS.allIds);
    return this.loadAlerts(ids);
  }

  /**
   * Persists an alert's new state. `SET ... XX` only writes if the key still
   * exists, so an alert its chat deleted while a check was running is not
   * recreated. Resolves false in that case.
   */
  async updateState(alert: PriceAlert): Promise<boolean> {
    const result = await this.redis.set(REDIS_KEYS.alert(alert.id), alert, { xx: true });
    return result === 'OK';
  }

  /** Appends to the capped delivery log (spec EPIC-002-FR12). */
  async recordDelivery(delivery: AlertDelivery): Promise<void> {
    await this.pushCapped(REDIS_KEYS.deliveries, delivery, MAX_DELIVERY_LOG_ENTRIES);
  }

  /** Appends to the capped run log (spec EPIC-002-NFR08 / AC18). */
  async recordRun(summary: AlertRunSummary): Promise<void> {
    await this.pushCapped(REDIS_KEYS.runs, summary, MAX_RUN_LOG_ENTRIES);
  }

  async listDeliveries(): Promise<AlertDelivery[]> {
    return this.redis.lrange<AlertDelivery>(REDIS_KEYS.deliveries, 0, -1);
  }

  async listRuns(): Promise<AlertRunSummary[]> {
    return this.redis.lrange<AlertRunSummary>(REDIS_KEYS.runs, 0, -1);
  }

  /**
   * Takes the check's run lock, so two overlapping scheduler calls never
   * evaluate the same alert twice (spec EPIC-002-AC14). The TTL frees the
   * lock if a run dies before releasing it.
   */
  async acquireRunLock(): Promise<boolean> {
    const result = await this.redis.set(REDIS_KEYS.runLock, this.runLockToken, {
      nx: true,
      ex: RUN_LOCK_TTL_SECONDS,
    });
    return result === 'OK';
  }

  async releaseRunLock(): Promise<void> {
    await this.redis.del(REDIS_KEYS.runLock);
  }

  private async loadAlerts(ids: (string | number)[]): Promise<PriceAlert[]> {
    if (ids.length === 0) {
      return [];
    }
    const alerts = await this.redis.mget<(PriceAlert | null)[]>(
      ...ids.map((id) => REDIS_KEYS.alert(id)),
    );
    return alerts
      .filter((alert): alert is PriceAlert => alert !== null)
      .sort((a, b) => a.id - b.id);
  }

  private async pushCapped(key: string, entry: object, maxEntries: number): Promise<void> {
    await this.redis
      .multi()
      .lpush(key, entry)
      .ltrim(key, 0, maxEntries - 1)
      .exec();
  }
}
