import {
  Holding,
  HoldingLine,
  HoldingPrice,
  HoldingsResult,
  PortfolioSnapshot,
  PortfolioTrade,
} from './interfaces/portfolio.interface';
import { MAX_QUANTITY_DECIMALS, QUANTITY_SCALE, TWIN_TRADE_WINDOW_MS } from './portfolio.constants';

/**
 * Raised when stored trades can't be replayed — a sell larger than what was
 * held at that point. The store refuses such writes (spec EPIC-003-FR04,
 * FR10), so this only means the rows were changed outside the bot.
 */
export class InconsistentTradesError extends Error {}

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * "0.5" / "0.50000000" -> 50000000n (10^-8 units). Throws on anything that
 * isn't a plain decimal. The error never quotes the quantity: callers log
 * its message, and logs carry no amounts (spec EPIC-003-NFR06).
 */
export function toQuantityUnits(quantity: string): bigint {
  if (!DECIMAL_PATTERN.test(quantity)) {
    throw new InconsistentTradesError('Not a decimal quantity');
  }
  const [whole, fraction = ''] = quantity.split('.');
  const significant = fraction.replace(/0+$/, '');
  if (significant.length > MAX_QUANTITY_DECIMALS) {
    throw new InconsistentTradesError(`Quantity has more than ${MAX_QUANTITY_DECIMALS} decimals`);
  }
  return BigInt(whole) * QUANTITY_SCALE + BigInt(significant.padEnd(MAX_QUANTITY_DECIMALS, '0'));
}

