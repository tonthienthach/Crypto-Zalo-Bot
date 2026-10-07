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
| `price-alerts/` | `PriceAlertsService` — alert storage in Upstash Redis (`/canhbao`); `PriceAlertsController` — `/cron/price-alerts`, the per-minute check, guarded by `PriceAlertsCronSecretGuard`; `evaluateAlert()` — the pure fire / re-arm / cooldown rules; `PriceAlertsWatchController` — `/cron/price-alerts-watch`, the watcher that tells the owner when the check stops, guarded by `PriceAlertsWatchSecretGuard`; `evaluateMonitor()` / `evaluateWatchdog()` — the pure monitoring rules. See "Price alerts" below. |
| `signals/` | `SignalsService` / `SignalsController` — `/tinhieu` and `/cron/signals`, the 30-minute proactive check, guarded by `SignalsCronSecretGuard`; `evaluateSignal()` — the pure strong-swing and buy/sell/watch rules; `selectCoinsToAlert()` — the pure 1-per-hour and no-repeat rules; `runBacktest()` / `scoreRecords()` — the pure backtest and scorecard; `SignalsHistoryService` / `SignalsStateService` — price history and small state in Upstash Redis; `SignalsSubscriptionsMirror` — keeps a Redis copy of each chat's watchlist; `SignalsMonitorService` — tells the owner when the check stops. See "Signals" below. |
| `portfolio/` | `PortfolioService` — each chat's manually entered trades in Postgres (`portfolio_trades`, `portfolio_usage`) backing `/danhmuc`; `computeHoldings()` / `computePortfolio()` — the pure weighted-average cost and valuation rules; `pricesBySymbol()` — matches one price lookup back to held symbols. See "Portfolio" below. |
| `zalo/` | Talks to the Zalo Bot "send message" API. Never throws — a failed send is logged and swallowed so an outbound Zalo outage can't turn into an unhandled webhook exception. Resolves `true`/`false` so callers that care (the alert check) know whether the send landed. |
| `webhook/` | `WebhookController` — the only place that wires parsing + CoinGecko + Zalo + Subscribers together. Guarded by `WebhookSecretGuard`, DTO-validated by `ZaloWebhookDto`. Always acknowledges 200 to Zalo. |
| `digest/` | `DigestController` — `POST /cron/daily-digest`, a machine-triggered (not user-triggered) endpoint that loads active subscribers from `SubscribersService` and pushes each their own watchlist. Guarded by `CronSecretGuard`. Has no scheduler of its own — see "Daily digest" below for what calls it. |
| `health/` | `GET /health` — liveness endpoint for uptime monitoring and Vercel health checks. |
| `common/filters` | `AllExceptionsFilter` — global catch-all; never leaks a stack trace to the client, and answers webhook paths with 200 for any *unexpected* (non-`HttpException`) error to avoid retry storms. Guard and DTO-validation failures keep their `401`/`400` (see `docs/API.md`). |
| `common/guards` | `WebhookSecretGuard` (shared-secret auth for `/webhook`), `CronSecretGuard` (shared-secret auth for `/cron/daily-digest`), `PriceAlertsCronSecretGuard` (same mechanism, its own `PRICE_ALERTS_CRON_SECRET`, for `/cron/price-alerts` — that secret lives at cron-job.org, so it must not also unlock the digest), and `UserThrottlerGuard` (per-chat-id rate limiting, not per-IP — see below). |
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

### Portfolio (Postgres, EPIC-003)

`/danhmuc` lets a private chat record buy/sell trades and see its holdings,
PnL and 24h change, also as a section of the 9am digest. See
`docs/epics/EPIC-003` for the spec and plan.

- **Why Postgres, not Redis like price alerts**: portfolio data is only read
  or written when a user sends a command, plus one query per day for the
  digest, so Neon's compute quota is not at risk (price alerts left Postgres
  because of a *per-minute* query). In exchange, Postgres gives exact
  `NUMERIC` amounts, `CHECK` constraints and real transactions, which the
  no-oversell and limit rules need.
