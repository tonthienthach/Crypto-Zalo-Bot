import { PortfolioTrade, TradeSide } from './interfaces/portfolio.interface';
import {
  computeHoldings,
  computePortfolio,
  findRecentTwin,
  formatQuantityUnits,
  heldQuantityOf,
  InconsistentTradesError,
  toQuantityUnits,
} from './portfolio-calculator';

let nextSeq = 1;
function trade(
  side: TradeSide,
  symbol: string,
  quantity: string,
  priceUsd: number,
): PortfolioTrade {
  return {
    seq: nextSeq++,
    side,
    symbol,
    quantity,
    priceUsd,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
  };
}

describe('portfolio calculator', () => {
  beforeEach(() => {
    nextSeq = 1;
  });

  describe('quantity units', () => {
    it('converts exact decimals to 10^-8 units and back', () => {
      expect(toQuantityUnits('0.5')).toBe(50_000_000n);
      expect(toQuantityUnits('0.50000000')).toBe(50_000_000n);
      expect(toQuantityUnits('1000000000000')).toBe(100_000_000_000_000_000_000n);
      expect(toQuantityUnits('0.00000001')).toBe(1n);
      expect(formatQuantityUnits(60_000_000n)).toBe('0.6');
      expect(formatQuantityUnits(100_000_000n)).toBe('1');
      expect(formatQuantityUnits(1n)).toBe('0.00000001');
    });

    it('rejects anything that is not a plain decimal with at most 8 places', () => {
      expect(() => toQuantityUnits('1e-8')).toThrow(InconsistentTradesError);
      expect(() => toQuantityUnits('-1')).toThrow(InconsistentTradesError);
      expect(() => toQuantityUnits('0.123456789')).toThrow(InconsistentTradesError);
    });
  });

  describe('computeHoldings (EPIC-003-FR05)', () => {
    it('AC01: one buy holds that quantity at that price', () => {
      const result = computeHoldings([trade('buy', 'btc', '0.5', 60000)]);

      expect(result.holdings).toEqual([
        expect.objectContaining({ symbol: 'btc', quantity: '0.5', avgCostUsd: 60000 }),
      ]);
      expect(result.realizedPnlUsd).toBe(0);
    });

    it('AC02: buys average the cost; a sell keeps the average and realizes the gain', () => {
      const trades = [trade('buy', 'btc', '0.5', 60000), trade('buy', 'btc', '0.5', 70000)];
      const afterBuys = computeHoldings(trades);
      expect(afterBuys.holdings[0].quantity).toBe('1');
      expect(afterBuys.holdings[0].avgCostUsd).toBeCloseTo(65000, 6);

      const afterSell = computeHoldings([...trades, trade('sell', 'btc', '0.4', 80000)]);
      expect(afterSell.holdings[0].quantity).toBe('0.6');
      expect(afterSell.holdings[0].avgCostUsd).toBeCloseTo(65000, 6);
      expect(afterSell.holdings[0].costBasisUsd).toBeCloseTo(39000, 6);
      expect(afterSell.realizedPnlUsd).toBeCloseTo(6000, 6);
    });

    it('replays in seq order regardless of array order', () => {
      const buy = trade('buy', 'btc', '1', 100);
      const sell = trade('sell', 'btc', '1', 150);

      expect(computeHoldings([sell, buy]).realizedPnlUsd).toBeCloseTo(50, 6);
    });

    it('a coin sold to exactly zero leaves the holdings, keeps its realized PnL, and resets its cost', () => {
      const result = computeHoldings([
        trade('buy', 'eth', '0.1', 3000),
        trade('buy', 'eth', '0.2', 3000),
        trade('sell', 'eth', '0.3', 2000),
        trade('buy', 'eth', '1', 1000),
      ]);

      expect(result.holdings).toEqual([
        expect.objectContaining({ symbol: 'eth', quantity: '1', avgCostUsd: 1000 }),
      ]);
      expect(result.realizedPnlUsd).toBeCloseTo(-300, 6);
      expect(result.realizedBySymbol.get('eth')).toBeCloseTo(-300, 6);
    });

    it('fully sold coins are not held but still count toward the realized total', () => {
      const result = computeHoldings([
        trade('buy', 'sol', '2', 100),
        trade('sell', 'sol', '2', 110),
        trade('buy', 'btc', '1', 60000),
      ]);

      expect(result.holdings.map((holding) => holding.symbol)).toEqual(['btc']);
      expect(result.realizedPnlUsd).toBeCloseTo(20, 6);
      expect(heldQuantityOf(result, 'sol')).toBe('0');
      expect(heldQuantityOf(result, 'btc')).toBe('1');
    });

    it('no accumulated error over many small trades (NFR01)', () => {
      const trades: PortfolioTrade[] = [];
      for (let i = 0; i < 100; i++) trades.push(trade('buy', 'btc', '0.01', 60000 + i));
      for (let i = 0; i < 99; i++) trades.push(trade('sell', 'btc', '0.01', 70000));
      const result = computeHoldings(trades);

      expect(result.holdings[0].quantity).toBe('0.01');
      const avg = (60000 * 100 + (99 * 100) / 2) / 100;
      expect(result.holdings[0].avgCostUsd).toBeCloseTo(avg, 6);
      expect(result.realizedPnlUsd).toBeCloseTo(0.99 * (70000 - avg), 4);
    });

    it('refuses to replay a sell larger than the held quantity', () => {
      expect(() =>
        computeHoldings([trade('buy', 'btc', '0.5', 60000), trade('sell', 'btc', '0.6', 60000)]),
      ).toThrow(InconsistentTradesError);
    });

    it('an empty trade list holds nothing', () => {
      expect(computeHoldings([])).toEqual({
        holdings: [],
        realizedPnlUsd: 0,
        realizedBySymbol: new Map(),
      });
    });
  });

  describe('computePortfolio (EPIC-003-FR06, FR07)', () => {
    /** 0.6 BTC at 65,000 and 10 ETH at 2,000, with +6,000 already realized — spec AC03. */
    function ac03Holdings() {
      return computeHoldings([
        trade('buy', 'btc', '0.5', 60000),
        trade('buy', 'btc', '0.5', 70000),
        trade('sell', 'btc', '0.4', 80000),
        trade('buy', 'eth', '10', 2000),
      ]);
    }

    it('AC03: value, unrealized and realized PnL, and the 24h change match the hand calculation', () => {
      const snapshot = computePortfolio(
        ac03Holdings(),
        new Map([
          ['btc', { priceUsd: 70000, changePercent24h: 2 }],
          ['eth', { priceUsd: 2500, changePercent24h: -5 }],
        ]),
      );

      expect(snapshot.totalValueUsd).toBeCloseTo(67000, 2);
      expect(snapshot.totalCostBasisUsd).toBeCloseTo(59000, 2);
      expect(snapshot.unrealizedPnlUsd).toBeCloseTo(8000, 2);
      expect(snapshot.unrealizedPnlPercent).toBeCloseTo(13.56, 2);
      expect(snapshot.realizedPnlUsd).toBeCloseTo(6000, 2);
      expect(snapshot.change24hUsd).toBeCloseTo(-492.26, 2);
      // The day-ago value is 67,492.26, so the change is -0.73%.
      expect(snapshot.change24hPercent).toBeCloseTo(-0.7294, 3);
      expect(snapshot.lines).toEqual([
        expect.objectContaining({ symbol: 'btc', priced: true, valueUsd: 42000 }),
        expect.objectContaining({ symbol: 'eth', priced: true, valueUsd: 25000 }),
      ]);
      const [btc, eth] = snapshot.lines as Extract<
        (typeof snapshot.lines)[number],
        { priced: true }
      >[];
      expect(btc.unrealizedPnlUsd).toBeCloseTo(3000, 2);
      expect(btc.unrealizedPnlPercent).toBeCloseTo(7.69, 2);
      expect(eth.unrealizedPnlUsd).toBeCloseTo(5000, 2);
      expect(snapshot.unpricedSymbols).toEqual([]);
      expect(snapshot.missingChangeSymbols).toEqual([]);
    });

    it('AC13: a coin with no price is listed, and left out of every total', () => {
      const snapshot = computePortfolio(
        ac03Holdings(),
        new Map([['btc', { priceUsd: 70000, changePercent24h: 2 }]]),
      );

      expect(snapshot.totalValueUsd).toBeCloseTo(42000, 2);
      expect(snapshot.unrealizedPnlUsd).toBeCloseTo(3000, 2);
      expect(snapshot.unpricedSymbols).toEqual(['eth']);
      expect(snapshot.lines[1]).toEqual({ priced: false, symbol: 'eth', quantity: '10' });
      // Realized PnL doesn't depend on current prices.
      expect(snapshot.realizedPnlUsd).toBeCloseTo(6000, 2);
    });

    it('a coin with no 24h change counts toward value but not toward the 24h change', () => {
      const snapshot = computePortfolio(
        ac03Holdings(),
        new Map([
          ['btc', { priceUsd: 70000, changePercent24h: 2 }],
          ['eth', { priceUsd: 2500, changePercent24h: null }],
        ]),
      );

      expect(snapshot.totalValueUsd).toBeCloseTo(67000, 2);
      expect(snapshot.change24hUsd).toBeCloseTo(823.53, 2);
      expect(snapshot.missingChangeSymbols).toEqual(['eth']);
    });

    it('a 24h change of −100% or less is treated as missing, never as an infinite change', () => {
      for (const changePercent24h of [-100, -150]) {
        const snapshot = computePortfolio(
          ac03Holdings(),
          new Map([
            ['btc', { priceUsd: 70000, changePercent24h: 2 }],
            ['eth', { priceUsd: 2500, changePercent24h }],
          ]),
        );

        expect(Number.isFinite(snapshot.change24hUsd)).toBe(true);
        expect(snapshot.change24hUsd).toBeCloseTo(823.53, 2);
        expect(snapshot.missingChangeSymbols).toEqual(['eth']);
        expect(snapshot.lines[1]).toEqual(expect.objectContaining({ change24hUsd: null }));
      }
    });

    it('no priced coin at all: totals are zero and the 24h change is unknown', () => {
      const snapshot = computePortfolio(ac03Holdings(), new Map());

      expect(snapshot.totalValueUsd).toBe(0);
      expect(snapshot.unrealizedPnlPercent).toBeNull();
      expect(snapshot.change24hUsd).toBeNull();
      expect(snapshot.change24hPercent).toBeNull();
      expect(snapshot.unpricedSymbols).toEqual(['btc', 'eth']);
    });
  });
});