/** 60000000n -> "0.6", 100000000n -> "1". */
export function formatQuantityUnits(units: bigint): string {
  const whole = units / QUANTITY_SCALE;
  const fraction = (units % QUANTITY_SCALE)
    .toString()
    .padStart(MAX_QUANTITY_DECIMALS, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function unitsToNumber(units: bigint): number {
  return Number(units) / Number(QUANTITY_SCALE);
}

interface SymbolState {
  units: bigint;
  costUsd: number;
  realizedUsd: number;
}

/**
 * Replays trades in `seq` order with the weighted-average cost method (spec
 * EPIC-003-FR05): a buy adds to the cost, a sell keeps the average cost and
 * realizes quantity × (sell price − average cost), and a coin sold down to
 * exactly zero starts over with no cost. Recomputed from scratch every time,
 * so adding or deleting a trade never leaves an accumulated error.
 */
export function computeHoldings(trades: PortfolioTrade[]): HoldingsResult {
  const bySymbol = new Map<string, SymbolState>();
  for (const trade of [...trades].sort((a, b) => a.seq - b.seq)) {
    const state = bySymbol.get(trade.symbol) ?? { units: 0n, costUsd: 0, realizedUsd: 0 };
    bySymbol.set(trade.symbol, state);
    const units = toQuantityUnits(trade.quantity);
    const quantity = unitsToNumber(units);

    if (trade.side === 'buy') {
      state.units += units;
      state.costUsd += quantity * trade.priceUsd;
      continue;
    }

    if (units > state.units) {
      throw new InconsistentTradesError(
        `Trade #${trade.seq} sells more ${trade.symbol} than was held`,
      );
    }
    const avgCostUsd = state.costUsd / unitsToNumber(state.units);
    state.realizedUsd += quantity * (trade.priceUsd - avgCostUsd);
    state.units -= units;
    // Recomputed from the average rather than subtracted, so repeated sells don't drift.
    state.costUsd = state.units === 0n ? 0 : avgCostUsd * unitsToNumber(state.units);
  }

  const holdings: Holding[] = [];
  const realizedBySymbol = new Map<string, number>();
  let realizedPnlUsd = 0;
  for (const [symbol, state] of bySymbol) {
    realizedBySymbol.set(symbol, state.realizedUsd);
    realizedPnlUsd += state.realizedUsd;
    if (state.units > 0n) {
      const heldQuantity = unitsToNumber(state.units);
      holdings.push({
        symbol,
        quantity: formatQuantityUnits(state.units),
        quantityUnits: state.units,
        avgCostUsd: state.costUsd / heldQuantity,
        costBasisUsd: state.costUsd,
      });
    }
  }
  return { holdings, realizedPnlUsd, realizedBySymbol };
}

/** Held quantity of one symbol ("0" when not held). */
export function heldQuantityOf(result: HoldingsResult, symbol: string): string {
  return result.holdings.find((holding) => holding.symbol === symbol)?.quantity ?? '0';
}

/**
 * Values the holdings at current prices (spec EPIC-003-FR06, FR07). A coin
 * with no price is listed but left out of every total; a coin with no 24h
 * change is left out of the 24h change only (spec §3.2, AC13). The 24h
 * change uses today's quantities: value − value / (1 + change% / 100).
 */
export function computePortfolio(
  result: HoldingsResult,
  prices: Map<string, HoldingPrice>,
): PortfolioSnapshot {
  const lines: HoldingLine[] = [];
  const unpricedSymbols: string[] = [];
  const missingChangeSymbols: string[] = [];
  let totalValueUsd = 0;
  let totalCostBasisUsd = 0;
  let change24hUsd = 0;
  let valueWithChangeUsd = 0;
  let changedCount = 0;

  for (const holding of result.holdings) {
    const price = prices.get(holding.symbol);
    if (!price) {
      unpricedSymbols.push(holding.symbol);
      lines.push({ priced: false, symbol: holding.symbol, quantity: holding.quantity });
      continue;
    }

    const valueUsd = unitsToNumber(holding.quantityUnits) * price.priceUsd;
    const unrealizedPnlUsd = valueUsd - holding.costBasisUsd;
    // At −100% or below, 1 + change% / 100 is ≤ 0 and the value a day ago comes
    // out infinite or negative: treat it like a missing 24h change, not "−$∞".
    const hasChange =
      price.changePercent24h !== null &&
      Number.isFinite(price.changePercent24h) &&
      price.changePercent24h > -100;
    const lineChangeUsd = hasChange
      ? valueUsd - valueUsd / (1 + (price.changePercent24h as number) / 100)
      : null;

    totalValueUsd += valueUsd;
    totalCostBasisUsd += holding.costBasisUsd;
    if (lineChangeUsd === null) {
      missingChangeSymbols.push(holding.symbol);
    } else {
      change24hUsd += lineChangeUsd;
      valueWithChangeUsd += valueUsd;
      changedCount++;
    }

    lines.push({
      priced: true,
      symbol: holding.symbol,
      quantity: holding.quantity,
      priceUsd: price.priceUsd,
      valueUsd,
      unrealizedPnlUsd,
      unrealizedPnlPercent:
        holding.costBasisUsd > 0 ? (unrealizedPnlUsd / holding.costBasisUsd) * 100 : null,
      change24hUsd: lineChangeUsd,
    });
  }

  const unrealizedPnlUsd = totalValueUsd - totalCostBasisUsd;
  const valueDayAgoUsd = valueWithChangeUsd - change24hUsd;
  return {
    lines,
    totalValueUsd,
    totalCostBasisUsd,
    unrealizedPnlUsd,
    unrealizedPnlPercent:
      totalCostBasisUsd > 0 ? (unrealizedPnlUsd / totalCostBasisUsd) * 100 : null,
    realizedPnlUsd: result.realizedPnlUsd,
    change24hUsd: changedCount > 0 ? change24hUsd : null,
    change24hPercent:
      changedCount > 0 && valueDayAgoUsd > 0 ? (change24hUsd / valueDayAgoUsd) * 100 : null,
    unpricedSymbols,
    missingChangeSymbols,
  };
}

/**
 * The trade just before `trade` if it is identical (side, coin, quantity,
 * price) and was recorded within TWIN_TRADE_WINDOW_MS — most likely the user
 * sent the same command twice. Both are kept (spec EPIC-003-AC19); the reply
 * only points at the older one so the user can delete a mistake.
 */
export function findRecentTwin(
  trades: PortfolioTrade[],
  trade: PortfolioTrade,
): PortfolioTrade | undefined {
  const previous = trades.filter((other) => other.seq < trade.seq).pop();
  if (
    previous &&
    previous.side === trade.side &&
    previous.symbol === trade.symbol &&
    toQuantityUnits(previous.quantity) === toQuantityUnits(trade.quantity) &&
    previous.priceUsd === trade.priceUsd &&
    trade.createdAt.getTime() - previous.createdAt.getTime() <= TWIN_TRADE_WINDOW_MS
  ) {
    return previous;
  }
  return undefined;
}
