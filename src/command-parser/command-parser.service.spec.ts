import { CommandParserService } from './command-parser.service';
import { CommandType } from './interfaces/parsed-command.interface';

describe('CommandParserService', () => {
  const parser = new CommandParserService();

  it('parses "/gia btc" as a single-symbol price command', () => {
    expect(parser.parse('/gia btc')).toEqual({
      type: CommandType.PRICE,
      symbols: ['btc'],
    });
  });

  it('parses "/price btc" (english alias) as a price command', () => {
    expect(parser.parse('/price btc')).toEqual({
      type: CommandType.PRICE,
      symbols: ['btc'],
    });
  });

  it('parses "/giá btc" (accented Vietnamese) the same as "/gia btc"', () => {
    expect(parser.parse('/giá btc')).toEqual({
      type: CommandType.PRICE,
      symbols: ['btc'],
    });
  });

  it('parses multiple symbols and dedupes them, case-insensitively', () => {
    expect(parser.parse('/gia BTC eth sol eth')).toEqual({
      type: CommandType.PRICE,
      symbols: ['btc', 'eth', 'sol'],
    });
  });

  it('parses "/gia" with no symbols as a top-markets command', () => {
    expect(parser.parse('/gia')).toEqual({
      type: CommandType.TOP_MARKETS,
      symbols: [],
    });
  });

  it('parses "/giá" (accented, no symbols) as a top-markets command', () => {
    expect(parser.parse('/giá')).toEqual({
      type: CommandType.TOP_MARKETS,
      symbols: [],
    });
  });

  it('tolerates extra whitespace', () => {
    expect(parser.parse('  /gia   btc   eth  ')).toEqual({
      type: CommandType.PRICE,
      symbols: ['btc', 'eth'],
    });
  });

  it('parses "/help" and "/start" as help commands', () => {
    expect(parser.parse('/help')).toEqual({ type: CommandType.HELP, symbols: [] });
    expect(parser.parse('/start')).toEqual({ type: CommandType.HELP, symbols: [] });
  });

  it('returns UNKNOWN for plain text with no leading slash', () => {
    expect(parser.parse('hello there')).toEqual({ type: CommandType.UNKNOWN, symbols: [] });
  });

  it('returns UNKNOWN for an unrecognized command', () => {
    expect(parser.parse('/foobar btc')).toEqual({ type: CommandType.UNKNOWN, symbols: [] });
  });

  it('returns UNKNOWN for an empty or whitespace-only message', () => {
    expect(parser.parse('')).toEqual({ type: CommandType.UNKNOWN, symbols: [] });
    expect(parser.parse('   ')).toEqual({ type: CommandType.UNKNOWN, symbols: [] });
  });

  it('parses "/dangky btc eth" as a subscribe command with symbols', () => {
    expect(parser.parse('/dangky btc eth')).toEqual({
      type: CommandType.SUBSCRIBE,
      symbols: ['btc', 'eth'],
    });
  });

  it('parses "/dangky btc,eth" (comma-separated) the same as space-separated', () => {
    expect(parser.parse('/dangky btc,eth')).toEqual({
      type: CommandType.SUBSCRIBE,
      symbols: ['btc', 'eth'],
    });
  });

  it('parses "/dangky" with no symbols as a subscribe command with empty symbols', () => {
    expect(parser.parse('/dangky')).toEqual({ type: CommandType.SUBSCRIBE, symbols: [] });
  });

  it('parses "/huy" as an unsubscribe command', () => {
    expect(parser.parse('/huy')).toEqual({ type: CommandType.UNSUBSCRIBE, symbols: [] });
  });

  it('parses "/watchlist" with no symbols as a view command', () => {
    expect(parser.parse('/watchlist')).toEqual({ type: CommandType.WATCHLIST, symbols: [] });
  });

  it('parses "/watchlist btc sol" as an edit command with symbols', () => {
    expect(parser.parse('/watchlist btc sol')).toEqual({
      type: CommandType.WATCHLIST,
      symbols: ['btc', 'sol'],
    });
  });

  describe('/canhbao', () => {
    it('parses "/canhbao btc > 100000" as an "above" alert', () => {
      expect(parser.parse('/canhbao btc > 100000')).toEqual({
        type: CommandType.ALERT_CREATE,
        symbols: ['btc'],
        alert: { direction: 'above', threshold: 100000 },
      });
    });

    it('parses "<" as a "below" alert, with a decimal threshold', () => {
      expect(parser.parse('/canhbao ETH < 0.35')).toEqual({
        type: CommandType.ALERT_CREATE,
        symbols: ['eth'],
        alert: { direction: 'below', threshold: 0.35 },
      });
    });

    it('accepts no spaces around the operator, the accented command, and the english alias', () => {
      const expected = {
        type: CommandType.ALERT_CREATE,
        symbols: ['btc'],
        alert: { direction: 'above', threshold: 100000 },
      };
      expect(parser.parse('/canhbao btc>100000')).toEqual(expected);
      expect(parser.parse('/cảnhbáo btc > 100000')).toEqual(expected);
      expect(parser.parse('/alert btc >100000')).toEqual(expected);
    });

    it('treats "," as a thousands separator (AC08)', () => {
      expect(parser.parse('/canhbao btc > 100,000').alert?.threshold).toBe(100000);
      expect(parser.parse('/canhbao btc > 1,234.5').alert?.threshold).toBe(1234.5);
    });

    it('refuses a decimal comma instead of reading "0,350" as 350', () => {
      expect(parser.parse('/canhbao ada < 0,35').type).toBe(CommandType.ALERT_INVALID);
      expect(parser.parse('/canhbao ada < 0,350').type).toBe(CommandType.ALERT_INVALID);
      expect(parser.parse('/canhbao btc > 01,000').type).toBe(CommandType.ALERT_INVALID);
    });

    it.each([
      ['/canhbao btc > 100k'],
      ['/canhbao btc 100000'],
      ['/canhbao btc > -5'],
      ['/canhbao btc > 0'],
      ['/canhbao btc > 1.123456789'],
      ['/canhbao btc > 1000000000001'],
      ['/canhbao btc > 10,00'],
      ['/canhbao btc = 100'],
      ['/canhbao > 100'],
      [`/canhbao ${'a'.repeat(21)} > 1`],
    ])('rejects "%s" as ALERT_INVALID (AC08, NFR06)', (text) => {
      expect(parser.parse(text)).toEqual({ type: CommandType.ALERT_INVALID, symbols: [] });
    });

    it('accepts exactly 8 decimals and the 10^12 upper bound', () => {
      expect(parser.parse('/canhbao shib < 0.00001234').alert?.threshold).toBe(0.00001234);
      expect(parser.parse('/canhbao btc > 1000000000000').alert?.threshold).toBe(1e12);
    });

    it('parses "/canhbao" with no arguments as a list command', () => {
      expect(parser.parse('/canhbao')).toEqual({ type: CommandType.ALERT_LIST, symbols: [] });
    });

    it('parses "/canhbao xoa 2" (and "xóa" / "delete") as a delete command', () => {
      const expected = { type: CommandType.ALERT_DELETE, symbols: [], alert: { index: 2 } };
      expect(parser.parse('/canhbao xoa 2')).toEqual(expected);
      expect(parser.parse('/canhbao xóa 2')).toEqual(expected);
      expect(parser.parse('/canhbao delete 2')).toEqual(expected);
    });

    it.each([['/canhbao xoa'], ['/canhbao xoa 0'], ['/canhbao xoa abc'], ['/canhbao xoa 1 2']])(
      'rejects "%s" as ALERT_INVALID',
      (text) => {
        expect(parser.parse(text).type).toBe(CommandType.ALERT_INVALID);
      },
    );

    it('does not change how existing commands parse', () => {
      expect(parser.parse('/gia btc').type).toBe(CommandType.PRICE);
      expect(parser.parse('/dangky btc').type).toBe(CommandType.SUBSCRIBE);
    });
  });

  describe('/danhmuc (EPIC-003)', () => {
    it('parses "/danhmuc" with no arguments as a view command, accented and english too', () => {
      const expected = { type: CommandType.PORTFOLIO_VIEW, symbols: [] };
      expect(parser.parse('/danhmuc')).toEqual(expected);
      expect(parser.parse('/danhmục')).toEqual(expected);
      expect(parser.parse('/DanhMuc')).toEqual(expected);
      expect(parser.parse('/portfolio')).toEqual(expected);
    });

    it('AC01: parses "/danhmuc mua btc 0.5 60000" as a buy trade', () => {
      expect(parser.parse('/danhmuc mua btc 0.5 60000')).toEqual({
        type: CommandType.PORTFOLIO_TRADE,
        symbols: ['btc'],
        portfolio: { side: 'buy', quantity: '0.5', priceUsd: 60000 },
      });
    });

    it('parses sells with "ban", "bán" and "sell", and buys with "buy"', () => {
      const sell = {
        type: CommandType.PORTFOLIO_TRADE,
        symbols: ['btc'],
        portfolio: { side: 'sell', quantity: '0.4', priceUsd: 80000 },
      };
      expect(parser.parse('/danhmuc ban btc 0.4 80000')).toEqual(sell);
      expect(parser.parse('/danhmuc bán BTC 0.4 80000')).toEqual(sell);
      expect(parser.parse('/portfolio sell btc 0.4 80000')).toEqual(sell);
      expect(parser.parse('/portfolio buy eth 1 2000').portfolio?.side).toBe('buy');
    });

    it('AC05: "," is a thousands separator in the price and the quantity', () => {
      expect(parser.parse('/danhmuc mua btc 1 60,000.5').portfolio).toEqual({
        side: 'buy',
        quantity: '1',
        priceUsd: 60000.5,
      });
      expect(parser.parse('/danhmuc mua shib 1,000,000 0.00001').portfolio?.quantity).toBe(
        '1000000',
      );
    });

    it('accepts 8 quantity decimals and the 10^12 upper bound', () => {
      expect(parser.parse('/danhmuc mua btc 0.00000001 60000').portfolio?.quantity).toBe(
        '0.00000001',
      );
      expect(parser.parse('/danhmuc mua btc 1000000000000 1').portfolio?.quantity).toBe(
        '1000000000000',
      );
    });

    it.each([
      ['/danhmuc mua btc 0.5'],
      ['/danhmuc mua btc -1 60000'],
      ['/danhmuc mua btc 0.5 60k'],
      ['/danhmuc mua btc 0.123456789 60000'],
      ['/danhmuc mua btc 0.5 0'],
      ['/danhmuc mua btc 0 60000'],
      ['/danhmuc mua btc 1000000000001 1'],
      ['/danhmuc mua btc 0.5 60000 thêm'],
      ['/danhmuc mua btc-x 1 1'],
      ['/danhmuc mua abcdefghijklmnopqrstu 1 1'],
      ['/danhmuc mua btc 1,00 60000'],
      ['/danhmuc mua btc 0,123 60000'],
      ['/danhmuc mua btc 0,5 60000'],
      ['/danhmuc mua btc 0.5 0,123'],
      ['/danhmuc xoa 1234567'],
      ['/danhmuc banh btc 1 60000'],
    ])('AC05: rejects "%s" as PORTFOLIO_INVALID', (text) => {
      expect(parser.parse(text)).toEqual({ type: CommandType.PORTFOLIO_INVALID, symbols: [] });
    });

    it('parses "/danhmuc lichsu" and "/danhmuc lịch sử"-style pages', () => {
      expect(parser.parse('/danhmuc lichsu')).toEqual({
        type: CommandType.PORTFOLIO_HISTORY,
        symbols: [],
        portfolio: { page: 1 },
      });
      expect(parser.parse('/danhmuc lịchsử 2').portfolio).toEqual({ page: 2 });
      expect(parser.parse('/portfolio history 3').portfolio).toEqual({ page: 3 });
    });

    it('parses "/danhmuc xoa 3" (and "xoá" / "delete") as a delete command', () => {
      const expected = { type: CommandType.PORTFOLIO_DELETE, symbols: [], portfolio: { index: 3 } };
      expect(parser.parse('/danhmuc xoa 3')).toEqual(expected);
      expect(parser.parse('/danhmuc xoá 3')).toEqual(expected);
      expect(parser.parse('/portfolio delete 3')).toEqual(expected);
      // Trade numbers keep growing past the 200-trade cap, so #1234 must stay deletable.
      expect(parser.parse('/danhmuc xoa 1234').portfolio).toEqual({ index: 1234 });
    });

    it('AC15: "/danhmuc xoahet" asks for confirmation, "/danhmuc xoahet xacnhan" confirms', () => {
      expect(parser.parse('/danhmuc xoahet')).toEqual({
        type: CommandType.PORTFOLIO_CLEAR,
        symbols: [],
        portfolio: { confirmed: false },
      });
      expect(parser.parse('/danhmuc xoáhết xácnhận').portfolio).toEqual({ confirmed: true });
      expect(parser.parse('/portfolio clear confirm').portfolio).toEqual({ confirmed: true });
    });

    it.each([
      ['/danhmuc lichsu 0'],
      ['/danhmuc lichsu abc'],
      ['/danhmuc lichsu 1 2'],
      ['/danhmuc xoa'],
      ['/danhmuc xoa 0'],
      ['/danhmuc xoa 1000000'],
      ['/danhmuc xoahet ok'],
      ['/danhmuc xoahet xacnhan them'],
    ])('rejects "%s" as PORTFOLIO_INVALID', (text) => {
      expect(parser.parse(text).type).toBe(CommandType.PORTFOLIO_INVALID);
    });

    it('does not change how "/canhbao" and the other commands parse', () => {
      expect(parser.parse('/canhbao btc > 100,000').alert).toEqual({
        direction: 'above',
        threshold: 100000,
      });
      expect(parser.parse('/canhbao btc > 60k').type).toBe(CommandType.ALERT_INVALID);
      expect(parser.parse('/danhsach').type).toBe(CommandType.WATCHLIST);
      expect(parser.parse('/gia btc').type).toBe(CommandType.PRICE);
    });
  });
});
