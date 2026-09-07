/**
 * CoinPaprika's free tier needs no API key and no account — see
 * docs/ARCHITECTURE.md for why it was picked as the CoinGecko fallback
 * (CoinGecko has no entry for a symbol, or the static symbol->id map in
 * coingecko.constants.ts hasn't been taught that symbol yet).
 */
export const COINPAPRIKA_API_BASE_URL = 'https://api.coinpaprika.com/v1';

/** Cache key for the full /v1/tickers?quotes=USD snapshot (thousands of coins, fetched at most once per TTL). */
export const COINPAPRIKA_TICKERS_CACHE_KEY = 'coinpaprika:tickers:usd';
