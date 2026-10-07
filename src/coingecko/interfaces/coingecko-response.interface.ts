/** Shape of one entry returned by /simple/price?...&include_market_cap=true&include_24hr_change=true */
export interface CoinGeckoSimplePriceEntry {
  usd: number;
  usd_24h_change?: number;
  usd_market_cap?: number;
}

export type CoinGeckoSimplePriceResponse = Record<string, CoinGeckoSimplePriceEntry>;

/** Shape of one entry returned by /coins/markets */
export interface CoinGeckoMarketCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number | null;
}

/** Shape of /coins/{id}/market_chart: `prices` is a list of [epoch ms, usd]. */
export interface CoinGeckoMarketChartResponse {
  prices: [number, number][];
}

/** One history sample: epoch milliseconds and USD price. */
export interface MarketChartPoint {
  t: number;
  p: number;
}

/** Normalized, app-internal representation used everywhere outside CoingeckoService. */
export interface CoinMarketData {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  changePercent24h: number | null;
  marketCapUsd?: number;
}
