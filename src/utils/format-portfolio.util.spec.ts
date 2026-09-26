import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import {
  HoldingPrice,
  PortfolioTrade,
  TradeSide,
} from '../portfolio/interfaces/portfolio.interface';
import { computeHoldings, computePortfolio } from '../portfolio/portfolio-calculator';
import { pricesBySymbol } from '../portfolio/portfolio-prices';
import {
  formatDailyDigestReply,
  formatHelpReply,
  formatPortfolioClearConfirmReply,
  formatPortfolioDeletedReply,
  formatPortfolioDeleteRefusedReply,
  formatPortfolioDigestSection,
  formatPortfolioEmptyReply,
  formatPortfolioGroupRefusedReply,
  formatPortfolioHistoryReply,
  formatPortfolioInvalidReply,
  formatPortfolioLimitReply,
  formatPortfolioOversellReply,
  formatPortfolioReply,
  formatPortfolioTradeRecordedReply,
} from './format-message.util';

const RATE = 25400;

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
    createdAt: new Date('2026-09-24T18:30:00.000Z'), // 01:30 on 25/09 in Vietnam
  };
}

/** Spec AC03: 0.6 BTC at 65,000 and 10 ETH at 2,000, +6,000 realized. */
function ac03Trades(): PortfolioTrade[] {
  return [
    trade('buy', 'btc', '0.5', 60000),
    trade('buy', 'btc', '0.5', 70000),
    trade('sell', 'btc', '0.4', 80000),
    trade('buy', 'eth', '10', 2000),
  ];
}

const AC03_PRICES = new Map<string, HoldingPrice>([
  ['btc', { priceUsd: 70000, changePercent24h: 2 }],
  ['eth', { priceUsd: 2500, changePercent24h: -5 }],
]);

