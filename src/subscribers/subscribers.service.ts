import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { Subscriber } from './interfaces/subscriber.interface';
import { MAX_WATCHLIST_SIZE } from './subscribers.constants';

/** Raised when a watchlist has no valid symbols left after normalization, or exceeds the cap. */
export class InvalidWatchlistError extends Error {}

interface SubscriberRow {
  chat_id: string;
  watchlist: string[];
  is_active: boolean;
  created_at: string;
}

/**
 * Persistence for digest subscribers, backed by Vercel Postgres (Neon).
 * Uses the Neon HTTP driver (`neon()`), not a pooled client — this app runs
 * as short-lived Vercel serverless functions, one query per invocation at
 * most, so a per-call HTTP query avoids managing a connection pool across
 * cold starts.
 */
@Injectable()
export class SubscribersService {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.get<string>('db.connectionString')!;
    this.sql = neon(connectionString);
  }

  /** Subscribes a chat, or reactivates + updates its watchlist if it already existed. */
  async subscribe(chatId: string, watchlist: string[]): Promise<Subscriber> {
    const normalized = this.normalizeWatchlist(watchlist);
    const rows = (await this.sql`
      INSERT INTO subscribers (chat_id, watchlist, is_active)
      VALUES (${chatId}, ${normalized}, true)
      ON CONFLICT (chat_id)
      DO UPDATE SET watchlist = EXCLUDED.watchlist, is_active = true
      RETURNING chat_id, watchlist, is_active, created_at
    `) as SubscriberRow[];
    return this.toSubscriber(rows[0]);
  }

  /** Marks a chat inactive. Row is kept (not deleted) so re-subscribing restores history. */
  async unsubscribe(chatId: string): Promise<void> {
    await this.sql`
      UPDATE subscribers SET is_active = false WHERE chat_id = ${chatId}
    `;
  }

  async updateWatchlist(chatId: string, watchlist: string[]): Promise<Subscriber | null> {
    const normalized = this.normalizeWatchlist(watchlist);
    const rows = (await this.sql`
      UPDATE subscribers SET watchlist = ${normalized}
      WHERE chat_id = ${chatId} AND is_active = true
      RETURNING chat_id, watchlist, is_active, created_at
    `) as SubscriberRow[];
    return rows[0] ? this.toSubscriber(rows[0]) : null;
  }

  async findActiveByChatId(chatId: string): Promise<Subscriber | null> {
    const rows = (await this.sql`
      SELECT chat_id, watchlist, is_active, created_at FROM subscribers
      WHERE chat_id = ${chatId} AND is_active = true
    `) as SubscriberRow[];
    return rows[0] ? this.toSubscriber(rows[0]) : null;
  }

  /** All active subscribers, for the daily digest cron to iterate over. */
  async listActive(): Promise<Subscriber[]> {
    const rows = (await this.sql`
      SELECT chat_id, watchlist, is_active, created_at FROM subscribers WHERE is_active = true
    `) as SubscriberRow[];
    return rows.map((row) => this.toSubscriber(row));
  }

  private normalizeWatchlist(watchlist: string[]): string[] {
    const normalized = Array.from(
      new Set(watchlist.map((symbol) => symbol.trim().toLowerCase()).filter(Boolean)),
    );
    if (normalized.length === 0) {
      throw new InvalidWatchlistError('Watchlist must contain at least one symbol');
    }
    if (normalized.length > MAX_WATCHLIST_SIZE) {
      throw new InvalidWatchlistError(`Watchlist cannot exceed ${MAX_WATCHLIST_SIZE} symbols`);
    }
    return normalized;
  }

  private toSubscriber(row: SubscriberRow): Subscriber {
    return {
      chatId: row.chat_id,
      watchlist: row.watchlist,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
    };
  }
}
