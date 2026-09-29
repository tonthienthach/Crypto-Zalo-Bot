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
--   DROP TABLE IF EXISTS portfolio_trades  (drops its index too)
CREATE TABLE IF NOT EXISTS portfolio_trades (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL CHECK (char_length(chat_id) BETWEEN 1 AND 64),
  seq INTEGER NOT NULL CHECK (seq > 0),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  symbol TEXT NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 20),
  quantity NUMERIC(21, 8) NOT NULL CHECK (quantity > 0),
  price_usd NUMERIC(21, 8) NOT NULL CHECK (price_usd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Zalo message_id of the command that recorded this trade: a redelivered
  -- webhook carries the same id and must not record the trade twice.
  source_message_id TEXT CHECK (char_length(source_message_id) BETWEEN 1 AND 128),
  UNIQUE (chat_id, seq)
);

-- source_message_id was added to this file after it was first written: a
-- database that already ran the earlier version has the table without it.
ALTER TABLE portfolio_trades
  ADD COLUMN IF NOT EXISTS source_message_id TEXT
  CHECK (char_length(source_message_id) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_trades_chat_source_message_idx
  ON portfolio_trades (chat_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS portfolio_usage (
  chat_id TEXT NOT NULL CHECK (char_length(chat_id) BETWEEN 1 AND 64),
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, day)
);
