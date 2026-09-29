import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { HoldingsResult, PortfolioTrade, TradeSide } from './interfaces/portfolio.interface';
import { computeHoldings, heldQuantityOf } from './portfolio-calculator';
import {
  HISTORY_PAGE_SIZE,
  MAX_HELD_COINS,
  MAX_SOURCE_MESSAGE_ID_LENGTH,
  MAX_TRADES_PER_CHAT,
} from './portfolio.constants';

/** A sell larger than what the chat holds (spec EPIC-003-FR04). */
export class PortfolioOversellError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly heldQuantity: string,
  ) {
    super(`Sell exceeds held ${symbol}`);
  }
}

/** Too many trades, or a buy of one coin too many (spec EPIC-003-NFR05). */
export class PortfolioLimitError extends Error {
  constructor(
    public readonly kind: 'trades' | 'coins',
    public readonly limit: number,
  ) {
    super(`Portfolio ${kind} limit (${limit}) reached`);
  }
}

/** No trade with that number in this chat (spec EPIC-003-FR10). */
export class PortfolioTradeNotFoundError extends Error {
  constructor(public readonly index: number) {
    super(`Portfolio trade #${index} not found`);
  }
}

/** Deleting this trade would turn a later sell into an oversell (spec EPIC-003-FR10). */
export class PortfolioDeleteWouldOversellError extends Error {
  constructor(
    public readonly index: number,
    public readonly symbol: string,
  ) {
    super(`Deleting trade #${index} would oversell ${symbol}`);
  }
}

/**
 * The database failed. Carries a fixed message only: the driver's error can
 * quote the query's parameters, and those are the user's quantities and
 * prices, which must never reach the logs (spec EPIC-003-NFR06).
 */
export class PortfolioUnavailableError extends Error {
  constructor() {
    super('Portfolio store unavailable');
  }
}

const DOMAIN_ERRORS = [
  PortfolioOversellError,
  PortfolioLimitError,
  PortfolioTradeNotFoundError,
  PortfolioDeleteWouldOversellError,
];

interface TradeRow {
  chat_id?: string;
  seq: number | string;
  side: TradeSide;
  symbol: string;
  quantity: string | number;
  price_usd: string | number;
  created_at: string | Date;
}

interface SeqRow {
  seq: number | string;
}

export interface RecordedTrade {
  trade: PortfolioTrade;
  /** Every trade of the chat after this one was recorded, oldest first. */
  trades: PortfolioTrade[];
  /** True when this Zalo message had already recorded `trade` (a redelivered webhook). */
  duplicate: boolean;
}

export interface DeletedTrade {
  trade: PortfolioTrade;
  /** Every trade left in the chat, oldest first. */
  trades: PortfolioTrade[];
}

export interface TradePage {
  /** Newest first. */
  trades: PortfolioTrade[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Each chat's manually entered trades, in Postgres (Neon) next to
 * `subscribers`, through the same HTTP driver (see docs/ARCHITECTURE.md
 * "Portfolio"). Every write is one `sql.transaction([...])` — one HTTP
 * round-trip — whose first statement takes a per-chat advisory lock, so two
 * commands from the same chat run one after the other while different chats
 * never wait on each other (spec EPIC-003-NFR07). The rules that protect the
 * holdings (no oversell, trade and coin limits, no delete that breaks a later
 * sell) sit in the WHERE/HAVING of the same statement that writes, after the
 * lock: a failed rule writes nothing, a failed statement rolls everything back.
 */
@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.get<string>('db.connectionString')!;
    this.sql = neon(connectionString);
  }

