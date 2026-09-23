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
| `command-parser/` | Pure text-parsing service: turns a raw chat message into a `ParsedCommand` (`PRICE`, `TOP_MARKETS`, `HELP`, `SUBSCRIBE`, `UNSUBSCRIBE`, `WATCHLIST`, `ALERT_CREATE`/`ALERT_LIST`/`ALERT_DELETE`/`ALERT_INVALID`, `UNKNOWN`). No I/O, fully unit-testable, handles accented/unaccented Vietnamese. |
| `subscribers/` | `SubscribersService` — CRUD over the `subscribers` table (Vercel Postgres / Neon) backing `/dangky`, `/huy`, `/watchlist`, and the daily digest recipient list. See "Persistence" below. |
| `price-alerts/` | `PriceAlertsService` — alert storage in Upstash Redis (`/canhbao`); `PriceAlertsController` — `/cron/price-alerts`, the per-minute check, guarded by `CronSecretGuard`; `evaluateAlert()` — the pure fire / re-arm / cooldown rules. See "Price alerts" below. |
| `zalo/` | Talks to the Zalo Bot "send message" API. Never throws — a failed send is logged and swallowed so an outbound Zalo outage can't turn into an unhandled webhook exception. Resolves `true`/`false` so callers that care (the alert check) know whether the send landed. |
| `webhook/` | `WebhookController` — the only place that wires parsing + CoinGecko + Zalo + Subscribers together. Guarded by `WebhookSecretGuard`, DTO-validated by `ZaloWebhookDto`. Always acknowledges 200 to Zalo. |
| `digest/` | `DigestController` — `POST /cron/daily-digest`, a machine-triggered (not user-triggered) endpoint that loads active subscribers from `SubscribersService` and pushes each their own watchlist. Guarded by `CronSecretGuard`. Has no scheduler of its own — see "Daily digest" below for what calls it. |
| `health/` | `GET /health` — liveness endpoint for uptime monitoring and Vercel health checks. |
| `common/filters` | `AllExceptionsFilter` — global catch-all; never leaks a stack trace to the client, and answers webhook paths with 200 for any *unexpected* (non-`HttpException`) error to avoid retry storms. Guard and DTO-validation failures keep their `401`/`400` (see `docs/API.md`). |
| `common/guards` | `WebhookSecretGuard` (shared-secret auth for `/webhook`), `CronSecretGuard` (shared-secret auth for `/cron/daily-digest` and `/cron/price-alerts`), and `UserThrottlerGuard` (per-chat-id rate limiting, not per-IP — see below). |
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
low-average traffic — a textbook fit for serverless. The application
processes themselves hold no state between invocations; the one piece of
durable state (subscriber list + watchlists, see "Persistence" below) lives
in Vercel Postgres, not in the function instance. The one real cost of the
serverless model is cold-start latency, mitigated by:

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
Vercel Cron (vercel.json "crons": 0 2 * * * UTC = 9:00 ICT)
   |
   |  GET /cron/daily-digest
   |  Authorization: Bearer <CRON_SECRET>  (auto-injected by Vercel)
   v
DigestController  -->  SubscribersService.listActive()  -- for each subscriber:
                   -->  CoingeckoService.getPricesBySymbols(subscriber.watchlist)
                   -->  formatDailyDigestReply(...)
                   -->  ZaloService.sendTextMessage(subscriber.chatId, text)
