import { Injectable } from '@nestjs/common';
import { CommandType, ParsedCommand } from './interfaces/parsed-command.interface';

const PRICE_COMMAND_ALIASES = new Set(['gia', 'gía', 'giá', 'price']);
const HELP_COMMAND_ALIASES = new Set(['help', 'start', 'trogiup', 'trợgiúp']);
const SUBSCRIBE_COMMAND_ALIASES = new Set(['dangky', 'subscribe']);
const UNSUBSCRIBE_COMMAND_ALIASES = new Set(['huy', 'huydangky', 'unsubscribe']);
const WATCHLIST_COMMAND_ALIASES = new Set(['watchlist', 'danhsach', 'ds']);

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

  /** Removes Vietnamese diacritics so "/giá" and "/gia" resolve to the same command. */
  private stripDiacritics(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }
}
