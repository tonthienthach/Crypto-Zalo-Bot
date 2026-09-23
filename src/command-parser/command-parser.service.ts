import { Injectable } from '@nestjs/common';
import {
  MAX_ALERT_SYMBOL_LENGTH,
  MAX_ALERT_THRESHOLD,
  MAX_THRESHOLD_DECIMALS,
} from '../price-alerts/price-alerts.constants';
import { CommandType, ParsedCommand } from './interfaces/parsed-command.interface';

const PRICE_COMMAND_ALIASES = new Set(['gia', 'gía', 'giá', 'price']);
const HELP_COMMAND_ALIASES = new Set(['help', 'start', 'trogiup', 'trợgiúp']);
const SUBSCRIBE_COMMAND_ALIASES = new Set(['dangky', 'subscribe']);
const UNSUBSCRIBE_COMMAND_ALIASES = new Set(['huy', 'huydangky', 'unsubscribe']);
const WATCHLIST_COMMAND_ALIASES = new Set(['watchlist', 'danhsach', 'ds']);
const ALERT_COMMAND_ALIASES = new Set(['canhbao', 'alert']);
const ALERT_DELETE_KEYWORDS = new Set(['xoa', 'delete']);

/** "btc > 100000", "btc>100000", "btc < 0.35" — symbol, operator, price token. */
const ALERT_CREATE_PATTERN = /^([a-z0-9]+)\s*([<>])\s*(\S+)$/;
/** Plain "100000" / "0.35", or comma-grouped thousands "100,000" / "1,234.5". */
const ALERT_THRESHOLD_PATTERN = /^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

@Injectable()
export class CommandParserService {
  /**
   * Parses a raw inbound chat message into a structured command.
   * Accepts both accented and unaccented Vietnamese ("/giá" and "/gia"),
   * is case-insensitive, and tolerates extra whitespace.
   */
  parse(rawText: string): ParsedCommand {
    const text = (rawText ?? '').trim();
    if (!text.startsWith('/')) {
      return { type: CommandType.UNKNOWN, symbols: [] };
    }

    const tokens = text
      .slice(1)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return { type: CommandType.UNKNOWN, symbols: [] };
    }

    const [rawCommand, ...rawSymbols] = tokens;
    const command = this.stripDiacritics(rawCommand.toLowerCase());

    if (HELP_COMMAND_ALIASES.has(command)) {
      return { type: CommandType.HELP, symbols: [] };
    }

    if (UNSUBSCRIBE_COMMAND_ALIASES.has(command)) {
      return { type: CommandType.UNSUBSCRIBE, symbols: [] };
    }

    if (SUBSCRIBE_COMMAND_ALIASES.has(command)) {
      return { type: CommandType.SUBSCRIBE, symbols: this.parseSymbols(rawSymbols) };
    }

    if (WATCHLIST_COMMAND_ALIASES.has(command)) {
      return { type: CommandType.WATCHLIST, symbols: this.parseSymbols(rawSymbols) };
    }

    if (ALERT_COMMAND_ALIASES.has(command)) {
      return this.parseAlert(rawSymbols);
    }

    if (!PRICE_COMMAND_ALIASES.has(rawCommand.toLowerCase()) && command !== 'gia') {
      return { type: CommandType.UNKNOWN, symbols: [] };
    }

    if (rawSymbols.length === 0) {
      return { type: CommandType.TOP_MARKETS, symbols: [] };
    }

    return { type: CommandType.PRICE, symbols: this.parseSymbols(rawSymbols) };
  }

  /** Normalizes symbol tokens: lowercase, diacritics stripped, deduped, comma- or space-separated. */
  private parseSymbols(rawSymbols: string[]): string[] {
    const tokens = rawSymbols
      .flatMap((token) => token.split(','))
      .map((token) => token.trim())
      .filter(Boolean);
    return Array.from(new Set(tokens.map((symbol) => this.stripDiacritics(symbol.toLowerCase()))));
  }

  /**
   * Parses the arguments of "/canhbao": none -> list, "xoa <n>" -> delete,
   * "<coin> > <price>" / "<coin> < <price>" -> create. Anything else,
   * including out-of-range values (spec EPIC-002-NFR06), is ALERT_INVALID so
   * the reply can show the correct syntax instead of a generic error.
   */
  private parseAlert(rawArgs: string[]): ParsedCommand {
    const invalid: ParsedCommand = { type: CommandType.ALERT_INVALID, symbols: [] };
    const args = rawArgs.map((arg) => this.stripDiacritics(arg.toLowerCase()));

    if (args.length === 0) {
      return { type: CommandType.ALERT_LIST, symbols: [] };
    }

    if (ALERT_DELETE_KEYWORDS.has(args[0])) {
      if (args.length !== 2 || !/^\d{1,3}$/.test(args[1]) || Number(args[1]) < 1) {
        return invalid;
      }
      return { type: CommandType.ALERT_DELETE, symbols: [], alert: { index: Number(args[1]) } };
    }

    const match = ALERT_CREATE_PATTERN.exec(args.join(' '));
    if (!match) {
      return invalid;
    }
    const [, symbol, operator, rawThreshold] = match;
    const threshold = this.parseThreshold(rawThreshold);
    if (symbol.length > MAX_ALERT_SYMBOL_LENGTH || threshold === null) {
      return invalid;
    }

    return {
      type: CommandType.ALERT_CREATE,
      symbols: [symbol],
      alert: { direction: operator === '>' ? 'above' : 'below', threshold },
    };
  }

  /** "100,000" -> 100000; null for anything non-numeric, <= 0, too large or too precise. */
  private parseThreshold(raw: string): number | null {
    if (!ALERT_THRESHOLD_PATTERN.test(raw)) {
      return null;
    }
    const plain = raw.replace(/,/g, '');
    const decimals = plain.includes('.') ? plain.split('.')[1].length : 0;
    const value = Number(plain);
    if (decimals > MAX_THRESHOLD_DECIMALS || value <= 0 || value > MAX_ALERT_THRESHOLD) {
      return null;
    }
    return value;
  }

  /** Removes Vietnamese diacritics so "/giá" and "/gia" resolve to the same command. */
  private stripDiacritics(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }
}
