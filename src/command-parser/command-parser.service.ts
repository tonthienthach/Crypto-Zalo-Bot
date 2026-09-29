import { Injectable } from '@nestjs/common';
import {
  MAX_ALERT_SYMBOL_LENGTH,
  MAX_ALERT_THRESHOLD,
  MAX_THRESHOLD_DECIMALS,
} from '../price-alerts/price-alerts.constants';
import {
  MAX_PORTFOLIO_SYMBOL_LENGTH,
  MAX_QUANTITY,
  MAX_QUANTITY_DECIMALS,
} from '../portfolio/portfolio.constants';
import { CommandType, ParsedCommand } from './interfaces/parsed-command.interface';

const PRICE_COMMAND_ALIASES = new Set(['gia', 'gía', 'giá', 'price']);
const HELP_COMMAND_ALIASES = new Set(['help', 'start', 'trogiup', 'trợgiúp']);
const SUBSCRIBE_COMMAND_ALIASES = new Set(['dangky', 'subscribe']);
const UNSUBSCRIBE_COMMAND_ALIASES = new Set(['huy', 'huydangky', 'unsubscribe']);
const WATCHLIST_COMMAND_ALIASES = new Set(['watchlist', 'danhsach', 'ds']);
const ALERT_COMMAND_ALIASES = new Set(['canhbao', 'alert']);
const ALERT_DELETE_KEYWORDS = new Set(['xoa', 'delete']);
const PORTFOLIO_COMMAND_ALIASES = new Set(['danhmuc', 'portfolio']);
const PORTFOLIO_BUY_KEYWORDS = new Set(['mua', 'buy']);
const PORTFOLIO_SELL_KEYWORDS = new Set(['ban', 'sell']);
const PORTFOLIO_HISTORY_KEYWORDS = new Set(['lichsu', 'history']);
const PORTFOLIO_DELETE_KEYWORDS = new Set(['xoa', 'delete']);
const PORTFOLIO_CLEAR_KEYWORDS = new Set(['xoahet', 'clear']);
const PORTFOLIO_CONFIRM_KEYWORDS = new Set(['xacnhan', 'confirm']);
const PORTFOLIO_SYMBOL_PATTERN = /^[a-z0-9]+$/;
/** A trade number or history page: 1-999999 (trade numbers keep growing past the 200-trade cap). */
const POSITIVE_INTEGER_PATTERN = /^\d{1,6}$/;

/** "btc > 100000", "btc>100000", "btc < 0.35" — symbol, operator, price token. */
const ALERT_CREATE_PATTERN = /^([a-z0-9]+)\s*([<>])\s*(\S+)$/;
/**
 * Plain "100000" / "0.35", or comma-grouped thousands "100,000" / "1,234.5"
 * (spec EPIC-002-FR02). A grouped number can't start with "0": "0,123" is a
 * decimal comma that would otherwise read as 123, so it is refused instead.
 */
