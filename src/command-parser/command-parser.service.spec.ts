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
});
