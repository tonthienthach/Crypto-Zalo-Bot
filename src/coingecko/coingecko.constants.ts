/**
 * Static symbol -> CoinGecko coin-id map for the most commonly requested
 * coins. CoinGecko's REST API is keyed by internal `id` (e.g. "bitcoin"),
 * not by ticker ("btc"), so user input like "/gia btc" must be translated
 * before calling /simple/price.
 *
 * Unknown symbols fall back to using the lowercase symbol itself as the id
 * (best-effort — works for a handful of coins whose id equals the symbol,
 * fails gracefully otherwise and is reported to the user as "not found").
 */
export const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  bnb: 'binancecoin',
  xrp: 'ripple',
  ada: 'cardano',
  doge: 'dogecoin',
  dot: 'polkadot',
  matic: 'matic-network',
  pol: 'matic-network',
  avax: 'avalanche-2',
  ltc: 'litecoin',
  trx: 'tron',
  link: 'chainlink',
  usdt: 'tether',
  usdc: 'usd-coin',
  shib: 'shiba-inu',
  atom: 'cosmos',
  near: 'near',
  apt: 'aptos',
  arb: 'arbitrum',
  op: 'optimism',
  sui: 'sui',
  ton: 'the-open-network',
  bch: 'bitcoin-cash',
  etc: 'ethereum-classic',
  xlm: 'stellar',
  fil: 'filecoin',
  icp: 'internet-computer',
  uni: 'uniswap',
  pepe: 'pepe',
  wld: 'worldcoin-wld',
  ygg: 'yield-guild-games',
  '2z': 'doublezero',
};

export const DEFAULT_TOP_MARKETS_LIMIT = 5;
export const VS_CURRENCY = 'usd';
