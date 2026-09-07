/**
 * Typed, namespaced view of process.env, built after Joi validation has
 * already guaranteed shape/presence. Inject via ConfigService.get(...) using
 * these dotted paths instead of reading process.env directly anywhere else
 * in the codebase.
 */
export default () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'log',

  zalo: {
    botToken: process.env.ZALO_BOT_TOKEN,
    apiBaseUrl: process.env.ZALO_API_BASE_URL,
    webhookSecretToken: process.env.WEBHOOK_SECRET_TOKEN,
  },

  coingecko: {
    apiBaseUrl: process.env.COINGECKO_API_BASE_URL,
    apiKey: process.env.COINGECKO_API_KEY ?? '',
    cacheTtlSeconds: parseInt(process.env.COINGECKO_CACHE_TTL_SECONDS ?? '30', 10),
  },

  coinpaprika: {
    cacheTtlSeconds: parseInt(process.env.COINPAPRIKA_CACHE_TTL_SECONDS ?? '30', 10),
  },

  currency: {
    usdToVndRate: parseFloat(process.env.USD_TO_VND_RATE ?? '25400'),
  },

  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '10', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '5', 10),
  },
});
