import * as Joi from 'joi';

/**
 * Joi schema validated once at bootstrap (see ConfigModule.forRoot in
 * app.module.ts). Any missing/invalid variable throws immediately and
 * prevents the app from starting — we never want a half-configured bot
 * silently running in production.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string().valid('debug', 'log', 'warn', 'error', 'verbose').default('log'),

  ZALO_BOT_TOKEN: Joi.string().required(),
  ZALO_API_BASE_URL: Joi.string().uri().required(),
  // Zalo's setWebhook API requires secret_token to be 8-256 characters.
  WEBHOOK_SECRET_TOKEN: Joi.string().min(8).max(256).required(),

  COINGECKO_API_BASE_URL: Joi.string().uri().required(),
  COINGECKO_API_KEY: Joi.string().allow('').optional(),
  COINGECKO_CACHE_TTL_SECONDS: Joi.number().integer().min(0).default(30),
  COINPAPRIKA_CACHE_TTL_SECONDS: Joi.number().integer().min(0).default(30),

  USD_TO_VND_RATE: Joi.number().positive().required(),

  THROTTLE_TTL_SECONDS: Joi.number().integer().min(1).default(10),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(5),

  // Daily digest cron hook (see src/digest) — same length constraint as
  // WEBHOOK_SECRET_TOKEN, for the same reason (long random string).
  CRON_SECRET_TOKEN: Joi.string().min(8).max(256).required(),
  DIGEST_CRON_TRACKING: Joi.string().valid('true', 'false').default('true'),
  // Legacy single-tenant digest recipient — no longer read at runtime
  // (DigestController now reads subscribers from the DB, see
  // src/subscribers). Kept optional so scripts/db-seed-digest-subscriber.js
  // can still migrate the old recipient into the `subscribers` table.
  DIGEST_CHAT_ID: Joi.string().optional(),
  DIGEST_COIN_SYMBOLS: Joi.string().optional(),

  // Vercel Postgres (Neon integration) connection string — see
  // docs/ROADMAP.md Initiative 1 and docs/DEPLOYMENT.md.
  POSTGRES_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
});
