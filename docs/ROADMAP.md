# Roadmap

Living plan for where this project is going, beyond what `CHANGELOG.md`
tracks (which records shipped changes). This file tracks **initiatives**:
why they matter, their current status, and open decisions — update it as
work progresses or new direction is decided, rather than starting a new doc.

Status legend: `Idea` (not committed) · `Planned` (scoped, not started) ·
`In progress` · `Shipped` · `Dropped` (with reason).

## Current state (2026-09-29)

**Merged to `master`, not yet deployed:** Initiative 2's `EPIC-002-FIX`
(price-alert watcher) and Initiative 3's `EPIC-003` (portfolio tracking) —
see their sections below for what's still needed before/after
`vercel deploy --prod`.

## Current state (2026-09-22)

Bot on Vercel serverless, now with a Postgres-backed subscriber list
(Initiative 1, deployed):
- Interactive commands (`/gia`, `/top`, `/help`) work per any Zalo chat that
  messages the bot — no persistence needed, stateless per request.
- `/dangky [symbols...]`, `/huy`, `/watchlist [symbols...]` let any chat
  subscribe/unsubscribe/edit its own daily digest watchlist, persisted in
  the `subscribers` table (Vercel Postgres / Neon — see
  `docs/ARCHITECTURE.md` "Persistence").
- Daily digest (`/cron/daily-digest`, Vercel Cron 9am ICT) reads active
  subscribers from the DB and sends each their own watchlist — the old
  hardcoded `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` env vars are no longer
  read at runtime (kept only for the one-off
  `npm run db:seed-digest-subscriber` migration).
- **Deployed 2026-09-22**: Vercel Postgres (Neon) attached, migration +
  legacy-recipient seed run against production, code deployed
  (`https://zalo-crypto-bot.vercel.app`, `/health` confirmed `ok`). First
  real 9am ICT digest send under the new per-subscriber path not yet
  observed — see Initiative 1's `Not yet confirmed` note.

## Initiative 1: Multi-tenant subscriptions (SaaS foundation)

**Status:** Shipped (2026-09-22) — Vercel Postgres (Neon) attached,
`db:migrate` + `db:seed-digest-subscriber` run against production,
current `master` deployed (`https://zalo-crypto-bot.vercel.app`, `/health`
returns `ok`). **Not yet confirmed:** the first real 9am ICT digest send
under the new per-subscriber path (next occurrence after 2026-09-22), and
`intent.md`'s success metric (≥1 non-original subscriber active within 30
days of this date) — revisit both once observed.

