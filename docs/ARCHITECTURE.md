# Architecture

## Request flow

```
Zalo user                Zalo Bot Platform              zalo-crypto-bot (Vercel Function / local Nest server)
   |  "/gia btc"                |                                        |
   |--------------------------->|                                        |
   |                            |  POST /webhook  (JSON body)            |
   |                            |--------------------------------------->|
   |                            |                                        |  1. WebhookSecretGuard checks
   |                            |                                        |     X-Bot-Api-Secret-Token header
   |                            |                                        |  2. ValidationPipe validates
   |                            |                                        |     ZaloWebhookDto
   |                            |                                        |  3. WebhookController extracts
   |                            |                                        |     message.text + chat.id
   |                            |                                        |  4. CommandParserService parses
   |                            |                                        |     "/gia btc" -> {PRICE, [btc]}
   |                            |                                        |  5. CoingeckoService resolves
   |                            |                                        |     symbol->id, checks best-effort
   |                            |                                        |     cache, calls CoinGecko REST API
   |                            |                                        |  6. format-message.util formats
   |                            |                                        |     the reply text
   |                            |                                        |  7. ZaloService POSTs the reply to
   |                            |                                        |     the Zalo Bot "sendMessage" API
   |                            |            <---------------------------|     (fire-and-forget from the
   |                            |               sendMessage(chat_id,text)|      webhook response's perspective)
   |                            |                                        |  8. Controller returns
   |                            |                                        |     200 { ok: true } to Zalo
   |                            |<---------------------------------------|
   |<---------------------------|  bot reply delivered to the chat       |
```

Two things happen on two separate HTTP round-trips: Zalo's webhook call is
acknowledged with `{ ok: true }` (step 8), while the actual reply text is
pushed to the user via a *separate* outbound call to the Zalo "send message"
API (step 7). This mirrors how Telegram-style bot platforms work and means
the reply is never carried in the webhook's own response body.

## Module map

| Module | Responsibility |
| --- | --- |
| `config/` | `ConfigModule` setup: Joi schema (`env.validation.ts`) validated once at boot, typed config object (`configuration.ts`). Fails fast — the process refuses to start if a required env var is missing or malformed. |
| `coingecko/` | Talks to the CoinGecko public REST API (`/simple/price`, `/coins/markets`), maps ticker symbols to CoinGecko coin ids, normalizes responses into `CoinMarketData`, and applies a best-effort cache. |
| `command-parser/` | Pure text-parsing service: turns a raw chat message into a `ParsedCommand` (`PRICE`, `TOP_MARKETS`, `HELP`, `UNKNOWN`). No I/O, fully unit-testable, handles accented/unaccented Vietnamese. |
| `zalo/` | Talks to the Zalo Bot "send message" API. Never throws — a failed send is logged and swallowed so an outbound Zalo outage can't turn into an unhandled webhook exception. |
| `webhook/` | `WebhookController` — the only place that wires parsing + CoinGecko + Zalo together. Guarded by `WebhookSecretGuard`, DTO-validated by `ZaloWebhookDto`. Always acknowledges 200 to Zalo. |
| `digest/` | `DigestController` — `POST /cron/daily-digest`, a machine-triggered (not user-triggered) endpoint that fetches the configured watchlist (`DIGEST_COIN_SYMBOLS`, default `btc,eth,ygg`) and pushes it to `DIGEST_CHAT_ID`. Guarded by `CronSecretGuard`. Has no scheduler of its own — see "Daily digest" below for what calls it. |
| `health/` | `GET /health` — liveness endpoint for uptime monitoring and Vercel health checks. |
| `common/filters` | `AllExceptionsFilter` — global catch-all; never leaks a stack trace to the client, and always answers webhook paths with 200 to avoid retry storms. |
| `common/guards` | `WebhookSecretGuard` (shared-secret auth for `/webhook`), `CronSecretGuard` (shared-secret auth for `/cron/daily-digest`), and `UserThrottlerGuard` (per-chat-id rate limiting, not per-IP — see below). |
| `common/interceptors` | `LoggingInterceptor` — structured (JSON) request/response logging. |
| `utils/format-message.util.ts` | Pure functions that turn `CoinMarketData[]` into the final chat message text (USD, VND estimate, 24h % with emoji). No side effects — fully unit-testable. |

## Design decisions

### Why CoinGecko?

- Free tier with no API key required for basic usage, generous enough rate
  limits for a personal/small-team bot.
- Single endpoint (`/simple/price`) covers "give me N tickers' prices",
  and `/coins/markets` covers "give me the top N by market cap" — both
  commands the bot needs map directly onto CoinGecko endpoints with no
  extra aggregation logic.
- Trade-off: CoinGecko's free tier is rate-limited and occasionally slow;
  the app treats every CoinGecko call as fallible (`CoingeckoUnavailableError`)
  and always degrades to a friendly chat message instead of failing silently.

### Why is the cache "best-effort" and not relied upon for correctness?

`@nestjs/cache-manager`'s default store is an in-memory `Map` inside the
Node process. On Vercel, each serverless function invocation may run in:

- the **same warm Lambda instance** as a previous request (cache hits work,
  bounded by the 30s TTL), or
- a **brand-new ("cold") instance** with its own empty in-memory cache —
  which is common under low/sporadic traffic, exactly the traffic pattern
  a chat bot has.

