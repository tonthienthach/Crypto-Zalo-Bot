import {
  PortfolioDeleteWouldOversellError,
  PortfolioLimitError,
  PortfolioOversellError,
  PortfolioService,
  PortfolioTradeNotFoundError,
  PortfolioUnavailableError,
} from '../../src/portfolio/portfolio.service';
import { computeHoldings } from '../../src/portfolio/portfolio-calculator';

export interface PortfolioStoreContext {
  /** The PortfolioService under test, wired to the database being tested. */
  service: () => PortfolioService;
  /** Runs raw SQL against the same database, for fixtures and assertions. */
  exec: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
}

const CHAT_A = 'store-chat-a';
const CHAT_B = 'store-chat-b';

async function tradeCount(ctx: PortfolioStoreContext, chatId: string): Promise<number> {
  const rows = await ctx.exec('SELECT COUNT(*) AS n FROM portfolio_trades WHERE chat_id = $1', [
    chatId,
  ]);
  return Number(rows[0].n);
}

/**
 * The store's behavior against a real Postgres (EPIC-003 AC01, AC02, AC04,
 * AC08, AC09, AC14, AC15, AC16, AC19). Each test starts from empty tables.
 */
export function definePortfolioStoreScenarios(ctx: PortfolioStoreContext): void {
  beforeEach(async () => {
    await ctx.exec('DELETE FROM portfolio_trades');
    await ctx.exec('DELETE FROM portfolio_usage');
  });

  it('AC01/AC02: records buys and a sell with stable numbers, and the holdings add up', async () => {
    const first = await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000);
    expect(first.trade).toEqual(
      expect.objectContaining({ seq: 1, side: 'buy', symbol: 'btc', priceUsd: 60000 }),
    );
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 70000);
    const sell = await ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.4', 80000);

    expect(sell.trade.seq).toBe(3);
    expect(sell.trades.map((trade) => trade.seq)).toEqual([1, 2, 3]);
    const holdings = computeHoldings(sell.trades);
    expect(holdings.holdings[0].quantity).toBe('0.6');
    expect(holdings.holdings[0].avgCostUsd).toBeCloseTo(65000, 6);
    expect(holdings.realizedPnlUsd).toBeCloseTo(6000, 6);
  });

  it('keeps exact quantities and 8-decimal prices through NUMERIC', async () => {
    const { trade } = await ctx
      .service()
      .recordTrade(CHAT_A, 'buy', 'shib', '1000000000000', 0.00000001);

    expect(computeHoldings([trade]).holdings[0].quantity).toBe('1000000000000');
    expect(trade.priceUsd).toBe(0.00000001);
  });

  it('AC04: a sell larger than the holding is refused with the held quantity, nothing written', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.6', 60000);

    await expect(ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '2', 80000)).rejects.toEqual(
      new PortfolioOversellError('btc', '0.6'),
    );
    await expect(
      ctx.service().recordTrade(CHAT_A, 'sell', 'eth', '1', 2000),
    ).rejects.toBeInstanceOf(PortfolioOversellError);
    expect(await tradeCount(ctx, CHAT_A)).toBe(1);
  });

  it('a redelivered Zalo message records its trade once; another message, or another chat, records again', async () => {
    const first = await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000, 'msg-1');
    const again = await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000, 'msg-1');

    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.trade.seq).toBe(first.trade.seq);
    expect(await tradeCount(ctx, CHAT_A)).toBe(1);

    // A new message with the same trade is a second trade (AC19); ids are per chat.
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000, 'msg-2');
    await ctx.service().recordTrade(CHAT_B, 'buy', 'btc', '0.5', 60000, 'msg-1');
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000);
    expect(await tradeCount(ctx, CHAT_A)).toBe(3);
    expect(await tradeCount(ctx, CHAT_B)).toBe(1);
  });

  it('only a trade actually written counts as a write: refused and redelivered ones do not', async () => {
    const writes = async () => {
      const rows = await ctx.exec(
        'SELECT COALESCE(SUM(writes), 0) AS n FROM portfolio_usage WHERE chat_id = $1',
        [CHAT_A],
      );
      return Number(rows[0].n);
    };

    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000, 'msg-1');
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000, 'msg-1');
    await expect(ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '9', 60000)).rejects.toEqual(
      new PortfolioOversellError('btc', '0.5'),
    );
    expect(await writes()).toBe(1);

    await ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.5', 61000);
    expect(await writes()).toBe(2);
  });

  it('a message_id longer than the column allows still records the trade', async () => {
    const { duplicate } = await ctx
      .service()
      .recordTrade(CHAT_A, 'buy', 'btc', '1', 60000, 'x'.repeat(200));

    expect(duplicate).toBe(false);
    expect(await tradeCount(ctx, CHAT_A)).toBe(1);
  });

  it('a sell of exactly the held quantity is allowed', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.6', 60000);
    const { trades } = await ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.6', 61000);

    expect(computeHoldings(trades).holdings).toEqual([]);
  });

  it('AC08: history is newest first, paged, and old numbers stay after a new trade', async () => {
    for (const price of [100, 200, 300]) {
      await ctx.service().recordTrade(CHAT_A, 'buy', 'sol', '1', price);
    }
    const page = await ctx.service().listTradesPage(CHAT_A, 1);
    expect(page.trades.map((trade) => trade.seq)).toEqual([3, 2, 1]);
    expect(page).toEqual(expect.objectContaining({ total: 3, page: 1, pageCount: 1 }));

    await ctx.service().recordTrade(CHAT_A, 'buy', 'sol', '1', 400);
    const after = await ctx.service().listTradesPage(CHAT_A, 1);
    expect(after.trades.map((trade) => [trade.seq, trade.priceUsd])).toEqual([
      [4, 400],
      [3, 300],
      [2, 200],
      [1, 100],
    ]);
    expect((await ctx.service().listTradesPage(CHAT_A, 2)).trades).toEqual([]);
  });

  it('AC09: deletes only when no later sell breaks, and only in the own chat', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000);
    await ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.5', 70000);
    await ctx.service().recordTrade(CHAT_B, 'buy', 'btc', '2', 50000);

    await expect(ctx.service().deleteTrade(CHAT_A, 1)).rejects.toEqual(
      new PortfolioDeleteWouldOversellError(1, 'btc'),
    );
    expect(await tradeCount(ctx, CHAT_A)).toBe(2);

    const deleted = await ctx.service().deleteTrade(CHAT_A, 2);
    expect(deleted.trade).toEqual(expect.objectContaining({ seq: 2, side: 'sell' }));
    expect(computeHoldings(deleted.trades).holdings[0].quantity).toBe('1');

    await expect(ctx.service().deleteTrade(CHAT_A, 99)).rejects.toEqual(
      new PortfolioTradeNotFoundError(99),
    );
    // Chat B's trade #1 exists, but chat A can't reach it.
    await ctx.service().deleteTrade(CHAT_A, 1);
    await expect(ctx.service().deleteTrade(CHAT_A, 1)).rejects.toBeInstanceOf(
      PortfolioTradeNotFoundError,
    );
    expect(await tradeCount(ctx, CHAT_B)).toBe(1);
  });

  it('a buy that a later sell needs can go once that sell is deleted; other coins never block', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000);
    await ctx.service().recordTrade(CHAT_A, 'buy', 'eth', '1', 2000);
    await ctx.service().recordTrade(CHAT_A, 'sell', 'eth', '1', 2500);

    // Deleting the BTC buy doesn't touch the ETH running balance.
    await ctx.service().deleteTrade(CHAT_A, 1);
    await expect(ctx.service().deleteTrade(CHAT_A, 2)).rejects.toBeInstanceOf(
      PortfolioDeleteWouldOversellError,
    );
    await ctx.service().deleteTrade(CHAT_A, 3);
    await ctx.service().deleteTrade(CHAT_A, 2);
    expect(await tradeCount(ctx, CHAT_A)).toBe(0);
  });

  it('AC14: the 201st trade is refused', async () => {
    await ctx.exec(
      `INSERT INTO portfolio_trades (chat_id, seq, side, symbol, quantity, price_usd)
       SELECT $1, g, 'buy', 'btc', 1, 1 FROM generate_series(1, 200) AS g`,
      [CHAT_A],
    );

    await expect(ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 1)).rejects.toEqual(
      new PortfolioLimitError('trades', 200),
    );
    expect(await tradeCount(ctx, CHAT_A)).toBe(200);
  });

  it('AC14: a 21st held coin is refused, more of a held coin and coins sold out are fine', async () => {
    await ctx.exec(
      `INSERT INTO portfolio_trades (chat_id, seq, side, symbol, quantity, price_usd)
       SELECT $1, g, 'buy', 'c' || g, 1, 1 FROM generate_series(1, 20) AS g`,
      [CHAT_A],
    );

    await expect(ctx.service().recordTrade(CHAT_A, 'buy', 'c21', '1', 1)).rejects.toEqual(
      new PortfolioLimitError('coins', 20),
    );
    await ctx.service().recordTrade(CHAT_A, 'buy', 'c1', '1', 1);
    await ctx.service().recordTrade(CHAT_A, 'sell', 'c2', '1', 1);
    await ctx.service().recordTrade(CHAT_A, 'buy', 'c21', '1', 1);
    expect(await tradeCount(ctx, CHAT_A)).toBe(23);
  });

  it('AC15: clear deletes every trade of the chat and nothing else', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000);
    await ctx.service().recordTrade(CHAT_A, 'buy', 'eth', '1', 2000);
    await ctx.service().recordTrade(CHAT_B, 'buy', 'btc', '1', 60000);

    expect(await ctx.service().clearTrades(CHAT_A)).toBe(2);
    expect(await ctx.service().listTrades(CHAT_A)).toEqual([]);
    expect(await tradeCount(ctx, CHAT_B)).toBe(1);
    // A cleared chat starts numbering again.
    expect((await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 1)).trade.seq).toBe(1);
  });

  it('AC16: views and writes are counted per chat and day, with no amounts', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '0.5', 60000);
    await ctx.service().listTrades(CHAT_A);
    await ctx.service().listTrades(CHAT_A);

    const rows = await ctx.exec('SELECT * FROM portfolio_usage WHERE chat_id = $1', [CHAT_A]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ views: 2, writes: 1 }));
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['chat_id', 'day', 'first_seen_at', 'views', 'writes'].sort(),
    );
  });

  it('AC19: two buys sent at once are both recorded, with distinct numbers', async () => {
    const results = await Promise.all([
      ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000),
      ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000),
    ]);

    expect(results.map((r) => r.trade.seq).sort()).toEqual([1, 2]);
    const trades = await ctx.service().listTrades(CHAT_A);
    expect(computeHoldings(trades).holdings[0].quantity).toBe('2');
  });

  it('AC19: of two sells sent at once that together oversell, exactly one is recorded', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000);

    const results = await Promise.allSettled([
      ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.6', 70000),
      ctx.service().recordTrade(CHAT_A, 'sell', 'btc', '0.6', 70000),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(PortfolioOversellError);
    const trades = await ctx.service().listTrades(CHAT_A);
    expect(computeHoldings(trades).holdings[0].quantity).toBe('0.4');
  });

  it('AC19: a statement failing mid-transaction leaves no trade and no usage row', async () => {
    // A symbol longer than the column allows fails the INSERT after the lock ran.
    await expect(
      ctx.service().recordTrade(CHAT_A, 'buy', 'x'.repeat(21), '1', 1),
    ).rejects.toBeInstanceOf(PortfolioUnavailableError);

    expect(await tradeCount(ctx, CHAT_A)).toBe(0);
    expect(await ctx.exec('SELECT * FROM portfolio_usage')).toEqual([]);
  });

  it('loads many chats in one query for the digest', async () => {
    await ctx.service().recordTrade(CHAT_A, 'buy', 'btc', '1', 60000);
    await ctx.service().recordTrade(CHAT_A, 'buy', 'eth', '2', 2000);
    await ctx.service().recordTrade(CHAT_B, 'buy', 'sol', '3', 100);

    const byChat = await ctx.service().listTradesForChats([CHAT_A, CHAT_B, 'no-trades']);

    expect(byChat.get(CHAT_A)?.map((trade) => trade.symbol)).toEqual(['btc', 'eth']);
    expect(byChat.get(CHAT_B)?.map((trade) => trade.symbol)).toEqual(['sol']);
    expect(byChat.has('no-trades')).toBe(false);
  });
}