- **One round-trip per command**: every write is one `sql.transaction([...])`
  over the Neon HTTP driver. Its first statement is
  `pg_advisory_xact_lock(hashtext(chat_id))`, so two commands of the same
  chat run one after the other and different chats never wait on each other.
  The rules (no sell above the holding; 200 trades; 20 held coins; no delete
  that turns a later sell into an oversell, via a running `SUM() OVER`) sit
  in the `WHERE`/`HAVING` of the same statement that writes. A broken rule
  writes nothing; a failed statement rolls the whole command back.
- **Numbers are computed, never stored**: `computeHoldings()` replays the
  trades in `seq` order (weighted-average cost, quantities as exact `bigint`
  10^-8 units), and `computePortfolio()` values them. Same functions for
  `/danhmuc`, the digest and write confirmations.
- **Digest**: the trades of every active subscriber load in one query; each
  subscriber still gets one price lookup, for watchlist ∪ held coins. The
  portfolio part has its own `try/catch` — a failure costs only that part.
  Symbols sharing a CoinGecko id (`matic`/`pol`) are matched through the id,
  as in the alert check.
- **Privacy**: only `chat_type: PRIVATE` chats get through (a missing
  `chat_type` counts as a group). Logs carry chat ids, counts and durations,
  never amounts; database errors are logged by name and SQLSTATE only.
  `portfolio_usage` counts views/writes per chat per day for the success
  metric (`npm run portfolio:report`).

### Price alerts (Upstash Redis + external per-minute scheduler)

`/canhbao btc > 100000` stores an alert. A check every minute sends a Zalo
message when the price crosses the level, then re-arms silently once the
price is back past the level by 0.5%, with at most one message per alert per
15 minutes. Full spec and plan: `docs/epics/EPIC-002/`.

```
cron-job.org (every minute)
   |  GET /cron/price-alerts   X-Cron-Secret-Token: <PRICE_ALERTS_CRON_SECRET>
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

#### Monitoring the check (EPIC-002-FIX)

The check is triggered from outside, so when nobody calls it no code runs at
all — a missing run can't report itself. After the check silently didn't
run for ~32h right after launch (`docs/epics/EPIC-002/artifacts/incident.md`),
an independent watcher was added:

```
cron-job.org (every minute) --> /cron/price-alerts        logs every call: healthy | no-price | failed | skipped
                                (guard)                    rejected calls: counted, <= 1 write/min (HINCRBY, EVAL)
                                every 5th minute:          reads the watcher's heartbeat; silent 30 min -> owner
Upstash QStash (every 5 min) --> /cron/price-alerts-watch  reads monitor state + last 30 runs (GET + LRANGE)
                                evaluateMonitor()          15 min without a healthy run -> Zalo to OWNER_CHAT_ID
                                                           then <= 1 message / 6h, one "recovered" message
```

- **Healthy run**: authenticated, got the lock, no unhandled error, and —
  when alerts exist — priced at least one of them. A run whose price lookup
  failed is logged `no-price` and doesn't count.
- **Independent schedulers**: the watcher runs on Upstash QStash, not
  cron-job.org, so a broken cron-job.org job or account is caught too. Each
  side watches the other (the check looks at the watcher's heartbeat every
  5 minutes). If both stop at once nobody can tell — accepted at this scale.
  Fallback if QStash is ever unusable: a Cloudflare Workers cron trigger
  calling the same endpoint (docs/DEPLOYMENT.md §8b); no code change.
- **Delivery is the source of truth**: an outage is only marked "notified"
  once Zalo accepted the message. Each message kind (state-unreadable /
  down / reminder / recovered) holds its own repeat-suppression key **in
  Redis**, not instance memory, so it survives cold starts and is shared
  across instances: a Redis read failure held back only the
  "state-unreadable" notice, never delaying the real "down" one behind it
  (spec `EPIC-002-FIX-NFR05`). Trade-off accepted: this can add up to one
  message per hour per kind, more than the "≤ 1 message/hour" NFR05
  originally read as a single combined cap — see spec §5 note
  2026-09-29.
- **Budget**: ~26k Upstash commands/month for the watcher (3 per run ×
  8,640), ~8.6k for the check's watchdog read, and at most 43.2k for
  rejected-call counting under constant abuse — ~295k/month in total
  normally, ~339k worst case, under the 400k target (80% of the free 500k).
  These are estimates from the per-run command count, not dashboard figures:
  check Upstash → Usage after deploy. Postgres is never touched.

### Signals (Upstash Redis + external 30-minute scheduler)

`/tinhieu` says which watchlist coins are swinging strongly (≥ 8% in 24h or ≥ 15% in 72h) and, only then, gives a rule-based buy / sell / watch note from the coin's position in its 7-day range (bottom 25% → buy, top 25% → sell, otherwise watch), always with a not-investment-advice disclaimer. The same rules feed three places: the command, a "Tín hiệu" section in the 9am digest, and a proactive message from `/cron/signals` (at most one per chat per hour; the same coin and direction not repeated within 24h unless the move grew by 5 points). Full spec and plan: `docs/epics/EPIC-004/`.

```
cron-job.org (every 30 min)
   |  GET /cron/signals   X-Cron-Secret-Token: <SIGNALS_CRON_SECRET>
   v