There is **no shared cache across instances** (no Redis, no shared memory)
in this setup. Consequently:

- The cache is purely a latency/rate-limit optimization for bursts of
  requests hitting the *same* warm instance within the TTL window.
- Every code path in `CoingeckoService` works correctly with a permanently
  empty cache — a cache miss simply calls the CoinGecko API, exactly as if
  caching didn't exist. Cache reads/writes are wrapped so a cache failure
  (or absence) never throws or changes behavior (`safeCacheGet`/`safeCacheSet`).
- If cross-instance caching ever becomes necessary (e.g. to survive
  CoinGecko rate limits under heavier traffic), swap in
  `cache-manager-redis-store` / `cache-manager-ioredis` behind the same
  `CACHE_MANAGER` token — no call site changes required.

### Why serverless (Vercel) vs. a long-running server?

| | Serverless (Vercel) | Long-running server |
| --- | --- | --- |
| Ops overhead | None — no server to patch/restart | You manage uptime, restarts, scaling |
| Cost at low traffic | Pay-per-invocation, effectively free for a small bot | Pay for an always-on instance |
| Cold starts | Yes — first request after idle pays Nest bootstrap cost (mitigated by caching the app instance per warm Lambda, see below) | None — app boots once and stays warm |
| In-memory state (cache, counters) | Not reliable across instances | Reliable within the single process |
| Long-lived connections / websockets | Not supported | Supported |

This bot is a stateless request/response webhook consumer with bursty,
low-average traffic — a textbook fit for serverless. The one real cost is
cold-start latency, mitigated by:

1. `api/index.ts` caches the built Nest application (`cachedAppPromise`) at
   module scope, so the Nest DI container is only constructed once per warm
   Lambda instance, not once per request.
2. Keeping the module graph small (no heavy startup work, no synchronous
   network calls during bootstrap).

### Local vs. Vercel entry points

- **Local** (`npm run start:dev`): `src/main.ts` calls `createApp()` then
  `app.listen(port)` — a normal, full-lifecycle Nest HTTP server.
- **Vercel**: `api/index.ts` calls the same `createApp()` (shared in
  `src/create-app.ts`) but calls `app.init()` instead of `listen()`, then
  forwards the raw Node `req`/`res` into the underlying Express instance on
  every invocation. `vercel.json` routes all paths to this one function.

Both entry points share the exact same `AppModule`, global pipes, filters,
and interceptors — there is no behavioral drift between "how it runs on my
machine" and "how it runs in production".

### Daily digest (scheduled push)

Unlike the webhook flow, this bot never has a long-running process to host
an in-process cron (`@nestjs/schedule`) — a Vercel Function only exists for
the duration of a request. So the scheduling itself lives *outside* the app:

```
GitHub Actions (cron: 0 2 * * * UTC = 9:00 ICT)
   |
   |  POST /cron/daily-digest
   |  X-Cron-Secret-Token: <CRON_SECRET_TOKEN>
   v
DigestController  -->  CoingeckoService.getPricesBySymbols(['btc','eth','ygg'])
                   -->  formatDailyDigestReply(...)
                   -->  ZaloService.sendTextMessage(DIGEST_CHAT_ID, text)
```

- **Why GitHub Actions instead of Vercel Cron**: Vercel's Hobby-plan cron
  jobs only guarantee daily granularity with looser timing precision; a
  GitHub Actions `schedule` trigger is free and lands close to the requested
  minute, which matters for a "9am sharp" digest. `workflow_dispatch` is also
  wired in so the digest can be triggered manually for testing.
- **Single recipient, no subscriber store**: `DIGEST_CHAT_ID` is a single
  env var, not a database-backed subscriber list — this bot serves one
  person's personal watchlist. If/when multiple recipients are needed, that's
  the point to introduce persistence (see "Why is the cache best-effort"
  above for the same serverless-statelessness constraint that would apply).
- **Auth model differs from `/webhook`**: `/cron/daily-digest` has no Zalo
  signature to verify (nothing came from Zalo), so it uses a separate
  `CronSecretGuard` + `CRON_SECRET_TOKEN` rather than reusing
  `WebhookSecretGuard`.
- **Failure handling**: like the webhook path, `DigestController` always
  returns `200 { ok: true }` — a CoinGecko or Zalo outage is logged
  server-side, not surfaced as an HTTP failure, so the scheduler doesn't
  retry-storm a transient outage.

### Error handling philosophy

The bot must **never** go silent and **never** leak a stack trace:

1. `WebhookController` wraps command handling in a try/catch. Known,
   expected failure modes (`UnknownCoinSymbolsError`, `CoingeckoUnavailableError`)
   get a specific, friendly Vietnamese reply. Anything else falls through to
   a generic "something went wrong" reply, with the real error logged
   server-side only.
2. `AllExceptionsFilter` is the last line of defense for errors thrown
   *before* the controller body runs (e.g. a guard or pipe failure). It
   never returns a stack trace, and for any `/webhook*` path it still
   responds `200 { ok: true }` so Zalo doesn't interpret the failure as a
   delivery error and retry.
3. `ZaloService.sendTextMessage` itself never throws — a Zalo API outage is
   logged and swallowed rather than surfaced as a second failure on top of
   the first.