describe('portfolio formatters (EPIC-003)', () => {
  beforeEach(() => {
    nextSeq = 1;
  });

  it('AC03: "/danhmuc" shows each coin and every total in USD with ~VND', () => {
    const reply = formatPortfolioReply(
      computePortfolio(computeHoldings(ac03Trades()), AC03_PRICES),
      RATE,
    );

    expect(reply).toContain('0.6 BTC × $70,000.00 = $42,000.00 (~1.066.800.000₫)');
    expect(reply).toContain('10 ETH × $2,500.00 = $25,000.00');
    expect(reply).toContain('Tổng giá trị: $67,000.00 (~1.701.800.000₫)');
    expect(reply).toContain('Lãi/lỗ chưa chốt: 🔺 +$8,000.00 (~+203.200.000₫) (+13.56%)');
    expect(reply).toContain('Lãi/lỗ đã chốt: +$6,000.00');
    expect(reply).toContain('Biến động 24h: 🔻 −$492.26');
    expect(reply).toContain('(−0.73%)');
    // Every amount line carries a VND estimate (FR08).
    for (const line of reply
      .split('\n')
      .filter((l) => l.includes('$') && !l.startsWith('Giá vốn'))) {
      expect(line).toContain('₫');
    }
  });

  it('AC13: an unpriced coin shows "không có giá lúc này" and is noted as left out', () => {
    const reply = formatPortfolioReply(
      computePortfolio(computeHoldings(ac03Trades()), new Map([['btc', AC03_PRICES.get('btc')!]])),
      RATE,
    );

    expect(reply).toContain('10 ETH: không có giá lúc này');
    expect(reply).toContain('Tổng giá trị: $42,000.00');
    expect(reply).toContain('Tổng chưa gồm ETH (không có giá lúc này)');
  });

  it('a coin without a 24h change is noted as left out of the 24h change only', () => {
    const reply = formatPortfolioReply(
      computePortfolio(
        computeHoldings(ac03Trades()),
        new Map<string, HoldingPrice>([
          ['btc', AC03_PRICES.get('btc')!],
          ['eth', { priceUsd: 2500, changePercent24h: null }],
        ]),
      ),
      RATE,
    );

    expect(reply).toContain('Biến động 24h chưa gồm ETH');
    expect(reply).not.toContain('Tổng chưa gồm');
  });

  it('a fully sold portfolio shows the realized result and no held coin', () => {
    const reply = formatPortfolioReply(
      computePortfolio(
        computeHoldings([trade('buy', 'sol', '2', 100), trade('sell', 'sol', '2', 90)]),
        new Map(),
      ),
      RATE,
    );

    expect(reply).toContain('Không còn coin nào đang giữ');
    expect(reply).toContain('Lãi/lỗ đã chốt: −$20.00');
    expect(reply).not.toContain('Biến động 24h');
  });

  it('AC07: the empty reply shows how to record a buy', () => {
    expect(formatPortfolioEmptyReply()).toContain('/danhmuc mua btc 0.5 60000');
  });

  it('AC01: a recorded buy shows its number, the coin, quantity, price, holding and average cost', () => {
    const trades = [trade('buy', 'btc', '0.50000000', 60000)];
    const reply = formatPortfolioTradeRecordedReply(trades[0], computeHoldings(trades), RATE);

    expect(reply).toContain('#1 Mua 0.5 BTC × $60,000.00');
    expect(reply).toContain('Đang giữ: 0.5 BTC, giá vốn TB $60,000.00');
    expect(reply).not.toContain('đã chốt');
  });

  it("a recorded sell also shows the coin's realized result", () => {
    const trades = ac03Trades().slice(0, 3);
    const reply = formatPortfolioTradeRecordedReply(trades[2], computeHoldings(trades), RATE);

    expect(reply).toContain('#3 Bán 0.4 BTC × $80,000.00');
    expect(reply).toContain('Đang giữ: 0.6 BTC, giá vốn TB $65,000.00');
    expect(reply).toContain('Lãi/lỗ đã chốt của BTC: +$6,000.00');
  });

  it('a redelivered message says nothing new was recorded', () => {
    const trades = ac03Trades().slice(0, 1);
    const reply = formatPortfolioTradeRecordedReply(trades[0], computeHoldings(trades), RATE, {
      duplicate: true,
    });

    expect(reply).toContain('đã được ghi trước đó, không ghi lại: #1 Mua 0.5 BTC');
    expect(reply).not.toContain('✅');
  });

  it('an identical trade sent twice keeps both, and says how to delete the second', () => {
    const trades = ac03Trades().slice(0, 1);
    const second = { ...trades[0], seq: 2 };
    const reply = formatPortfolioTradeRecordedReply(
      second,
      computeHoldings([...trades, second]),
      RATE,
      { twin: trades[0] },
    );

    expect(reply).toContain('✅ Đã ghi giao dịch #2');
    expect(reply).toContain('Giống hệt giao dịch #1 vừa ghi');
    expect(reply).toContain('/danhmuc xoa 2');
  });

  it('AC08: history lists number, side, coin, quantity, price and Vietnam date, newest first', () => {
    const trades = ac03Trades().reverse();
    const reply = formatPortfolioHistoryReply({ trades, total: 4, page: 1, pageCount: 1 });
    const lines = reply.split('\n');

    expect(lines[1]).toBe('#4 Mua 10 ETH × $2,000.00 — 25/09/2026');
    expect(lines[4]).toBe('#1 Mua 0.5 BTC × $60,000.00 — 25/09/2026');
    expect(reply).not.toContain('Xem tiếp');
  });

  it('history points to the next page, and explains an empty page', () => {
    const page = formatPortfolioHistoryReply({
      trades: [trade('buy', 'btc', '1', 1)],
      total: 25,
      page: 1,
      pageCount: 2,
    });
    expect(page).toContain('trang 1/2');
    expect(page).toContain('/danhmuc lichsu 2');
    expect(formatPortfolioHistoryReply({ trades: [], total: 25, page: 5, pageCount: 2 })).toContain(
      'Không có trang 5',
    );
    expect(formatPortfolioHistoryReply({ trades: [], total: 0, page: 1, pageCount: 0 })).toBe(
      formatPortfolioEmptyReply(),
    );
  });

  it('refusals explain what happened and what to do', () => {
    expect(formatPortfolioOversellReply('btc', '0.60000000')).toContain('đang giữ 0.6 BTC');
    expect(formatPortfolioDeleteRefusedReply(1, 'btc')).toContain('xoá giao dịch bán đó trước');
    expect(formatPortfolioLimitReply('trades', 200)).toContain('200 giao dịch');
    expect(formatPortfolioLimitReply('coins', 20)).toContain('20 coin');
    expect(formatPortfolioClearConfirmReply()).toContain('/danhmuc xoahet xacnhan');
  });

  it('AC05: the invalid-syntax reply shows the correct syntax and number rules', () => {
    const reply = formatPortfolioInvalidReply();
    expect(reply).toContain('/danhmuc mua btc 0.5 60000');
    expect(reply).toContain('/danhmuc ban btc 0.4 80000');
    expect(reply).toContain('"60k"');
  });

  it('AC12: the group refusal points to a private chat', () => {
    expect(formatPortfolioGroupRefusedReply()).toContain('nhắn riêng');
  });

  it('a delete confirmation shows the coin position after the delete', () => {
    const trades = [trade('buy', 'btc', '1', 60000), trade('sell', 'btc', '0.5', 70000)];
    const reply = formatPortfolioDeletedReply(trades[1], computeHoldings([trades[0]]));

    expect(reply).toContain('Đã xoá giao dịch #2 Bán 0.5 BTC');
    expect(reply).toContain('Đang giữ: 1 BTC');
  });

  it('AC10: the digest section goes before the cron-tracking line; without it the digest is unchanged', () => {
    const btc: CoinMarketData = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'BTC',
      priceUsd: 70000,
      changePercent24h: 2,
    };
    const section = formatPortfolioDigestSection(
      computePortfolio(computeHoldings(ac03Trades()), AC03_PRICES),
      RATE,
    );
    expect(section).toContain('Danh mục: $67,000.00');
    expect(section).toContain('Lãi/lỗ chưa chốt: 🔺 +$8,000.00');
    expect(section).toContain('Biến động 24h: 🔻 −$492.26');

    const withSection = formatDailyDigestReply([btc], RATE, '🕐 tracking', section).split('\n');
    expect(withSection.indexOf('🕐 tracking')).toBeGreaterThan(
      withSection.findIndex((line) => line.startsWith('💼 Danh mục')),
    );
    expect(formatDailyDigestReply([btc], RATE, undefined, undefined)).toBe(
      formatDailyDigestReply([btc], RATE),
    );
  });

  it('FR15: /help lists /danhmuc', () => {
    expect(formatHelpReply()).toContain('/danhmuc mua btc 0.5 60000');
  });

  it('pricesBySymbol matches symbols directly or through a shared id', () => {
    const coins: CoinMarketData[] = [
      { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 70000, changePercent24h: 2 },
      {
        id: 'polygon-ecosystem-token',
        symbol: 'pol',
        name: 'POL',
        priceUsd: 0.5,
        changePercent24h: null,
      },
    ];
    const ids: Record<string, string> = {
      matic: 'polygon-ecosystem-token',
      pol: 'polygon-ecosystem-token',
    };

    const prices = pricesBySymbol(coins, ['btc', 'matic', 'pol', 'eth'], (s) => ids[s] ?? s);

    expect(prices.get('btc')).toEqual({ priceUsd: 70000, changePercent24h: 2 });
    expect(prices.get('matic')).toEqual({ priceUsd: 0.5, changePercent24h: null });
    expect(prices.get('pol')).toEqual({ priceUsd: 0.5, changePercent24h: null });
    expect(prices.has('eth')).toBe(false);
  });
});
