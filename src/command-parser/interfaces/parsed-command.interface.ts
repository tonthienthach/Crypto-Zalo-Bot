export enum CommandType {
  PRICE = 'PRICE',
  TOP_MARKETS = 'TOP_MARKETS',
  HELP = 'HELP',
  UNKNOWN = 'UNKNOWN',
}

export interface ParsedCommand {
  type: CommandType;
  /** Lowercase ticker symbols requested, e.g. ["btc", "eth"]. Empty for TOP_MARKETS/HELP/UNKNOWN. */
  symbols: string[];
}
