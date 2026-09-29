import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { CoingeckoService } from '../coingecko/coingecko.service';
import {
  AlertDelivery,
  AlertDirection,
  AlertRunSummary,
  MonitorNotice,
  MonitorState,
  NoticeHold,
  NoticeHoldKind,
  PriceAlert,
  WatchdogState,
} from './interfaces/price-alert.interface';
import { isConditionMet } from './price-alert-evaluator';
import {
  MAX_ALERTS_PER_CHAT,
  MAX_DELIVERY_FAILURE_LOG_ENTRIES,
  MAX_DELIVERY_LOG_ENTRIES,
  MAX_MONITOR_NOTICES,
  MAX_RUN_LOG_ENTRIES,
  REDIS_KEYS,
  REJECTION_LOG_TTL_SECONDS,
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
    public readonly direction: AlertDirection,
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

/** Deletes the run lock only if it still holds this run's token (compare-and-delete). */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Adds a rejected-call count to its UTC minute's field and refreshes the
 * day hash's TTL — one command, so a flush costs exactly one Redis op
 * (spec EPIC-002-FIX-NFR03).
 */
const RECORD_REJECTIONS_SCRIPT = `
redis.call("HINCRBY", KEYS[1], ARGV[1], ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

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
      throw new AlertConditionAlreadyMetError(symbol, direction, coin.priceUsd);
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

  /**
   * Appends to the capped delivery log (spec EPIC-002-FR12). Successes and
   * failures go to separate lists, so a chat whose sends keep failing can't
   * push the successful deliveries the success metric needs out of the log.
   */
  async recordDelivery(delivery: AlertDelivery): Promise<void> {
    if (delivery.delivered) {
      await this.pushCapped(REDIS_KEYS.deliveries, delivery, MAX_DELIVERY_LOG_ENTRIES);
    } else {
      await this.pushCapped(
        REDIS_KEYS.deliveryFailures,
        delivery,
        MAX_DELIVERY_FAILURE_LOG_ENTRIES,
      );
    }
  }

  /** Appends to the capped run log (spec EPIC-002-NFR08 / AC18). */
  async recordRun(summary: AlertRunSummary): Promise<void> {
    await this.pushCapped(REDIS_KEYS.runs, summary, MAX_RUN_LOG_ENTRIES);
  }

  /**
   * Adds `count` rejected check calls to the minute `at` falls in (spec
   * EPIC-002-FIX-FR02). Stores a number only — never the secret, headers or
   * body of the rejected request (spec EPIC-002-FIX-NFR03).
   */
  async recordRejections(count: number, at: Date): Promise<void> {
    const iso = at.toISOString();
    await this.redis.eval(
      RECORD_REJECTIONS_SCRIPT,
      [REDIS_KEYS.rejected(iso.slice(0, 10))],
      [iso.slice(11, 16), String(count), String(REJECTION_LOG_TTL_SECONDS)],
    );
  }

  async listDeliveries(): Promise<AlertDelivery[]> {
    return this.redis.lrange<AlertDelivery>(REDIS_KEYS.deliveries, 0, -1);
  }

  async listDeliveryFailures(): Promise<AlertDelivery[]> {
    return this.redis.lrange<AlertDelivery>(REDIS_KEYS.deliveryFailures, 0, -1);
  }

  /** Newest `count` run summaries, newest first. */
  async listRecentRuns(count: number): Promise<AlertRunSummary[]> {
    return this.redis.lrange<AlertRunSummary>(REDIS_KEYS.runs, 0, count - 1);
  }

  /** Number of alerts currently stored, i.e. being watched. */
  async countAlerts(): Promise<number> {
    return this.redis.scard(REDIS_KEYS.allIds);
  }

  async getMonitorState(): Promise<MonitorState | null> {
    return this.redis.get<MonitorState>(REDIS_KEYS.monitor);
  }

  async setMonitorState(state: MonitorState): Promise<void> {
    await this.redis.set(REDIS_KEYS.monitor, state);
  }

  /** Watcher and watchdog state in one round-trip, for the check's look at the watcher. */
  async getMonitorAndWatchdogState(): Promise<[MonitorState | null, WatchdogState | null]> {
    const [monitor, watchdog] = await this.redis.mget<[MonitorState | null, WatchdogState | null]>(
      REDIS_KEYS.monitor,
      REDIS_KEYS.watchdog,
    );
    return [monitor, watchdog];
  }

  async setWatchdogState(state: WatchdogState): Promise<void> {
    await this.redis.set(REDIS_KEYS.watchdog, state);
  }

  /**
   * The owner-message holds (spec EPIC-002-FIX-NFR05), shared by every
   * instance, one per message kind: set when a message of that kind went out
   * that the monitoring state couldn't record, so no instance repeats it
   * before `holdMs` has passed. Only touched when a message is due or its
   * state failed to save.
   */
  async getNoticeHold(kind: NoticeHoldKind): Promise<NoticeHold | null> {
    return this.redis.get<NoticeHold>(REDIS_KEYS.noticeHold(kind));
  }

  /** Takes the hold unless another instance holds it: true when this call took it. */
  async claimNoticeHold(kind: NoticeHoldKind, hold: NoticeHold, holdMs: number): Promise<boolean> {
    const result = await this.redis.set(REDIS_KEYS.noticeHold(kind), hold, {
      nx: true,
      px: holdMs,
    });
    return result === 'OK';
  }

  async setNoticeHold(kind: NoticeHoldKind, hold: NoticeHold, holdMs: number): Promise<void> {
    await this.redis.set(REDIS_KEYS.noticeHold(kind), hold, { px: holdMs });
  }

  async releaseNoticeHold(kind: NoticeHoldKind): Promise<void> {
    await this.redis.del(REDIS_KEYS.noticeHold(kind));
  }

  async recordMonitorNotice(notice: MonitorNotice): Promise<void> {
    await this.pushCapped(REDIS_KEYS.monitorNotices, notice, MAX_MONITOR_NOTICES);
  }

  /**
   * Rejected check calls counted from the minute `since` falls in up to now,
   * reading one day hash per UTC day touched (at most the 3 days kept).
   */
  async countRejectionsSince(since: string, now: Date): Promise<number> {
    const sinceMinute = since.slice(0, 16);
    const days: string[] = [];
    for (let i = 0; i < REJECTION_LOG_TTL_SECONDS / 86_400; i++) {
      const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      if (day < since.slice(0, 10)) break;
      days.push(day);
    }
    const hashes = await Promise.all(
      days.map((day) => this.redis.hgetall<Record<string, number>>(REDIS_KEYS.rejected(day))),
    );
    let total = 0;
    hashes.forEach((hash, i) => {
      for (const [minute, count] of Object.entries(hash ?? {})) {
        if (`${days[i]}T${minute}` >= sinceMinute) total += Number(count);
      }
    });
    return total;
  }

  async listRuns(): Promise<AlertRunSummary[]> {
    return this.redis.lrange<AlertRunSummary>(REDIS_KEYS.runs, 0, -1);
  }

  /**
   * Takes the check's run lock, so two overlapping scheduler calls never
   * evaluate the same alert twice (spec EPIC-002-AC14). The TTL frees the
   * lock if a run dies before releasing it. Resolves this run's token, or
   * null when another run holds the lock. The token is per call, not per
   * instance, because one warm instance can serve overlapping requests.
   */
  async acquireRunLock(): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(REDIS_KEYS.runLock, token, {
      nx: true,
      ex: RUN_LOCK_TTL_SECONDS,
    });
    return result === 'OK' ? token : null;
  }

  /** Releases the lock only if it is still ours — never another run's lock after our TTL expired. */
  async releaseRunLock(token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, [REDIS_KEYS.runLock], [token]);
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