  /**
   * Records one trade and returns it with the chat's trades after it. When a
   * rule refuses the write, the trades read in the same transaction say
   * which rule, and nothing was written.
   *
   * `sourceMessageId` is the Zalo `message_id` of the command. Zalo can
   * deliver the same webhook more than once: a message that already recorded
   * a trade gets that trade back with `duplicate: true`, and nothing is
   * written. The check runs under the chat lock; a unique index backs it up.
   * An id longer than the column allows is not used for this check, so an
   * unexpected id format can never make a trade fail to record.
   *
   * Only a trade actually written counts toward `portfolio_usage.writes`: the
   * counter is bumped from the INSERT's own RETURNING rows, in the same
   * statement, so a refused rule or a redelivered message adds nothing.
   */
  async recordTrade(
    chatId: string,
    side: TradeSide,
    symbol: string,
    quantity: string,
    priceUsd: number,
    sourceMessageId?: string,
  ): Promise<RecordedTrade> {
    return this.guard(async () => {
      const price = priceUsd.toString();
      const messageId =
        sourceMessageId && sourceMessageId.length <= MAX_SOURCE_MESSAGE_ID_LENGTH
          ? sourceMessageId
          : null;
      const [, inserted, rows, alreadyRecorded] = (await this.sql.transaction([
        this.lockChat(chatId),
        this.sql`
          WITH inserted AS (
          INSERT INTO portfolio_trades
            (chat_id, seq, side, symbol, quantity, price_usd, source_message_id)
          SELECT ${chatId}, COALESCE(MAX(seq), 0) + 1, ${side}, ${symbol},
                 ${quantity}::numeric, ${price}::numeric, ${messageId}::text
          FROM portfolio_trades
          WHERE chat_id = ${chatId}
          HAVING NOT EXISTS (
              SELECT 1 FROM portfolio_trades
              WHERE chat_id = ${chatId} AND source_message_id = ${messageId}::text
            )
            AND COUNT(*) < ${MAX_TRADES_PER_CHAT}
            AND (
              ${side} = 'buy'
              OR COALESCE(SUM(CASE WHEN symbol = ${symbol}
                                   THEN CASE WHEN side = 'buy' THEN quantity ELSE -quantity END
                              END), 0) >= ${quantity}::numeric
            )
            AND (
              ${side} = 'sell'
              OR (
                SELECT COUNT(*) FROM (
                  SELECT symbol FROM portfolio_trades
                  WHERE chat_id = ${chatId} AND symbol <> ${symbol}
                  GROUP BY symbol
                  HAVING SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) > 0
                ) AS other_held
              ) < ${MAX_HELD_COINS}
            )
          RETURNING seq
          ),
          counted AS (
            INSERT INTO portfolio_usage (chat_id, day, writes)
            SELECT ${chatId}, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 1 FROM inserted
            ON CONFLICT (chat_id, day) DO UPDATE SET writes = portfolio_usage.writes + 1
          )
          SELECT seq FROM inserted
        `,
        this.selectTrades(chatId),
        this.sql`
          SELECT seq FROM portfolio_trades
          WHERE chat_id = ${chatId} AND source_message_id = ${messageId}::text
        `,
      ])) as [unknown, SeqRow[], TradeRow[], SeqRow[] | undefined];

      const trades = rows.map((row) => this.toTrade(row));
      if (inserted.length === 0) {
        const original = alreadyRecorded?.[0];
        if (original) {
          const seq = Number(original.seq);
          return { trade: trades.find((trade) => trade.seq === seq)!, trades, duplicate: true };
        }
        throw this.refusalReason(trades, side, symbol);
      }
      const seq = Number(inserted[0].seq);
      return { trade: trades.find((trade) => trade.seq === seq)!, trades, duplicate: false };
    });
  }

  /** Every trade of the chat, oldest first. Counts as a portfolio view (spec EPIC-003-FR13). */
  async listTrades(chatId: string): Promise<PortfolioTrade[]> {
    return this.guard(async () => {
      const [, rows] = (await this.sql.transaction([
        this.countView(chatId),
        this.selectTrades(chatId),
      ])) as [unknown, TradeRow[]];
      return rows.map((row) => this.toTrade(row));
    });
  }

  /** One page of "/danhmuc lichsu", newest first (spec EPIC-003-FR09). */
  async listTradesPage(chatId: string, page: number): Promise<TradePage> {
    return this.guard(async () => {
      const offset = (page - 1) * HISTORY_PAGE_SIZE;
      const [countRows, rows] = (await this.sql.transaction([
        this.sql`SELECT COUNT(*) AS total FROM portfolio_trades WHERE chat_id = ${chatId}`,
        this.sql`
          SELECT seq, side, symbol, quantity, price_usd, created_at FROM portfolio_trades
          WHERE chat_id = ${chatId}
          ORDER BY seq DESC
          LIMIT ${HISTORY_PAGE_SIZE} OFFSET ${offset}
        `,
      ])) as [{ total: number | string }[], TradeRow[]];
      const total = Number(countRows[0].total);
      return {
        trades: rows.map((row) => this.toTrade(row)),
        total,
        page,
        pageCount: Math.ceil(total / HISTORY_PAGE_SIZE),
      };
    });
  }