const POSITIVE_NUMBER_PATTERN = /^(\d+|[1-9]\d{0,2}(,\d{3})+)(\.\d+)?$/;

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

    if (PORTFOLIO_COMMAND_ALIASES.has(command)) {
      return this.parsePortfolio(rawSymbols);
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
    const threshold = this.parsePositiveNumber(
      rawThreshold,
      MAX_THRESHOLD_DECIMALS,
      MAX_ALERT_THRESHOLD,
    );
    if (symbol.length > MAX_ALERT_SYMBOL_LENGTH || threshold === null) {
      return invalid;
    }

    return {
      type: CommandType.ALERT_CREATE,
      symbols: [symbol],
      alert: { direction: operator === '>' ? 'above' : 'below', threshold: threshold.value },
    };
  }

  /**
   * Parses the arguments of "/danhmuc" (spec EPIC-003-FR01, FR09, FR10,
   * FR14): none -> view, "mua|ban <coin> <quantity> <price>" -> trade,
   * "lichsu [page]" -> history, "xoa <n>" -> delete, "xoahet [xacnhan]" ->
   * clear. Numbers follow the "/canhbao" price rules (FR02); anything else,
   * including out-of-range values (NFR05), is PORTFOLIO_INVALID so the reply
   * can show the correct syntax.
   */
  private parsePortfolio(rawArgs: string[]): ParsedCommand {
    const invalid: ParsedCommand = { type: CommandType.PORTFOLIO_INVALID, symbols: [] };
    const args = rawArgs.map((arg) => this.stripDiacritics(arg.toLowerCase()));
    const [keyword, ...rest] = args;

    if (!keyword) {
      return { type: CommandType.PORTFOLIO_VIEW, symbols: [] };
    }

    if (PORTFOLIO_BUY_KEYWORDS.has(keyword) || PORTFOLIO_SELL_KEYWORDS.has(keyword)) {
      if (rest.length !== 3) {
        return invalid;
      }
      const [symbol, rawQuantity, rawPrice] = rest;
      const quantity = this.parsePositiveNumber(rawQuantity, MAX_QUANTITY_DECIMALS, MAX_QUANTITY);
      const price = this.parsePositiveNumber(rawPrice, MAX_THRESHOLD_DECIMALS, MAX_ALERT_THRESHOLD);
      if (
        !PORTFOLIO_SYMBOL_PATTERN.test(symbol) ||
        symbol.length > MAX_PORTFOLIO_SYMBOL_LENGTH ||
        quantity === null ||
        price === null
      ) {
        return invalid;
      }
      return {
        type: CommandType.PORTFOLIO_TRADE,
        symbols: [symbol],
        portfolio: {
          side: PORTFOLIO_BUY_KEYWORDS.has(keyword) ? 'buy' : 'sell',
          quantity: quantity.plain,
          priceUsd: price.value,
        },
      };
    }

    if (PORTFOLIO_HISTORY_KEYWORDS.has(keyword)) {
      if (rest.length > 1) {
        return invalid;
      }
      const page = rest.length === 0 ? 1 : this.parsePositiveInteger(rest[0]);
      return page === null
        ? invalid
        : { type: CommandType.PORTFOLIO_HISTORY, symbols: [], portfolio: { page } };
    }

    if (PORTFOLIO_DELETE_KEYWORDS.has(keyword)) {
      const index = rest.length === 1 ? this.parsePositiveInteger(rest[0]) : null;
      return index === null
        ? invalid
        : { type: CommandType.PORTFOLIO_DELETE, symbols: [], portfolio: { index } };
    }

    if (PORTFOLIO_CLEAR_KEYWORDS.has(keyword)) {
      if (rest.length > 1 || (rest.length === 1 && !PORTFOLIO_CONFIRM_KEYWORDS.has(rest[0]))) {
        return invalid;
      }
      return {
        type: CommandType.PORTFOLIO_CLEAR,
        symbols: [],
        portfolio: { confirmed: rest.length === 1 },
      };
    }

    return invalid;
  }

  /**
   * "100,000" -> { value: 100000, plain: "100000" }; null for anything
   * non-numeric, <= 0, larger than `max` or with more than `maxDecimals`
   * decimals. `plain` is the exact decimal text, for values stored exactly.
   */
  private parsePositiveNumber(
    raw: string,
    maxDecimals: number,
    max: number,
  ): { value: number; plain: string } | null {
    if (!POSITIVE_NUMBER_PATTERN.test(raw)) {
      return null;
    }
    const plain = raw.replace(/,/g, '');
    const decimals = plain.includes('.') ? plain.split('.')[1].length : 0;
    const value = Number(plain);
    if (decimals > maxDecimals || value <= 0 || value > max) {
      return null;
    }
    return { value, plain };
  }

  /** "3" -> 3; null for anything outside 1-999999. */
  private parsePositiveInteger(raw: string): number | null {
    if (!POSITIVE_INTEGER_PATTERN.test(raw) || Number(raw) < 1) {
      return null;
    }
    return Number(raw);
  }

  /** Removes Vietnamese diacritics so "/giá" and "/gia" resolve to the same command. */
  private stripDiacritics(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }
}
