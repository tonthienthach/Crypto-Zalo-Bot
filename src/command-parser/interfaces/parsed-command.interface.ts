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
  /** "/danhmuc" with no arguments. */
  PORTFOLIO_VIEW = 'PORTFOLIO_VIEW',
  /** "/danhmuc mua|ban <coin> <quantity> <price>". */
  PORTFOLIO_TRADE = 'PORTFOLIO_TRADE',
  /** "/danhmuc lichsu [page]". */
  PORTFOLIO_HISTORY = 'PORTFOLIO_HISTORY',
  /** "/danhmuc xoa <n>". */
  PORTFOLIO_DELETE = 'PORTFOLIO_DELETE',
  /** "/danhmuc xoahet [xacnhan]". */
  PORTFOLIO_CLEAR = 'PORTFOLIO_CLEAR',
  /** "/danhmuc ..." with arguments that don't match any valid portfolio syntax. */
  PORTFOLIO_INVALID = 'PORTFOLIO_INVALID',
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

/** Arguments of a "/danhmuc" command. Only the fields relevant to its CommandType are set. */
export interface PortfolioCommandArgs {
  /** PORTFOLIO_TRADE. */
  side?: 'buy' | 'sell';
  /** PORTFOLIO_TRADE: exact decimal string with thousands separators removed, e.g. "0.5". */
  quantity?: string;
  /** PORTFOLIO_TRADE: USD price of one coin. */
  priceUsd?: number;
  /** PORTFOLIO_HISTORY: 1-based page. */
  page?: number;
  /** PORTFOLIO_DELETE: the trade number shown by "/danhmuc lichsu". */
  index?: number;
  /** PORTFOLIO_CLEAR: true only for "/danhmuc xoahet xacnhan". */
  confirmed?: boolean;
}

export interface ParsedCommand {
  type: CommandType;
  /**
   * Lowercase ticker symbols requested, e.g. ["btc", "eth"]. Empty for
   * TOP_MARKETS/HELP/UNSUBSCRIBE/UNKNOWN, and for WATCHLIST when viewing
   * (no symbols given) rather than editing. ALERT_CREATE carries exactly
   * one symbol, and so does PORTFOLIO_TRADE.
   */
  symbols: string[];
  /** Set only for ALERT_CREATE / ALERT_DELETE. */
  alert?: AlertCommandArgs;
  /** Set only for the PORTFOLIO_* types that take arguments. */
  portfolio?: PortfolioCommandArgs;
}
