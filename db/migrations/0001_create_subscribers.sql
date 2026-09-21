-- Initiative 1 (multi-tenant subscriptions): subscriber list for the daily
-- digest. See docs/ROADMAP.md. Run via `npm run db:migrate`.
CREATE TABLE IF NOT EXISTS subscribers (
  chat_id TEXT PRIMARY KEY,
  watchlist TEXT[] NOT NULL DEFAULT ARRAY['btc', 'eth']::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscribers_is_active_idx ON subscribers (is_active);