```

- **Why Vercel Cron (switched from GitHub Actions on 2026-09-17)**: GitHub
  Actions' `schedule` trigger runs on shared infrastructure with no timing
  guarantee — it was observed firing ~4h late (13:00 ICT instead of 9:00),
  a known GitHub Actions limitation under load. Vercel Cron is triggered by
  the platform hosting the function itself. **Caveat**: on Vercel's Hobby
  plan, cron jobs are documented as possibly landing within an hour of the
  scheduled time — tighter than the GH Actions incident, but not minute-exact.
  `DigestController.sendDailyDigest` logs the actual-vs-expected drift on
  every run (see "Cron drift tracking" below) so this can be measured
  instead of assumed. `/cron/daily-digest` also still accepts POST with the
  `X-Cron-Secret-Token` header for manual testing (`curl`) — see
  docs/DEPLOYMENT.md.
- **Auth model change**: Vercel Cron only supports GET requests and does not
  let you set custom headers per cron entry. Instead, when a project env var
  named exactly `CRON_SECRET` is set, Vercel auto-attaches
  `Authorization: Bearer <CRON_SECRET>` to its request. `CronSecretGuard`
  accepts either that header or the original `X-Cron-Secret-Token` header —
  set both `CRON_SECRET` and `CRON_SECRET_TOKEN` to the same value on Vercel.
- **Cron drift tracking (temporary)**: `DigestController` logs
  actual-vs-expected (09:00 ICT) invocation drift on every run, and — while
  `DIGEST_CRON_TRACKING` is `true` (the default) — appends a
  `🕐 [cron-tracking] ...` line to the digest message itself, so drift is
  visible directly in the chat over several days. Turn it off by setting
  `DIGEST_CRON_TRACKING=false` once Vercel Cron's timing has been confirmed
  acceptable. See `.aidlc/runs/2026-09-17-cron-digest-drift/` for the
  investigation this was added for.
- **Per-subscriber isolation**: `DigestController` sends to each active
  subscriber sequentially (not `Promise.all`), catching and logging errors
  per subscriber — one subscriber's unknown-symbol typo or a single failed
  Zalo send doesn't block or fail the rest of the run.
- **Auth model differs from `/webhook`**: `/cron/daily-digest` has no Zalo
  signature to verify (nothing came from Zalo), so it uses a separate
  `CronSecretGuard` + `CRON_SECRET_TOKEN` rather than reusing
  `WebhookSecretGuard`.
- **Failure handling**: like the webhook path, `DigestController` always
  returns `200 { ok: true }` — a CoinGecko or Zalo outage is logged
  server-side, not surfaced as an HTTP failure, so the scheduler doesn't
  retry-storm a transient outage.

### Persistence (Vercel Postgres)

The only durable state in the app: the `subscribers` table (`chat_id`,
`watchlist text[]`, `is_active`, `created_at`) backing `/dangky`, `/huy`,
`/watchlist`, and the daily digest recipient list. See
`docs/ROADMAP.md` Initiative 1 for why (multi-tenant SaaS foundation) and
`docs/DEPLOYMENT.md` step 3a for setup.

- **Provider**: Vercel Postgres, which is Vercel's native integration with
  [Neon](https://neon.tech) — provisioned from the Vercel dashboard, and
  `POSTGRES_URL` is auto-populated as a project env var across all
  environments.
- **Driver**: `@neondatabase/serverless`'s HTTP query function (`neon(...)`
  in `SubscribersService`), not a pooled client. Each Vercel Function
  invocation makes at most a handful of queries, so a per-call HTTP request
  avoids managing a connection pool across cold starts — the usual
  serverless-vs-long-lived-connection tradeoff from the table above applies
  to Postgres connections just as much as to in-memory state.
- **Schema migrations**: plain `.sql` files under `db/migrations/`, applied
  in filename order by `npm run db:migrate` (`scripts/db-migrate.js`). No
  migration framework — the schema is small and changes infrequently enough
  that a hand-run script is simpler than adding a dependency.
- **Soft delete**: `/huy` sets `is_active = false` rather than deleting the
  row, so `watchlist` history survives and re-subscribing via `/dangky`
  restores it.

### Price alerts (Upstash Redis + external per-minute scheduler)

`/canhbao btc > 100000` stores an alert. A check every minute sends a Zalo
message when the price crosses the level, then re-arms silently once the
price is back past the level by 0.5%, with at most one message per alert per
15 minutes. Full spec and plan: `docs/epics/EPIC-002/`.

```
cron-job.org (every minute)
   |  GET /cron/price-alerts   X-Cron-Secret-Token: <CRON_SECRET_TOKEN>
   v
PriceAlertsController --> run lock (SET NX EX 120) -- already held? skip run
                      --> PriceAlertsService.listAll()           (SMEMBERS + MGET)
                      --> CoingeckoService.getPricesBySymbols()  (ONE call, all distinct coins)
                      --> evaluateAlert() per alert: fire / rearm / none
                      --> ZaloService.sendTextMessage() true?  -> mark fired (SET XX)
                      --> delivery + run summary logs (LPUSH + LTRIM), release lock
```

- **Why Redis, not the existing Postgres**: Neon's free plan scales compute
  to zero after 5 minutes idle and includes 100 CU-hours/month. A query every
  minute would keep it awake permanently (~180 CU-hours/month at 0.25 CU),
  exhausting the quota and taking `/dangky` and the digest down with it.
  Upstash's free tier (500k commands/month) covers ~6 commands per run ×
  43,200 runs/month (~260k), and Neon still only wakes for subscriber
  commands and the 9am digest.
- **Why cron-job.org, not Vercel Cron**: Vercel Hobby only allows daily cron
  jobs. GitHub Actions `schedule` was rejected for the same reasons the
  digest left it (5-minute minimum, observed firing hours late).
- **Concurrency**: the run lock (a fresh token per run) means two
  overlapping scheduler calls never evaluate the same alert twice. It is
  released with a compare-and-delete Lua script, so a run that outlived the
  TTL can never free the next run's lock. Each alert is its own key and
  state writes use `SET ... XX`, so an alert its chat deleted mid-run is
  never recreated.
- **Delivery**: an alert is only marked fired once Zalo accepted the
  message. A failed send stays armed and is retried on the next runs; only
  after 3 failures in a row does it back off to one attempt per 5 minutes.
  Failures go to a separate capped list — so a chat that blocked the bot
  neither costs a Zalo call every minute forever nor evicts the successful
  deliveries the success metric reads.
- **Run time**: no new send starts once the send phase (after the price
  lookup) is 6s old; the rest stay armed for the next run, so with Zalo's 8s
  send timeout the send phase stays around 14s at most.
- **Budgets to watch**: every run `MGET`s all alerts, so Upstash's 10 GB/month
  bandwidth becomes the ceiling at roughly 1,000 alerts — revisit the data
  layout before then. Vercel Hobby's 4h Active CPU/month (~330 ms CPU per
  run) is the other; `npm run alerts:report` and Vercel → Usage show where
  both stand.

### Error handling philosophy

The bot must **never** go silent and **never** leak a stack trace:

1. `WebhookController` wraps command handling in a try/catch. Known,
   expected failure modes (`UnknownCoinSymbolsError`, `CoingeckoUnavailableError`,
   `InvalidWatchlistError`) get a specific, friendly Vietnamese reply.
   Anything else falls through to a generic "something went wrong" reply,
   with the real error logged server-side only.
2. `AllExceptionsFilter` is the last line of defense for errors thrown
   *before* the controller body runs (e.g. a guard or pipe failure). It
   never returns a stack trace, and for any `/webhook*` path it still
   responds `200 { ok: true }` so Zalo doesn't interpret the failure as a
   delivery error and retry.
3. `ZaloService.sendTextMessage` itself never throws — a Zalo API outage is
   logged and swallowed rather than surfaced as a second failure on top of
   the first.