describe('findRecentTwin', () => {
  const at = (iso: string) => new Date(iso);
  const base: PortfolioTrade = {
    seq: 1,
    side: 'buy',
    symbol: 'btc',
    quantity: '0.50000000',
    priceUsd: 60000,
    createdAt: at('2026-09-25T02:00:00.000Z'),
  };

  it('flags an identical trade recorded within 2 minutes before it (same quantity at any scale)', () => {
    const second = { ...base, seq: 2, quantity: '0.5', createdAt: at('2026-09-25T02:01:30.000Z') };
    expect(findRecentTwin([base, second], second)).toBe(base);
  });

  it('ignores a twin older than 2 minutes, or one that differs in side, coin, quantity or price', () => {
    const later = { ...base, seq: 2, createdAt: at('2026-09-25T02:02:01.000Z') };
    expect(findRecentTwin([base, later], later)).toBeUndefined();
    for (const change of [
      { side: 'sell' as const },
      { symbol: 'eth' },
      { quantity: '0.6' },
      { priceUsd: 60001 },
    ]) {
      const other = { ...base, ...change, seq: 2, createdAt: at('2026-09-25T02:00:10.000Z') };
      expect(findRecentTwin([base, other], other)).toBeUndefined();
    }
  });

  it('only compares with the trade just before, and the first trade has no twin', () => {
    const middle = { ...base, seq: 2, symbol: 'eth', createdAt: at('2026-09-25T02:00:10.000Z') };
    const third = { ...base, seq: 3, createdAt: at('2026-09-25T02:00:20.000Z') };
    expect(findRecentTwin([base, middle, third], third)).toBeUndefined();
    expect(findRecentTwin([base], base)).toBeUndefined();
  });
});
