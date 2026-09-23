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

  cron: {
    secretToken: process.env.CRON_SECRET_TOKEN,
  },

  digest: {
    // Temporary: appends a "fired at HH:mm ICT, drift ±Xm" line to the digest
    // message so cron timing can be eyeballed in the chat itself for a few
    // days after the GitHub Actions -> Vercel Cron switch (see
    // .aidlc/runs/2026-09-17-cron-digest-drift). Set to "false" once the
    // drift has been confirmed acceptable.
    cronTrackingEnabled: process.env.DIGEST_CRON_TRACKING !== 'false',
  },

  db: {
    // Vercel Postgres (Neon integration) connection string — auto-populated
    // by Vercel when the integration is attached; set manually for local
    // dev. See docs/DEPLOYMENT.md.
    connectionString: process.env.POSTGRES_URL,
  },

  redis: {
    // Upstash Redis REST endpoint + token (Vercel Marketplace integration)
    // backing price alerts. Kept off Postgres so the per-minute alert check
    // doesn't keep the Neon compute awake — see docs/ARCHITECTURE.md.
    restUrl: process.env.KV_REST_API_URL,
    restToken: process.env.KV_REST_API_TOKEN,
  },

  priceAlerts: {
    cronSecretToken: process.env.PRICE_ALERTS_CRON_SECRET,
  },
});
