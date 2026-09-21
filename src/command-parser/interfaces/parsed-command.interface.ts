export enum CommandType {
  PRICE = 'PRICE',
  TOP_MARKETS = 'TOP_MARKETS',
  HELP = 'HELP',
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  WATCHLIST = 'WATCHLIST',
  UNKNOWN = 'UNKNOWN',
}

export interface ParsedCommand {
  type: CommandType;
  /**
   * Lowercase ticker symbols requested, e.g. ["btc", "eth"]. Empty for
   * TOP_MARKETS/HELP/UNSUBSCRIBE/UNKNOWN, and for WATCHLIST when viewing
   * (no symbols given) rather than editing.
   */
  symbols: string[];
}
