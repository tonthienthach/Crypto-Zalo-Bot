# Deployment (Vercel)

## 1. Install the Vercel CLI

```bash
npm install -g vercel
vercel login
```

## 2. Link the project

From the project root:

```bash
vercel link
```

Follow the prompts to create/select a Vercel project.

## 3. Set environment variables on Vercel

Every variable in `.env.example` must be set for **Production** (and
**Preview**/**Development** if you use those environments too). Either via
the dashboard (Project → Settings → Environment Variables) or the CLI:

```bash
vercel env add ZALO_BOT_TOKEN production
vercel env add ZALO_API_BASE_URL production
vercel env add WEBHOOK_SECRET_TOKEN production
vercel env add COINGECKO_API_BASE_URL production
vercel env add COINGECKO_API_KEY production      # optional, can be empty
vercel env add COINGECKO_CACHE_TTL_SECONDS production
vercel env add USD_TO_VND_RATE production
vercel env add THROTTLE_TTL_SECONDS production
vercel env add THROTTLE_LIMIT production
vercel env add LOG_LEVEL production
vercel env add NODE_ENV production
vercel env add CRON_SECRET_TOKEN production
vercel env add CRON_SECRET production           # SAME value as CRON_SECRET_TOKEN — see step 8
vercel env add DIGEST_CRON_TRACKING production  # optional, defaults to "true" — see step 8
```

Signals (EPIC-004) add one secret for the job and three optional
thresholds — set them before step 8c:

```bash
vercel env add SIGNALS_CRON_SECRET production    # mark it Sensitive; its OWN secret (>= 16 chars), different from CRON_SECRET_TOKEN and PRICE_ALERTS_*
vercel env add SIGNAL_SWING_24H_PCT production   # optional, default 8
vercel env add SIGNAL_SWING_72H_PCT production   # optional, default 15
vercel env add SIGNAL_BAND_PCT production        # optional, default 25
```

`POSTGRES_URL` (step 3a below) and `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS`
(legacy, one-off migration only — see step 3a) are set separately.

## 3a. Attach Vercel Postgres and run migrations

Digest subscribers (`/dangky`, `/huy`, `/watchlist`) are stored in Postgres
— see `docs/ROADMAP.md` Initiative 1 and `src/subscribers`.

1. Dashboard → Project → Storage → **Create Database** → Postgres (this
   provisions via the Neon integration; Vercel auto-sets `POSTGRES_URL` as a
   project env var for all environments).
2. Pull it into your local `.env` for running migrations from your machine:
   ```bash
   vercel env pull .env
   ```
3. Create the `subscribers` table:
   ```bash
   npm run db:migrate
   ```
4. **One-time only**, if you're upgrading from the pre-multi-tenant
   single-recipient digest: seed the existing `DIGEST_CHAT_ID`/
   `DIGEST_COIN_SYMBOLS` values (still in your `.env` from before) as the
   first subscriber row, so that recipient doesn't lose their digest:
   ```bash
   npm run db:seed-digest-subscriber
   ```

`vercel env add <name> production` prompts you to paste the value.

### Portfolio tables (EPIC-003) — migrate **before** deploying the code

`db/migrations/0002_create_portfolio.sql` adds `portfolio_trades` and
`portfolio_usage`. It only adds tables (`IF NOT EXISTS`), so it is safe to
run against production before the new code ships, and the old code keeps
working with it. Run `npm run db:migrate` with the production
`POSTGRES_URL` (if `vercel env pull` writes `[SENSITIVE]` for it, copy the
connection string from the Neon/Vercel Storage dashboard into a shell
variable instead), then deploy (step 4).

- Check it: `npm run portfolio:report` prints `Chats that used /danhmuc: 0`.
- Code rollback (`vercel rollback`, step 7) needs no schema change: the
  previous build never reads the new tables.
- Removing the feature for good (**deletes every trade users recorded** —
  owner decision only): `DROP TABLE IF EXISTS portfolio_usage` and
  `DROP TABLE IF EXISTS portfolio_trades`.

After deploying, smoke-test from a real **private** chat with the bot:
`/danhmuc mua btc 0.001 1`, `/danhmuc`, `/danhmuc lichsu`, then
`/danhmuc xoahet` + `/danhmuc xoahet xacnhan`. If the private chat is
refused, the Vercel log line `Portfolio command refused outside a private
chat: ... chat_type=...` shows what Zalo actually sent.

## 3b. Attach Upstash Redis (price alerts)

Price alerts (`/canhbao`) are stored in Upstash Redis, **not** Postgres — see
`docs/ARCHITECTURE.md` → "Price alerts" for why (a per-minute check would
keep Neon's compute awake and exhaust its free quota).

1. Dashboard → Project → Storage → **Create Database** → **Upstash for
   Redis** (Marketplace) → Free plan. Pick the region closest to your
   functions (default functions region is `iad1` → `us-east-1`).
2. Connect it to the project for at least **Production and Preview** —
   Vercel then sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (the exact
   names `env.validation.ts` requires). **Do this before deploying any
   build that contains price alerts**: without them the app fails config
   validation at boot, which takes the *whole* bot down (`/gia`, `/dangky`,
   the 9am digest), not just alerts. (This project is not connected to Git
   on Vercel — merging a PR doesn't deploy; `vercel deploy --prod` does.)
3. Generate a **separate** secret for the price-alert scheduler and add it
   as `PRICE_ALERTS_CRON_SECRET` (16–256 chars) for Production:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   vercel env add PRICE_ALERTS_CRON_SECRET production
   ```
   It's deliberately *not* `CRON_SECRET_TOKEN`: this one has to be stored at
   cron-job.org (a third party), and a leak should at most trigger extra
   (lock-protected) alert checks, never re-send the digest. If it is unset,
   `/cron/price-alerts` answers `401` to everything — the rest of the bot
   still boots.
4. No migration: Redis keys are created on first use.

## 4. Deploy

Preview deployment (safe, generates a unique preview URL, does not affect
production):

```bash
vercel
```

Production deployment:

```bash
vercel --prod
```

Vercel builds `api/index.ts` (see `vercel.json`) as a Node serverless
function; it does **not** need `dist/` from `nest build` — the function
bundler compiles TypeScript from source directly. `npm run vercel-build`
(`nest build`) still runs as a sanity check but its output isn't what's
deployed to the function.

## 5. Point the Zalo webhook at your production domain

After the first production deploy, Vercel gives you a domain like
`https://zalo-crypto-bot.vercel.app` (or your configured custom domain).
Register it via the Bot API's `setWebhook` call — the same helper script
used locally works here too, just point it at your production domain:

```bash
npm run webhook:register -- https://zalo-crypto-bot.vercel.app/webhook
```

(Requires `ZALO_BOT_TOKEN` and `WEBHOOK_SECRET_TOKEN` in your local `.env`
to match exactly what you set on Vercel in step 3 — the script calls the
Zalo API directly, it doesn't touch Vercel.) Confirm the response includes
`"outcome": "webhook.ok"`.

## 6. Verify

```bash
curl https://zalo-crypto-bot.vercel.app/health
```

Then message the bot from Zalo with `/gia btc` and confirm a reply arrives.

## 7. Rollback

If a deployment misbehaves:

```bash
vercel ls                 # list recent deployments
vercel rollback <url>     # promote a previous deployment back to production
```

Or from the dashboard: Deployments tab → find the last-known-good
deployment → "Promote to Production".

## 8. Enable the daily digest cron

The 9am BTC/ETH/YGG digest is triggered by **Vercel Cron** (`vercel.json` →
`crons`, `0 2 * * *` = 02:00 UTC = 09:00 ICT) — see `docs/ARCHITECTURE.md`
("Daily digest") for the full flow and why this replaced an earlier GitHub
Actions workflow (it was firing hours late).

Vercel Cron sends a `GET` request with no custom headers, but auto-attaches
`Authorization: Bearer <value>` when a project env var literally named
`CRON_SECRET` is set. Set it to the **same value** as `CRON_SECRET_TOKEN`
(step 3) so `CronSecretGuard` accepts it:

```bash
vercel env add CRON_SECRET production   # paste the same value as CRON_SECRET_TOKEN
```

Crons only run on deployed (production) instances, not preview/local — after
your next `vercel --prod` deploy, verify without waiting for 9am by calling
the endpoint manually with the legacy header (still supported for testing):

```bash
curl -X POST "https://zalo-crypto-bot.vercel.app/cron/daily-digest" \
  -H "X-Cron-Secret-Token: <CRON_SECRET_TOKEN value>"
```

Confirm the digest message arrives for each active subscriber in the
`subscribers` table (message the bot with `/dangky` first if the table is
still empty).

While `DIGEST_CRON_TRACKING` is unset/`true` (the default), the message will
include a trailing `🕐 [cron-tracking] ...` line showing the actual ICT
arrival time and drift from 09:00 — watch this over the next few days to
confirm Vercel Cron's timing is acceptable, then set
`DIGEST_CRON_TRACKING=false` and redeploy to remove it. See
`.aidlc/runs/2026-09-17-cron-digest-drift/` for the tracking plan.

## 8a. Enable the price-alert check (cron-job.org)

The alert check (`/cron/price-alerts`) must run **every minute**, which
Vercel Cron can't do on the Hobby plan (daily only). It is triggered by
[cron-job.org](https://cron-job.org) instead (free, per-minute, custom
headers):

1. Deploy first (step 4) — before that the endpoint returns `404`, and a
   per-minute job hitting a 404 still costs a function invocation each time.
2. Create a cron job: URL `https://zalo-crypto-bot.vercel.app/cron/price-alerts`,
   method **GET**, schedule **every minute**, header
   `X-Cron-Secret-Token: <PRICE_ALERTS_CRON_SECRET value>` (step 3b — **not**
   the digest's `CRON_SECRET_TOKEN`, which this endpoint rejects).
3. Check one manual run:
   ```bash
   curl "https://zalo-crypto-bot.vercel.app/cron/price-alerts" \
     -H "X-Cron-Secret-Token: <PRICE_ALERTS_CRON_SECRET value>"
   # -> {"ok":true}; a missing/wrong secret -> 401
   ```
4. **Within 5 minutes of enabling (or changing) the job, confirm it works** —
   don't wait 24h to find out (the EPIC-002 launch lost ~32h to a wrong URL).
   The report needs the production Upstash REST URL and a token. They are
   **Sensitive** on Vercel, so `vercel env pull` can't fetch them (it writes
   `[SENSITIVE]`). Instead, open **Upstash Console → your database → REST
   API**, and copy `UPSTASH_REDIS_REST_URL` and the **read-only** token (the
   report only reads) into a throwaway `.env.alerts` (gitignored; the script
   reads it before `.env`):
   ```bash
   # .env.alerts
   KV_REST_API_URL="https://<your-db>.upstash.io"
   KV_REST_API_TOKEN="<read-only token>"
   ```
   ```bash
   npm run alerts:report
   ```
   Wait 5 minutes and run it again: the **"Last 5 min" line must show
   `healthy` 3 or more**, and "Last healthy run" must be under 2 minutes old.
   (Don't compare "By outcome" totals between runs: the run log keeps the
   last 1,440 runs, so once it is full that total stops growing even when the
   job works.) If not, the same "Last 5 min" line and the "Outages" lines say
   what was seen: nothing at all / `not called` (job off or wrong URL),
   `rejected` (wrong secret), `no-price` (price source down), `failed` (see
   Vercel logs for `Price-alert check failed`).
5. After 24h, run the report again: the gap between healthy runs (p95 must be
   ≤ 90s), healthy run duration, the outages, and deliveries per chat (the
   success metric in `docs/epics/EPIC-002/artifacts/intent.md`). Delete
   `.env.alerts` when done.
6. Watch **Vercel → Usage** (Active CPU, Provisioned Memory — Hobby includes
   4h CPU/month) and the Upstash dashboard (commands/month, free tier 500k)
   for 48h, then multiply out to a month. This is the least certain part of
   the design (see `docs/epics/EPIC-002/artifacts/plan.md` §4 and
   `docs/epics/EPIC-002-FIX/artifacts/plan.md` §4 — target ≤ 400k/month).

Then set up the watcher (step 8b), so a stopped check is reported instead
of found by accident.

**To stop alerts:** disable the cron-job.org job. With the watcher set up,
you will then get a "check stopped" message after 15 minutes and a reminder
every 6 hours — to silence it completely, also pause the QStash schedule
(step 8b).

> **CoinGecko quota:** the check makes up to one CoinGecko call per minute
> (~43k/month) whenever alerts exist. Production currently has no
> `COINGECKO_API_KEY`, i.e. the keyless public API (per-minute limit only).
> If you ever add a CoinGecko **Demo** key, check its monthly call cap first
> — it can be lower than the check's usage, and `/gia` shares the same
> quota.

## 8b. Enable the price-alert watcher (Upstash QStash)

The watcher (`/cron/price-alerts-watch`) tells you on Zalo when the check
of step 8a has had no healthy run for 15 minutes, reminds you every 6 hours
while it lasts, and tells you when it is back. It runs on a **different**
scheduler than the check — if it ran on cron-job.org too, a broken
cron-job.org account would silence both. The check in turn tells you if the
watcher has been silent for 30 minutes.

Order matters: env first, then deploy, then the schedule.

1. Add two Production env vars on Vercel (both optional — without them the
   bot still boots; the endpoint answers `401` / nothing can be sent):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   vercel env add PRICE_ALERTS_WATCH_SECRET production   # mark it Sensitive
   vercel env add OWNER_CHAT_ID production               # your own Zalo chat id
   ```
   `PRICE_ALERTS_WATCH_SECRET` is a **third** secret, different from
   `CRON_SECRET_TOKEN` and `PRICE_ALERTS_CRON_SECRET` (it lives at QStash).
   `OWNER_CHAT_ID` is the chat that gets monitoring messages; if you are the
   original digest recipient, it is the value `DIGEST_CHAT_ID` used to hold.
2. Deploy (`vercel deploy --prod`, step 4).
3. Check the endpoint by hand:
   ```bash
   curl "https://zalo-crypto-bot.vercel.app/cron/price-alerts-watch"      -H "X-Cron-Secret-Token: <PRICE_ALERTS_WATCH_SECRET value>"
   # -> {"ok":true}; no secret, or either of the other two secrets -> 401
   ```
4. **Only now** create the schedule, so QStash never calls a 404: Upstash
   Console → **QStash → Schedules → Create**
   - Destination: `https://zalo-crypto-bot.vercel.app/cron/price-alerts-watch`
   - Method: `GET`, cron: `*/5 * * * *`
   - Header: `Upstash-Forward-X-Cron-Secret-Token: <PRICE_ALERTS_WATCH_SECRET value>`
     (QStash forwards `Upstash-Forward-*` headers without the prefix)

   Free tier: 1,000 messages/day and 10 schedules; this uses 288/day.
5. Within 5 minutes, `npm run alerts:report` (step 8a.4) must show
   "Watcher last ran" under 5 minutes old and "Owner chat: configured".
6. Test the alarm once for real: disable the cron-job.org job for ~20
   minutes — you must get a "Ngừng canh giá" message within 20 minutes —
   then re-enable it: a "Canh giá đã chạy lại" message must follow within 5
   minutes.
7. After 24h of normal operation you should have received **no** monitoring
   message; check Upstash → Usage (commands/month) and Vercel → Usage (Active
   CPU) again.

**Fallback scheduler:** if QStash is ever unusable, a Cloudflare Workers
cron trigger (free: 5 triggers, 100k requests/day) calling the same URL with
the same `X-Cron-Secret-Token` header works without any code change.

**Rollback:** pause the QStash schedule, then `vercel rollback` (step 7).
The previous build ignores the new Redis keys and the `outcome` field.

## 8c. Enable the signals check (cron-job.org)

`/cron/signals` (EPIC-004) sends proactive signal messages and keeps the price
history. It must run **every 30 minutes**, from a **second** cron-job.org job
(same account as step 8a). It needs `KV_REST_API_*` (step 3b) and
`SIGNALS_CRON_SECRET` (step 3); `OWNER_CHAT_ID` (step 8b) makes the owner
hear when it stops. **No Postgres migration**: everything lives in Redis.

1. Deploy first (step 4). Then **call it once by hand before scheduling it**,
   so the first run (history back-fill for every watched coin) can be read:
   ```bash
   curl "https://zalo-crypto-bot.vercel.app/cron/signals" \
     -H "X-Cron-Secret-Token: <SIGNALS_CRON_SECRET value>"
   # -> {"ok":true}; a missing/wrong secret -> 401
   ```
   Vercel logs show one `signals-run` line: `outcome` must be `healthy`.
   Chats with a strong swing may get a message at this point.
2. Before telling users: run `/tinhieu backtest btc` (and eth, sol) in your
   own chat and read the hit rates — the verdict rules are a simple reversal
   heuristic and may be wrong often. The proactive messages are **on by
   default** for every subscribed chat; `/tinhieu tat` turns them off per chat.
3. Create the cron job: URL `https://zalo-crypto-bot.vercel.app/cron/signals`,
   method **GET**, schedule **every 30 minutes**, header
   `X-Cron-Secret-Token: <SIGNALS_CRON_SECRET value>`.
4. After an hour, `npm run signals:report` (same `.env.alerts` as step 8a.4,
   plus optionally `OWNER_CHAT_ID` to leave yourself out) shows the latest runs
   and the success metric. Expect two healthy runs per hour.
5. Read the Upstash dashboard after 48h: this adds about 30k commands/month
   (see `docs/ARCHITECTURE.md` "Signals"); the target is to stay under 400k in
   total. If it does not fit, make the job hourly: the 90-minute outage rule
   then needs raising too (`SIGNALS_STALE_MS`).
6. **Success metric** (`docs/epics/EPIC-004/artifacts/intent.md`): within 30
   days, at least one chat other than yours uses `/tinhieu` on two different
   days. `npm run signals:report` prints it.

**To stop signals:** disable the cron-job.org job (proactive messages stop;
`/tinhieu` and the digest section still work). Data in Redis expires on its
own (hourly history 8 days, daily 90 days), nothing to clean. With the watcher
set up you will get a "check stopped" message after 90 minutes and a reminder
every 6 hours; pause the QStash schedule too to silence it.

## 9. Ongoing deploys

Once the GitHub repo is connected to the Vercel project (Vercel dashboard →
Project → Git), every push to `main` triggers a production deployment and
every PR gets its own preview deployment automatically — no manual `vercel
--prod` needed after initial setup. Combine with the CI workflow in
`.github/workflows/ci.yml`, which independently runs lint/test/build on every
PR so a broken change fails CI before (or alongside) the Vercel preview
build.
