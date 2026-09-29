# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Portfolio tracking (Initiative 3 / EPIC-003, merged to `master`
  2026-09-29, not yet deployed; see `docs/ROADMAP.md`): new
  `/danhmuc mua|ban <coin> <qty> <price>` records a manually entered trade
  (Postgres, weighted-average cost), `/danhmuc` shows holdings/PnL/24h
  change, `/danhmuc lichsu` the trade history, `/danhmuc xoa <n>` /
  `/danhmuc xoahet` delete; private chats only. A portfolio section is
  added to the 9am digest. A redelivered Zalo message never records a
  trade twice (dedup on `message_id`); a quantity may not contain a comma.
  New `db/migrations/0002_create_portfolio.sql` and
  `npm run portfolio:report` (usage, read-only). See `docs/DEPLOYMENT.md`
  step 3a (re-run `npm run db:migrate`) — no new env vars.
- Price-alert monitoring (Initiative 2 / EPIC-002-FIX, merged to `master`
  2026-09-29, not yet deployed; see `docs/ROADMAP.md`): an independent
  watcher (`/cron/price-alerts-watch`, Upstash QStash every 5 min) tells
  the owner within ~20 min if the per-minute alert check itself stops
  running, with a recovery message once it resumes; each check run is now
  logged with an outcome (`healthy`/`no-price`/`failed`/`skipped`/
  `rejected`) so `npm run alerts:report` can tell "not called" from
  "called but broken". New env `PRICE_ALERTS_WATCH_SECRET` /
  `OWNER_CHAT_ID`. See `docs/DEPLOYMENT.md` step 8b.
- Price alerts (Initiative 2 / EPIC-002, deployed to production 2026-09-23;
  see `docs/ROADMAP.md`): new
  `/canhbao <coin> > <price>` / `<` command, plus `/canhbao` (list) and
  `/canhbao xoa <n>` (delete); max 10 alerts per chat. A new
  `/cron/price-alerts` check, triggered every minute by cron-job.org, fires a
  Zalo message on crossing, then re-arms after a 0.5% move back (at most one
  message per alert per 15 minutes). Alerts are stored in Upstash Redis
  (`KV_REST_API_URL`/`KV_REST_API_TOKEN`), not Postgres. New
  `npm run alerts:report` read-only report. See `docs/DEPLOYMENT.md` steps
  3b and 8a.

### Changed
- `ZaloService.sendTextMessage` now resolves `true`/`false` (still never
  throws), and `chat.id` in webhook payloads is capped at 64 characters
  (EPIC-001 review finding #3).

### Added
- Multi-tenant digest subscriptions (Initiative 1, see `docs/ROADMAP.md`):
  new `/dangky [symbols...]`, `/huy`, and `/watchlist [symbols...]` commands,
  backed by a new `subscribers` table in Vercel Postgres (`src/subscribers`).
  `DigestController` now sends the daily digest to every active subscriber
  with their own watchlist instead of a single hardcoded `DIGEST_CHAT_ID`.
  Migration tooling: `npm run db:migrate` and
  `npm run db:seed-digest-subscriber` (see `docs/DEPLOYMENT.md` step 3a).

### Changed
- Daily digest cron switched from a GitHub Actions `schedule` workflow to
  **Vercel Cron** (`vercel.json` "crons"), after the GH Actions trigger was
  observed firing ~4h late. `/cron/daily-digest` now accepts any HTTP method
  (`@All`) and `CronSecretGuard` also accepts Vercel's auto-injected
  `Authorization: Bearer <CRON_SECRET>` header, alongside the existing
  `X-Cron-Secret-Token` header used for manual testing.

### Added
- Temporary cron drift tracking: `DigestController` logs actual-vs-expected
  (09:00 ICT) invocation time on every run, and — while
  `DIGEST_CRON_TRACKING=true` (default) — appends a visible drift line to
  the digest message itself so timing can be monitored in-chat for a few
  days. See `.aidlc/runs/2026-09-17-cron-digest-drift/`.

### Removed
- `.github/workflows/daily-digest.yml` (replaced by Vercel Cron).

## [0.1.0] - 2026-09-04

### Added
- Initial NestJS project scaffold for `zalo-crypto-bot`.
- `POST /webhook` endpoint receiving Zalo Bot Platform updates, guarded by a
  shared-secret `WebhookSecretGuard` and validated via `ZaloWebhookDto`.
- Command parsing (`CommandParserService`) supporting `/gia`, `/giá`,
  `/price` (with/without ticker symbols), and `/help`/`/start`.
- CoinGecko integration (`CoingeckoService`) for single/multi-coin prices
  and top-5-by-market-cap lookups, with a best-effort in-memory cache.
- Message formatting (`format-message.util.ts`): USD price, static-rate VND
  estimate, 24h % change with 🔺/🔻 emoji.
- Global error handling (`AllExceptionsFilter`) that never leaks a stack
  trace and always acks `/webhook*` calls with `200`.
- Per-chat-id rate limiting (`UserThrottlerGuard`) via `@nestjs/throttler`.
- `GET /health` liveness endpoint.
- Vercel serverless entry point (`api/index.ts`) with a cached Nest app
  instance across warm invocations, plus `vercel.json` routing.
- ESLint, Prettier, Husky + lint-staged pre-commit hook.
- GitHub Actions CI (lint, unit tests, e2e tests, build) on every PR.
- Unit tests for `CommandParserService`, `format-message.util`, and
  `CoingeckoService`; e2e tests for `WebhookController`.
- Full documentation set under `docs/` (architecture, setup, deployment,
  API reference, contribution rules, troubleshooting).

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/tag/v0.1.0
