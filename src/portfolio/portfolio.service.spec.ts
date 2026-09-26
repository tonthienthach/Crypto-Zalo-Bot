import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PortfolioDeleteWouldOversellError,
  PortfolioLimitError,
  PortfolioOversellError,
  PortfolioService,
  PortfolioTradeNotFoundError,
  PortfolioUnavailableError,
} from './portfolio.service';

/** A tagged-template call is recorded as its SQL text and values, so the tests can inspect it. */
interface RecordedQuery {
  text: string;
  values: unknown[];
}

const mockSql = jest.fn((strings: TemplateStringsArray, ...values: unknown[]): RecordedQuery => ({
  text: strings.join('$'),
  values,
})) as jest.Mock & { transaction: jest.Mock };
mockSql.transaction = jest.fn();

jest.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));

function row(seq: number, side: 'buy' | 'sell', symbol: string, quantity: string, price: string) {
  return {
    seq,
    side,
    symbol,
    quantity,
    price_usd: price,
    created_at: '2026-09-25T02:00:00.000Z',
  };
}

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(async () => {
    mockSql.mockClear();
    mockSql.transaction.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: ConfigService,
          useValue: { get: () => 'postgres://test:test@localhost:5432/test' },
        },
      ],
    }).compile();

    service = moduleRef.get(PortfolioService);
  });

  function transactionQueries(call = 0): RecordedQuery[] {
    return mockSql.transaction.mock.calls[call][0] as RecordedQuery[];
  }

  describe('recordTrade', () => {
    it('runs lock, insert, usage and read in one transaction, and returns the new trade', async () => {
      mockSql.transaction.mockResolvedValue([
        [],
        [{ seq: 2 }],
        [],
        [
          row(1, 'buy', 'btc', '0.50000000', '60000.00000000'),
          row(2, 'buy', 'btc', '0.5', '70000'),
        ],
      ]);

      const result = await service.recordTrade('chat-1', 'buy', 'btc', '0.5', 70000);

      expect(mockSql.transaction).toHaveBeenCalledTimes(1);
      const [lock, insert, usage] = transactionQueries();
      expect(lock.text).toContain('pg_advisory_xact_lock(hashtext(');
      expect(lock.values).toEqual(['chat-1']);
      expect(insert.text).toContain('INSERT INTO portfolio_trades');
      expect(insert.text).toContain('HAVING COUNT(*) <');
      // The quantity is sent as exact text, cast to NUMERIC in SQL — never through a float.
      expect(insert.values).toContain('0.5');
      expect(insert.values).toContain('70000');
      expect(usage.text).toContain('INSERT INTO portfolio_usage');
      expect(result.trade).toEqual({
        seq: 2,
        side: 'buy',
        symbol: 'btc',
        quantity: '0.5',
        priceUsd: 70000,
        createdAt: new Date('2026-09-25T02:00:00.000Z'),
      });
      expect(result.trades.map((trade) => trade.quantity)).toEqual(['0.50000000', '0.5']);
    });

    it('a refused sell reports the held quantity (FR04)', async () => {
      mockSql.transaction.mockResolvedValue([[], [], [], [row(1, 'buy', 'btc', '0.6', '60000')]]);

      await expect(service.recordTrade('chat-1', 'sell', 'btc', '2', 80000)).rejects.toEqual(
        new PortfolioOversellError('btc', '0.6'),
      );
    });

    it('a refused write at 200 trades reports the trade limit (NFR05)', async () => {
      const trades = Array.from({ length: 200 }, (_, i) => row(i + 1, 'buy', 'btc', '1', '1'));
      mockSql.transaction.mockResolvedValue([[], [], [], trades]);

      await expect(service.recordTrade('chat-1', 'buy', 'btc', '1', 1)).rejects.toEqual(
        new PortfolioLimitError('trades', 200),
      );
    });

    it('a refused buy under 200 trades reports the held-coin limit (NFR05)', async () => {
      const trades = Array.from({ length: 20 }, (_, i) => row(i + 1, 'buy', `c${i}`, '1', '1'));
      mockSql.transaction.mockResolvedValue([[], [], [], trades]);

      await expect(service.recordTrade('chat-1', 'buy', 'c20', '1', 1)).rejects.toEqual(
        new PortfolioLimitError('coins', 20),
      );
    });

    it('a database error becomes PortfolioUnavailableError, and the log carries no amounts (NFR06)', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      mockSql.transaction.mockRejectedValue(
        Object.assign(new Error('value "123.456" violates check constraint'), { code: '23514' }),
      );

      await expect(
        service.recordTrade('chat-1', 'buy', 'btc', '123.456', 60000),
      ).rejects.toBeInstanceOf(PortfolioUnavailableError);
      const logged = logError.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('23514');
      expect(logged).not.toContain('123.456');
      expect(logged).not.toContain('60000');
      logError.mockRestore();
    });
  });

  describe('deleteTrade', () => {
    it('returns the deleted trade and what is left', async () => {
      mockSql.transaction.mockResolvedValue([
        [],
        [row(2, 'sell', 'btc', '0.5', '70000')],
        [row(1, 'buy', 'btc', '1', '60000')],
      ]);

      const result = await service.deleteTrade('chat-1', 2);

      const [, remove] = transactionQueries();
      expect(remove.text).toContain('DELETE FROM portfolio_trades');
      expect(remove.text).toContain('balance.running < 0');
      expect(remove.values).toEqual(expect.arrayContaining(['chat-1', 2]));
      expect(result.trade.seq).toBe(2);
      expect(result.trades.map((trade) => trade.seq)).toEqual([1]);
    });

    it('a trade that still exists after the delete would break a later sell', async () => {
      mockSql.transaction.mockResolvedValue([
        [],
        [],
        [row(1, 'buy', 'btc', '1', '60000'), row(2, 'sell', 'btc', '0.5', '70000')],
      ]);

      await expect(service.deleteTrade('chat-1', 1)).rejects.toEqual(
        new PortfolioDeleteWouldOversellError(1, 'btc'),
      );
    });

    it('a trade number the chat does not have is not found', async () => {
      mockSql.transaction.mockResolvedValue([[], [], [row(1, 'buy', 'btc', '1', '60000')]]);

      await expect(service.deleteTrade('chat-1', 99)).rejects.toEqual(
        new PortfolioTradeNotFoundError(99),
      );
    });
  });

  it('listTrades counts a view and reads the trades in one transaction', async () => {
    mockSql.transaction.mockResolvedValue([[], [row(1, 'buy', 'eth', '10', '2000')]]);

    const trades = await service.listTrades('chat-1');

    const [usage, select] = transactionQueries();
    expect(usage.text).toContain('views = portfolio_usage.views + 1');
    expect(select.text).toContain('ORDER BY seq');
    expect(trades).toEqual([expect.objectContaining({ seq: 1, symbol: 'eth', priceUsd: 2000 })]);
  });

  it('listTradesPage pages newest first with a page count', async () => {
    mockSql.transaction.mockResolvedValue([[{ total: '45' }], [row(45, 'buy', 'btc', '1', '1')]]);

    const page = await service.listTradesPage('chat-1', 3);

    const [, select] = transactionQueries();
    expect(select.text).toContain('ORDER BY seq DESC');
    expect(select.values).toEqual(['chat-1', 20, 40]);
    expect(page).toEqual(expect.objectContaining({ total: 45, page: 3, pageCount: 3 }));
  });

  it('clearTrades deletes under the chat lock and returns the count', async () => {
    mockSql.transaction.mockResolvedValue([[], [{ seq: 1 }, { seq: 2 }]]);

    expect(await service.clearTrades('chat-1')).toBe(2);
    const [lock, remove] = transactionQueries();
    expect(lock.text).toContain('pg_advisory_xact_lock');
    expect(remove.text).toContain('DELETE FROM portfolio_trades WHERE chat_id =');
  });

  describe('listTradesForChats', () => {
    it('groups one query result by chat', async () => {
      mockSql.mockReturnValueOnce(
        Promise.resolve([
          { chat_id: 'a', ...row(1, 'buy', 'btc', '1', '60000') },
          { chat_id: 'a', ...row(2, 'buy', 'eth', '2', '2000') },
          { chat_id: 'b', ...row(1, 'buy', 'sol', '3', '100') },
        ]),
      );

      const byChat = await service.listTradesForChats(['a', 'b', 'c']);

      expect(mockSql).toHaveBeenCalledTimes(1);
      expect(mockSql.mock.calls[0][1]).toEqual(['a', 'b', 'c']);
      expect(byChat.get('a')?.map((trade) => trade.symbol)).toEqual(['btc', 'eth']);
      expect(byChat.get('b')?.map((trade) => trade.symbol)).toEqual(['sol']);
      expect(byChat.has('c')).toBe(false);
    });

    it('queries nothing for no chats', async () => {
      expect(await service.listTradesForChats([])).toEqual(new Map());
      expect(mockSql).not.toHaveBeenCalled();
    });
  });
});