SignalsController --> run lock (SET NX EX 120)
                  --> Redis: watchlist mirror, tracked extras, off-set, per-chat sent state  (4 reads)
                  --> CoingeckoService.getPricesBySymbols()   (ONE call, every watched coin)
                  --> SignalsHistoryService: snapshot (1 EVAL), backfill new coins, load 8d hourly (1 EVAL)
                  --> evaluateSignal() per coin; selectCoinsToAlert() per chat
                  --> ZaloService.sendTextMessage() true? -> sent state + verdict records
```

- **Why Redis, not Postgres**: same reason as price alerts — a run every 30 minutes would keep the Neon compute awake. The watchlists live in Postgres (`subscribers`), so a Redis **mirror** (hash chatId → symbols) is updated by `/dangky`, `/watchlist` and `/huy`, and re-synced in full by every 9am digest run, which already reads the subscribers. A missed update is therefore wrong for at most a day. The check itself never queries Postgres.
- **History**: per coin, hourly points for 8 days and the last point of each day for 90 days (sorted sets; the Lua scripts replace the same hour/day so a double run is idempotent). A coin seen for the first time is back-filled once from CoinGecko `/coins/{id}/market_chart?days=90` (hourly points, verified keyless, ~223 KB per coin; at most 5 coins per run, a failed coin is held for 2h). CoinPaprika's free tier has no history, so a coin only CoinPaprika knows accumulates from its first run and shows "chưa đủ dữ liệu" for 7 days.
- **Scorecard computed on read**: each verdict that was really sent is stored once per chat, coin, verdict and day. `/tinhieu thongke` and `npm run signals:report` score them against stored prices when asked — right if the first price at or after +72h is higher (buy) / lower (sell). No scoring cron. Coins asked about outside any watchlist are tracked for 4 days (max 50) so their verdicts can be scored too.
- **Backtest**: `/tinhieu backtest <coin>` replays the rules over daily closes, a daily approximation of the hourly rules; consecutive days with the same verdict count once. It uses stored history when long enough, otherwise one unstored CoinGecko call, so a backtest of an arbitrary coin never grows what we keep.
- **Delivery**: state and verdict records are written only after Zalo accepted the message; a failed send leaves the chat eligible on the next run, and one chat's failure never blocks another.
- **Monitoring**: each run logs a `signals-run` line (counts only, never verdicts) and stamps `signals:last-healthy`. The existing QStash watcher tick (`/cron/price-alerts-watch`, every 5 min) also calls `SignalsMonitorService`: no healthy run for 90 minutes → one message to `OWNER_CHAT_ID`, a reminder every 6h, one recovery message. It has its own Redis state and does not touch the price-alert monitoring rules. Never-healthy (job not scheduled yet) is not an outage.
- **Budget**: about 14 Redis commands per run (~20k/month at 48 runs/day) and 1 per watcher tick for the signals look (~9k/month), plus commands from users and the digest — roughly +30k/month on top of the ~295k–339k of price alerts, still under the 400k target. These are counts from the code, not dashboard figures: read Upstash → Usage after deploy. Postgres is not touched by the check.

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