  /**
   * Deletes the chat's trade number `index`, unless that would make the
   * running balance of its coin go negative at some later sell (spec
   * EPIC-003-FR10). Only ever touches rows of `chatId` (NFR06).
   */
  async deleteTrade(chatId: string, index: number): Promise<DeletedTrade> {
    return this.guard(async () => {
      const [, deleted, rows] = (await this.sql.transaction([
        this.lockChat(chatId),
        this.sql`
          DELETE FROM portfolio_trades AS target
          WHERE target.chat_id = ${chatId} AND target.seq = ${index}
            AND NOT EXISTS (
              SELECT 1 FROM (
                SELECT SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END)
                         OVER (ORDER BY seq) AS running
                FROM portfolio_trades
                WHERE chat_id = ${chatId} AND symbol = target.symbol AND seq <> ${index}
              ) AS balance
              WHERE balance.running < 0
            )
          RETURNING seq, side, symbol, quantity, price_usd, created_at
        `,
        this.selectTrades(chatId),
      ])) as [unknown, TradeRow[], TradeRow[]];

      const trades = rows.map((row) => this.toTrade(row));
      if (deleted.length > 0) {
        return { trade: this.toTrade(deleted[0]), trades };
      }
      const kept = trades.find((trade) => trade.seq === index);
      throw kept
        ? new PortfolioDeleteWouldOversellError(index, kept.symbol)
        : new PortfolioTradeNotFoundError(index);
    });
  }

  /** Deletes every trade of the chat (spec EPIC-003-FR14). Returns how many were deleted. */
  async clearTrades(chatId: string): Promise<number> {
    return this.guard(async () => {
      const [, deleted] = (await this.sql.transaction([
        this.lockChat(chatId),
        this.sql`DELETE FROM portfolio_trades WHERE chat_id = ${chatId} RETURNING seq`,
      ])) as [unknown, unknown[]];
      return deleted.length;
    });
  }

  /**
   * Trades of many chats in one query, for the daily digest (spec
   * EPIC-003-NFR03, NFR04). Chats with no trade are absent from the map.
   */
  async listTradesForChats(chatIds: string[]): Promise<Map<string, PortfolioTrade[]>> {
    const byChat = new Map<string, PortfolioTrade[]>();
    if (chatIds.length === 0) {
      return byChat;
    }
    return this.guard(async () => {
      const rows = (await this.sql`
        SELECT chat_id, seq, side, symbol, quantity, price_usd, created_at FROM portfolio_trades
        WHERE chat_id = ANY(${chatIds})
        ORDER BY chat_id, seq
      `) as TradeRow[];
      for (const row of rows) {
        const trades = byChat.get(row.chat_id!) ?? [];
        trades.push(this.toTrade(row));
        byChat.set(row.chat_id!, trades);
      }
      return byChat;
    });
  }

  /** Serializes this chat's writes until the transaction ends. */
  private lockChat(chatId: string) {
    return this.sql`SELECT pg_advisory_xact_lock(hashtext(${chatId}))`;
  }

  private selectTrades(chatId: string) {
    return this.sql`
      SELECT seq, side, symbol, quantity, price_usd, created_at FROM portfolio_trades
      WHERE chat_id = ${chatId}
      ORDER BY seq
    `;
  }

  /**
   * Per-chat per-day view counter behind the success metric (spec
   * EPIC-003-FR13). No amounts. The day is a calendar day in Vietnam time.
   * Writes are counted inside recordTrade, only when a trade is written.
   */
  private countView(chatId: string) {
    return this.sql`
      INSERT INTO portfolio_usage (chat_id, day, views)
      VALUES (${chatId}, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 1)
      ON CONFLICT (chat_id, day) DO UPDATE SET views = portfolio_usage.views + 1
    `;
  }

  /** Which rule refused a trade, from the trades read under the same lock. */
  private refusalReason(trades: PortfolioTrade[], side: TradeSide, symbol: string): Error {
    if (trades.length >= MAX_TRADES_PER_CHAT) {
      return new PortfolioLimitError('trades', MAX_TRADES_PER_CHAT);
    }
    const holdings: HoldingsResult = computeHoldings(trades);
    if (side === 'sell') {
      return new PortfolioOversellError(symbol, heldQuantityOf(holdings, symbol));
    }
    return new PortfolioLimitError('coins', MAX_HELD_COINS);
  }

  /** Lets domain errors through; turns anything else into PortfolioUnavailableError. */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (DOMAIN_ERRORS.some((type) => error instanceof type)) {
        throw error;
      }
      // Name and SQLSTATE only — the message can quote the user's amounts (NFR06).
      const code = (error as { code?: unknown })?.code;
      this.logger.error(
        `Portfolio query failed: ${error instanceof Error ? error.name : typeof error}${
          typeof code === 'string' ? ` (${code})` : ''
        }`,
      );
      throw new PortfolioUnavailableError();
    }
  }

  private toTrade(row: TradeRow): PortfolioTrade {
    return {
      seq: Number(row.seq),
      side: row.side,
      symbol: row.symbol,
      quantity: String(row.quantity),
      priceUsd: Number(row.price_usd),
      createdAt: new Date(row.created_at),
    };
  }
}
