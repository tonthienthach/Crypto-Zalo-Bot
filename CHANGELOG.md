# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet.

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