**Tracked as:** [`EPIC-001`](../docs/epics/EPIC-001/EPIC-001.md) — full
paper trail (intent, spec, plan, implementation, independent verify, policy
review) in `docs/epics/EPIC-001/artifacts/`. `verify.md`: **pass (10/10)**
after two revisions — closed via new unit tests
(`subscribers.service.spec.ts`, `digest.controller.spec.ts`) and a scratch
Docker Postgres run proving the upsert/seed SQL for real. `review.md`:
hold-retroactively / ship-at-`HEAD` — the one blocker (a commit that
briefly broke the e2e suite) was fixed one commit later; 2 should-fix
items remain open by owner decision (branching policy — since resolved,
see docs/RULES.md; `chat.id` max length — fixed in EPIC-002, capped at 64
chars). The branching-policy and `.aidlc`-tracking follow-ups from
`review.md` are done (PR #1); the migration-script multi-statement bug
(scope item 7 below) was found and fixed via PR #2 during actual
deployment.

**Why:** The daily digest is the only feature that can't scale past one
person today. Turning it into a real subscriber list is the prerequisite
for any monetization (tiers, alerts, portfolio tracking) — those all need
a way to know *who* the users are and *what* they each want.

**Scope:**
1. ✅ Add lightweight persistence: **Vercel Postgres** (decided 2026-09-21 —
   native Vercel integration, no extra account/billing setup, simplest fit
   for a serverless app already on Vercel Cron).
2. ✅ Schema: subscriber `chat_id`, `watchlist` (coin symbols), `is_active`,
   `created_at` (`db/migrations/0001_create_subscribers.sql`).
3. ✅ New commands: `/dangky [btc eth ...]` (subscribe + set watchlist),
   `/huy` (unsubscribe), `/watchlist` (view/edit current list).
4. ✅ `DigestController` reads active subscribers from DB instead of
   `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` env vars, sends each their own
   watchlist.
5. ✅ Migration tooling: `npm run db:seed-digest-subscriber` seeds the
   existing `DIGEST_CHAT_ID` value as the first subscriber row so the
   current recipient doesn't lose their digest on deploy.
6. ✅ Attached the Postgres integration on the live Vercel project, ran
   `npm run db:migrate` + `npm run db:seed-digest-subscriber` against
   production, deployed (2026-09-22). ⬜ Not yet confirmed: the next 9am
   ICT digest actually arriving correctly under the new per-subscriber
   path — check after the next occurrence.
7. Along the way, a second real bug was found and fixed only once real
   deployment was attempted: `db-migrate.js` called Neon's HTTP driver
   with a whole multi-statement `.sql` file in one `sql.query()` call,
   which Neon rejects ("cannot insert multiple commands into a prepared
   statement") — `psql`-based scratch-DB testing during `verify.md` missed
   this because `psql -f` handles multi-statement files fine, unlike the
   driver actually used in production. Fixed in
   `fix/migrate-script-multi-statement` (PR #2) by splitting each file
   into individual statements before executing.

**Open questions:**
- Do `/dangky` writes need their own rate limit / abuse guard beyond the
  existing `UserThrottlerGuard`?

## Initiative 2: Price alerts (threshold notifications)

**Status:** Shipped (deployed 2026-09-23, PR #3). **AC18 passed in production
(2026-09-26):** after the owner fixed a wrong cron-job.org URL (the first
~32h after deploy ran only 2 checks — see
`docs/epics/EPIC-002/artifacts/incident.md`), the 24h window
2026-09-24T15:25Z → 09-25T15:25Z ran ~1/min with p95 gap ~81s (≤ 90s),
run duration p95 0.84s; verify.md now **pass 19/19**. The silent-stoppage
gap is fixed by follow-up epic
[`EPIC-002-FIX`](../docs/epics/EPIC-002-FIX/EPIC-002-FIX.md) — merged to
`master` 2026-09-29 (verify rev 2: 15 pass, 0 fail, 5 untested deferred to
post-deploy; review: ship, all should-fix closed). Adds an independent
watcher (Upstash QStash, every 5 min) that tells the owner within ~20 min
if the per-minute check itself stops, and corrects `DEPLOYMENT.md` §8a:
Sensitive `KV_REST_API_*` must be copied from the Upstash Console.
**Not yet deployed to production** — owner still needs to add
`PRICE_ALERTS_WATCH_SECRET` / `OWNER_CHAT_ID` on Vercel, run
`vercel deploy --prod`, and create the QStash schedule (`DEPLOYMENT.md`
§8b). **Still not confirmed:** the Vercel Hobby CPU budget, the real
Upstash command budget (NFR04), and the intent success metric (≥1
non-owner alert delivered within 30 days). Decided 2026-09-23:
alerts stored in **Upstash Redis** (not Postgres — a per-minute check would
exhaust Neon's free compute quota), checked every minute by **cron-job.org**
(Vercel Hobby cron is daily-only); latency target ~1–2 min; alerts re-arm
(0.5% buffer, 15-min cooldown); max 10 per chat.
**Tracked as:** [`EPIC-002`](../docs/epics/EPIC-002/EPIC-002.md).
**Why:** Highest-retention feature for crypto users — depends on
Initiative 1's persistence layer existing first.
**Scope (sketch):** `/canhbao btc > 100000` command; a periodic cron
checks stored thresholds against current prices and pushes on breach.

## Initiative 3: Portfolio tracking

**Status:** Merged to `master` 2026-09-29, **not yet deployed**. Verify rev 2:
18 pass, 0 fail, 3 untested (AC17 p95 latency, AC19 real Neon-driver
concurrency, AC20 owner reconciliation with an exchange app — all deferred
to post-deploy). Review: ship with follow-up (branch order — resolved by
merging after `EPIC-002-FIX`). `/danhmuc mua|ban <coin> <qty> <price>`
records a trade (Postgres, weighted-average cost); `/danhmuc`,
`/danhmuc lichsu`, `/danhmuc xoa`; a portfolio section in the 9am digest.
A redelivered Zalo message never double-records a trade (dedup on
`message_id`); a quantity may not contain a comma (avoids a 1000x
decimal-comma slip), while a price still can (`60,000`).
**Tracked as:** [`EPIC-003`](../docs/epics/EPIC-003/EPIC-003.md) — originator
is the owner's own need (holds <20 coins across 2–3 exchanges/wallets,
checks each app by hand, no PnL view). Success metric: ≥1 non-owner chat
records a portfolio within 30 days. Out of scope: paid tiers, non-Zalo
channels. Manual entry only (no exchange/wallet sync) for this epic.
**Deploy still needed:** `npm run db:migrate` on production (adds
`portfolio_trades` / `portfolio_usage`, safe to re-run), then
`vercel deploy --prod`. No new env vars.
**Why:** Turns a lookup tool into a daily habit (PnL in the digest).
**Depends on:** Initiative 1 (per-user storage).

## Initiative 4: Simple signals (volatility / basic indicators)

**Status:** In implementation on `feature/epic-004-simple-signals` (not merged,
not deployed). `/tinhieu` shows which watchlist coins swing strongly (≥ 8% in
24h or ≥ 15% in 72h) with a rule-based buy / sell / watch note from the 7-day
range and a disclaimer; a "Tín hiệu" section in the 9am digest; a proactive
message from `/cron/signals` (every 30 min, ≤ 1 per chat per hour, default on,
`/tinhieu tat` to stop); `/tinhieu backtest <coin>` and `/tinhieu thongke`
(scorecard of the verdicts actually sent).
**Tracked as:** [`EPIC-004`](../docs/epics/EPIC-004/EPIC-004.md) — the owner's own
need (the bot only shows price, not trend). Success metric: ≥ 1 non-owner chat
uses `/tinhieu` on two different days within 30 days (`npm run signals:report`).
Out of scope: paid tiers, non-Zalo channels, coins outside the watchlist for
proactive messages, RSI/MACD, personal thresholds.
**Decided:** all data in Upstash Redis (not Postgres) to keep Neon asleep; price
history back-filled once per coin from CoinGecko `market_chart` (verified).
**Deploy still needed (after merge):** set `SIGNALS_CRON_SECRET`, deploy, call
`/cron/signals` once by hand, read `/tinhieu backtest btc`, then add the
cron-job.org job (`docs/DEPLOYMENT.md` step 8c). No Postgres migration.
**Why:** Differentiates from a "just a price lookup" bot.

## Initiative 5: Multi-channel (Telegram, Messenger)

**Status:** Idea
**Why:** `command-parser` and `format-message.util` are already
channel-agnostic (pure functions, no Zalo-specific types) — adding a
channel is mostly a new "send" adapter next to `zalo/`, expanding the
addressable market.

## Monetization (later phase, not started)

Free tier (limited coins, no alerts) vs. paid tier (unlimited watchlist +
alerts + portfolio) — deferred until Initiative 1 ships and there's a real
subscriber base to segment.

## How to use this file

- When starting an initiative: flip its status to `In progress`, add any
  decisions made under it.
- When shipping: flip to `Shipped`, add the date and move a summary line
  into `CHANGELOG.md`.
- When a new business direction comes up: add a new `## Initiative N` section
  rather than a new file, so history of *why* stays in one place.
