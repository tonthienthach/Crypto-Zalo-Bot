import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import {
  ChatSignalState,
  SignalRecord,
  SignalRunSummary,
  SignalsOutage,
  SignalUsageKind,
} from './interfaces/signal.interface';
import {
  DAY_MS,
  EXTRA_TRACK_TTL_MS,
  MAX_EXTRA_TRACKED,
  MAX_RECORDS_PER_CHAT,
  MAX_RUN_LOG_ENTRIES,
  RECORD_TTL_DAYS,
  REDIS_KEYS,
  RUN_LOCK_TTL_SECONDS,
  SIGNALS_OUTAGE_TTL_SECONDS,
  USAGE_TTL_SECONDS,
} from './signals.constants';

/** Deletes the run lock only if it still holds this run's token (compare-and-delete). */
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Adds a coin to the tracked-extra set unless the set is full. Expired
 * entries are dropped first. ARGV: now, symbol, max, expiry. Returns 1 when
 * the coin is (now) tracked, 0 when the set is full.
 */
const TRACK_EXTRA_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", "(" .. ARGV[1])
local known = redis.call("ZSCORE", KEYS[1], ARGV[2])
if not known and redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  return 0
end
redis.call("ZADD", KEYS[1], ARGV[4], ARGV[2])
return 1
`;

/**
 * Stores verdict records ("<symbol>:<verdict>:<day>" -> "<usd>:<ms>"), one
 * per coin, verdict and day: HSETNX keeps the first. Then drops records older
 * than the cutoff and, beyond the cap, the oldest ones. ARGV: cutoffMs, max,
 * ttlSeconds, then field/value pairs.
 */
const RECORD_VERDICTS_SCRIPT = `
for i = 4, #ARGV, 2 do
  redis.call("HSETNX", KEYS[1], ARGV[i], ARGV[i + 1])
end
local all = redis.call("HGETALL", KEYS[1])
local entries = {}
for i = 1, #all, 2 do
  table.insert(entries, { all[i], tonumber(string.match(all[i + 1], ":(%d+)$")) or 0 })
end
table.sort(entries, function(a, b) return a[2] < b[2] end)
local excess = #entries - tonumber(ARGV[2])
for i = 1, #entries do
  if entries[i][2] < tonumber(ARGV[1]) or i <= excess then
    redis.call("HDEL", KEYS[1], entries[i][1])
  end
end
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

/** Adds one to a usage counter and refreshes the day hash's TTL, in one command. */
const RECORD_USAGE_SCRIPT = `
redis.call("HINCRBY", KEYS[1], ARGV[1], 1)
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 1
`;

/** UTC day (YYYY-MM-DD) of an epoch-ms time, as used in keys and record fields. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** HGETALL comes back as a flat [field, value, ...] list when replies are not auto-parsed. */
export function hashToRecord(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Small state around signals, all in Upstash Redis: the mirror of each chat's
 * watchlist, who turned alerts off, what each chat was last told, the
 * verdicts that were sent, extra coins tracked, usage counters and the run
 * log. See SignalsHistoryService for why Redis and not Postgres.
 */
@Injectable()
export class SignalsStateService {
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      url: this.configService.get<string>('redis.restUrl')!,
      token: this.configService.get<string>('redis.restToken')!,
      automaticDeserialization: false,
    });
  }

  // ---- watchlist mirror ------------------------------------------------

  async setWatchlist(chatId: string, symbols: string[]): Promise<void> {
    await this.redis.hset(REDIS_KEYS.watchlists, { [chatId]: JSON.stringify(symbols) });
  }

  async removeWatchlist(chatId: string): Promise<void> {
    await this.redis.hdel(REDIS_KEYS.watchlists, chatId);
  }

  /** Replaces the whole mirror, so a missed update heals itself. */
  async replaceWatchlists(all: Record<string, string[]>): Promise<void> {
    const fields = Object.fromEntries(
      Object.entries(all).map(([chatId, symbols]) => [chatId, JSON.stringify(symbols)]),
    );
    const tx = this.redis.multi().del(REDIS_KEYS.watchlists);
    if (Object.keys(fields).length > 0) tx.hset(REDIS_KEYS.watchlists, fields);
    await tx.exec();
  }

  async getWatchlists(): Promise<Record<string, string[]>> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(REDIS_KEYS.watchlists);
    const out: Record<string, string[]> = {};
    for (const [chatId, value] of Object.entries(hashToRecord(raw))) {
      const symbols = parseJson<string[]>(value);
      if (symbols) out[chatId] = symbols;
    }
    return out;
  }

  // ---- proactive on/off ------------------------------------------------

  async setEnabled(chatId: string, enabled: boolean): Promise<void> {
    if (enabled) await this.redis.srem(REDIS_KEYS.disabled, chatId);
    else await this.redis.sadd(REDIS_KEYS.disabled, chatId);
  }

  async isEnabled(chatId: string): Promise<boolean> {
    return (await this.redis.sismember(REDIS_KEYS.disabled, chatId)) === 0;
  }

  async listDisabled(): Promise<Set<string>> {
    return new Set((await this.redis.smembers(REDIS_KEYS.disabled)).map(String));
  }

  // ---- what each chat was last told -----------------------------------

  async getSentStates(): Promise<Record<string, ChatSignalState>> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(REDIS_KEYS.sent);
    const out: Record<string, ChatSignalState> = {};
    for (const [chatId, value] of Object.entries(hashToRecord(raw))) {
      const state = parseJson<ChatSignalState>(value);
      if (state) out[chatId] = state;
    }
    return out;
  }

  async setSentState(chatId: string, state: ChatSignalState): Promise<void> {
    await this.redis.hset(REDIS_KEYS.sent, { [chatId]: JSON.stringify(state) });
  }

  // ---- verdict records -------------------------------------------------

  /** Stores verdicts that were really sent; the same coin, verdict and UTC day is kept once. */
  async recordVerdicts(chatId: string, records: SignalRecord[], now: number): Promise<void> {
    if (records.length === 0) return;
    const pairs = records.flatMap((record) => [
      `${record.symbol}:${record.verdict}:${utcDay(record.at)}`,
      `${record.priceUsd}:${record.at}`,
    ]);
    await this.redis.eval(
      RECORD_VERDICTS_SCRIPT,
      [REDIS_KEYS.records(chatId)],
      [
        String(now - RECORD_TTL_DAYS * DAY_MS),
        String(MAX_RECORDS_PER_CHAT),
        String(RECORD_TTL_DAYS * 86_400),
        ...pairs,
      ],
    );
  }

  /** The chat's verdict records given at or after `sinceMs`, oldest first. */
  async listRecords(chatId: string, sinceMs: number): Promise<SignalRecord[]> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(REDIS_KEYS.records(chatId));
    const records: SignalRecord[] = [];
    for (const [field, value] of Object.entries(hashToRecord(raw))) {
      const [symbol, verdict] = field.split(':');
      const [price, at] = String(value).split(':');
      if (verdict !== 'buy' && verdict !== 'sell') continue;
      const record = { symbol, verdict, priceUsd: Number(price), at: Number(at) } as SignalRecord;
      if (Number.isFinite(record.priceUsd) && Number.isFinite(record.at) && record.at >= sinceMs) {
        records.push(record);
      }
    }
    return records.sort((a, b) => a.at - b.at);
  }

  // ---- coins asked about but on nobody's watchlist --------------------

  /** Tracks `symbol` for EXTRA_TRACK_TTL_MS; false when MAX_EXTRA_TRACKED coins are already tracked. */
  async trackExtra(symbol: string, now: number): Promise<boolean> {
    const result = await this.redis.eval(
      TRACK_EXTRA_SCRIPT,
      [REDIS_KEYS.extra],
      [String(now), symbol, String(MAX_EXTRA_TRACKED), String(now + EXTRA_TRACK_TTL_MS)],
    );
    return Number(result) === 1;
  }

  async listExtra(now: number): Promise<string[]> {
    const members = await this.redis.zrange<string[]>(REDIS_KEYS.extra, now, '+inf', {
      byScore: true,
    });
    return members.map(String);
  }

  // ---- usage and run log ----------------------------------------------

  /** Counts one use by a chat (spec EPIC-004-FR12): numbers only, no verdicts. */
  async recordUsage(chatId: string, kind: SignalUsageKind, now: number): Promise<void> {
    await this.redis.eval(
      RECORD_USAGE_SCRIPT,
      [REDIS_KEYS.usage(utcDay(now))],
      [`${chatId}|${kind}`, String(USAGE_TTL_SECONDS)],
    );
  }

  async acquireRunLock(): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(REDIS_KEYS.runLock, token, {
      nx: true,
      ex: RUN_LOCK_TTL_SECONDS,
    });
    return result === 'OK' ? token : null;
  }

  async releaseRunLock(token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, [REDIS_KEYS.runLock], [token]);
  }

  /** Appends to the capped run log; a healthy run also stamps `lastHealthy` for the watcher. */
  async recordRun(summary: SignalRunSummary): Promise<void> {
    const tx = this.redis
      .multi()
      .lpush(REDIS_KEYS.runs, JSON.stringify(summary))
      .ltrim(REDIS_KEYS.runs, 0, MAX_RUN_LOG_ENTRIES - 1);
    if (summary.outcome === 'healthy') tx.set(REDIS_KEYS.lastHealthy, summary.at);
    await tx.exec();
  }

  async listRecentRuns(count: number): Promise<SignalRunSummary[]> {
    const raw = await this.redis.lrange<string>(REDIS_KEYS.runs, 0, count - 1);
    return raw
      .map((entry) => parseJson<SignalRunSummary>(entry))
      .filter((entry): entry is SignalRunSummary => entry !== null);
  }

  // ---- owner monitoring --------------------------------------------------

  /** The last healthy run and the recorded outage in one command, for the watcher's look every 5 minutes. */
  async getHealthAndOutage(): Promise<[string | null, SignalsOutage | null]> {
    const [lastHealthy, outage] = await this.redis.mget<(string | null)[]>(
      REDIS_KEYS.lastHealthy,
      REDIS_KEYS.outage,
    );
    return [lastHealthy ?? null, parseJson<SignalsOutage>(outage)];
  }

  /** Records a new outage unless one is already recorded: true for the one caller that wins. */
  async claimOutage(outage: SignalsOutage): Promise<boolean> {
    const result = await this.redis.set(REDIS_KEYS.outage, JSON.stringify(outage), {
      nx: true,
      ex: SIGNALS_OUTAGE_TTL_SECONDS,
    });
    return result === 'OK';
  }

  async setOutage(outage: SignalsOutage): Promise<void> {
    await this.redis.set(REDIS_KEYS.outage, JSON.stringify(outage), {
      ex: SIGNALS_OUTAGE_TTL_SECONDS,
    });
  }

  async clearOutage(): Promise<void> {
    await this.redis.del(REDIS_KEYS.outage);
  }

  /** Removes and returns the outage in one step, so only one caller sends the "recovered" message. */
  async takeOutage(): Promise<SignalsOutage | null> {
    return parseJson<SignalsOutage>(await this.redis.getdel<string>(REDIS_KEYS.outage));
  }

  /** ISO time of the last healthy run, or null when there has never been one. */
  async getLastHealthyAt(): Promise<string | null> {
    return this.redis.get<string>(REDIS_KEYS.lastHealthy);
  }
}
