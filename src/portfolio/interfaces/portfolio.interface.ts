export type TradeSide = 'buy' | 'sell';

/** One recorded trade, as stored. `seq` is the chat's stable trade number (spec EPIC-003-FR09). */
export interface PortfolioTrade {
  seq: number;
  side: TradeSide;
  symbol: string;
  /** Exact decimal string, e.g. "0.5" or "0.50000000" (Postgres NUMERIC comes back as a string). */
  quantity: string;
  priceUsd: number;
  createdAt: Date;
}

/** A coin the chat still holds (quantity > 0), from the weighted-average cost method (FR05). */
export interface Holding {
  symbol: string;
  /** Held quantity, as a trimmed decimal string ("0.6"). */
  quantity: string;
  /** Held quantity in 10^-8 units, exact. */
  quantityUnits: bigint;
  avgCostUsd: number;
  /** avgCostUsd × quantity: the cost of what is still held. */
  costBasisUsd: number;
}

export interface HoldingsResult {
  /** Coins with quantity > 0, in the order they were first bought. */
  holdings: Holding[];
  /** Realized profit/loss from every sell, including coins no longer held. */
  realizedPnlUsd: number;
  /** Realized profit/loss per symbol, including coins no longer held. */
  realizedBySymbol: Map<string, number>;
}

/** Price of one held coin, as the price source returned it. */
export interface HoldingPrice {
  priceUsd: number;
  changePercent24h: number | null;
}

export interface PricedHoldingLine {
  priced: true;
  symbol: string;
  quantity: string;
  priceUsd: number;
  valueUsd: number;
  unrealizedPnlUsd: number;
  /** null when the cost basis is 0 (can't happen for a held coin, kept for safety). */
  unrealizedPnlPercent: number | null;
  /** null when the price source had no 24h change for this coin. */
  change24hUsd: number | null;
}

export interface UnpricedHoldingLine {
  priced: false;
  symbol: string;
  quantity: string;
}

export type HoldingLine = PricedHoldingLine | UnpricedHoldingLine;

/** Everything "/danhmuc" and the digest show (spec EPIC-003-FR06, FR07, FR11). */
export interface PortfolioSnapshot {
  lines: HoldingLine[];
  /** Sum over priced coins only (AC13). */
  totalValueUsd: number;
  totalCostBasisUsd: number;
  unrealizedPnlUsd: number;
  /** On the cost basis of the priced coins still held; null if there is none. */
  unrealizedPnlPercent: number | null;
  realizedPnlUsd: number;
  /** Over priced coins that also have a 24h change; null if there are none. */
  change24hUsd: number | null;
  change24hPercent: number | null;
  /** Held coins with no price right now, left out of every total. */
  unpricedSymbols: string[];
  /** Priced coins with no 24h change, left out of the 24h change only. */
  missingChangeSymbols: string[];
}
