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
});
