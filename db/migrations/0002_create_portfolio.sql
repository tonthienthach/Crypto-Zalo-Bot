-- EPIC-003 (portfolio tracking): each chat's manually entered buy/sell
-- trades, plus a per-chat per-day usage counter for the success metric.
-- See docs/epics/EPIC-003. Run via `npm run db:migrate`.
--
-- db-migrate.js re-runs every file on each call and splits on semicolons,
-- so this file stays idempotent (IF NOT EXISTS only) and has no semicolon
-- inside a literal or a DO block.
--
-- Rollback (loses every trade users recorded — owner decision only):
--   DROP TABLE IF EXISTS portfolio_usage
--   DROP TABLE IF EXISTS portfolio_trades
CREATE TABLE IF NOT EXISTS portfolio_trades (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL CHECK (char_length(chat_id) BETWEEN 1 AND 64),
  seq INTEGER NOT NULL CHECK (seq > 0),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  symbol TEXT NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 20),
  quantity NUMERIC(21, 8) NOT NULL CHECK (quantity > 0),
  price_usd NUMERIC(21, 8) NOT NULL CHECK (price_usd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);

CREATE TABLE IF NOT EXISTS portfolio_usage (
  chat_id TEXT NOT NULL CHECK (char_length(chat_id) BETWEEN 1 AND 64),
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, day)
);
