export enum CommandType {
  PRICE = 'PRICE',
  TOP_MARKETS = 'TOP_MARKETS',
  HELP = 'HELP',
  SUBSCRIBE = 'SUBSCRIBE',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  WATCHLIST = 'WATCHLIST',
  ALERT_CREATE = 'ALERT_CREATE',
  ALERT_LIST = 'ALERT_LIST',
  ALERT_DELETE = 'ALERT_DELETE',
  /** "/canhbao ..." with arguments that don't match any valid alert syntax. */
  ALERT_INVALID = 'ALERT_INVALID',
  UNKNOWN = 'UNKNOWN',
}

/** Arguments of a "/canhbao" command. Only the fields relevant to its CommandType are set. */
export interface AlertCommandArgs {
  /** ALERT_CREATE: "above" for `>`, "below" for `<`. */
  direction?: 'above' | 'below';
  /** ALERT_CREATE: USD price level. */
  threshold?: number;
  /** ALERT_DELETE: 1-based position in the chat's "/canhbao" list. */
  index?: number;
}

export interface ParsedCommand {
  type: CommandType;
  /**
   * Lowercase ticker symbols requested, e.g. ["btc", "eth"]. Empty for
   * TOP_MARKETS/HELP/UNSUBSCRIBE/UNKNOWN, and for WATCHLIST when viewing
   * (no symbols given) rather than editing. ALERT_CREATE carries exactly
   * one symbol.
   */
  symbols: string[];
  /** Set only for ALERT_CREATE / ALERT_DELETE. */
  alert?: AlertCommandArgs;
}
