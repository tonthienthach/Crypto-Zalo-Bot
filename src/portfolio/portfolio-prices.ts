import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import { HoldingPrice } from './interfaces/portfolio.interface';

/**
 * Prices keyed by each requested symbol, from one price lookup. Two symbols
 * can share one CoinGecko id (e.g. "matic" and "pol") and the lookup then
 * returns that coin under only one of them, so symbols are also matched
 * through their resolved id — the same rule as PriceAlertsController.loadPrices.
 * Symbols the lookup didn't return are absent.
 */
export function pricesBySymbol(
  coins: CoinMarketData[],
  symbols: string[],
  resolveSymbolToId: (symbol: string) => string,
): Map<string, HoldingPrice> {
  const bySymbol = new Map(coins.map((coin) => [coin.symbol, coin]));
  const byId = new Map(coins.map((coin) => [coin.id, coin]));
  const prices = new Map<string, HoldingPrice>();
  for (const symbol of symbols) {
    const coin = bySymbol.get(symbol) ?? byId.get(resolveSymbolToId(symbol));
    if (coin) {
      prices.set(symbol, { priceUsd: coin.priceUsd, changePercent24h: coin.changePercent24h });
    }
  }
  return prices;
}
