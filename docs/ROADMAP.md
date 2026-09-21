# Roadmap

Living plan for where this project is going, beyond what `CHANGELOG.md`
tracks (which records shipped changes). This file tracks **initiatives**:
why they matter, their current status, and open decisions — update it as
work progresses or new direction is decided, rather than starting a new doc.

Status legend: `Idea` (not committed) · `Planned` (scoped, not started) ·
`In progress` · `Shipped` · `Dropped` (with reason).

## Current state (2026-09-21)

Bot on Vercel serverless, now with a Postgres-backed subscriber list
(Initiative 1, in progress):
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
- Not yet deployed: the Postgres integration must be attached and
  `npm run db:migrate` run on the production DB (see `docs/DEPLOYMENT.md`
  step 3a) before this ships.

## Initiative 1: Multi-tenant subscriptions (SaaS foundation)

**Status:** In progress (2026-09-21) — persistence, commands, and digest
read path implemented; not yet deployed/migrated (see docs/DEPLOYMENT.md
step 3a for the remaining manual steps: attach Postgres, run migration,
seed the legacy recipient).

**Tracked as:** [`EPIC-001`](../docs/epics/EPIC-001/EPIC-001.md) — full
paper trail (intent, spec, plan, implementation, independent verify, policy
review) in `docs/epics/EPIC-001/artifacts/`. `verify.md`: fail (5/10
acceptance criteria untested — no scratch DB + missing unit tests for
`SubscribersService`/`DigestController`, not known defects).
`review.md`: hold-retroactively / ship-at-current-`HEAD` (the one blocker —
a commit that briefly broke the e2e suite — was already fixed one commit
later; 2 should-fix items open: no feature-branch/PR was used, and
`chat.id` has no max length before being persisted). See
`docs/epics/EPIC-001/artifacts/verify.md` §7 and `review.md` §7 for the
shortest path to a clean pass.

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
6. ⬜ Not done yet: attach the Postgres integration on the live Vercel
   project, run `npm run db:migrate` + `npm run db:seed-digest-subscriber`
   against production, and confirm the next 9am digest goes out correctly
   (see `docs/DEPLOYMENT.md` step 3a). Flip this initiative to `Shipped`
   once that's confirmed.

**Open questions:**
- Do `/dangky` writes need their own rate limit / abuse guard beyond the
  existing `UserThrottlerGuard`?

## Initiative 2: Price alerts (threshold notifications)

**Status:** Idea
**Why:** Highest-retention feature for crypto users — depends on
Initiative 1's persistence layer existing first.
**Scope (sketch):** `/canhbao btc > 100000` command; a periodic cron
checks stored thresholds against current prices and pushes on breach.

## Initiative 3: Portfolio tracking

**Status:** Idea
**Why:** Turns a lookup tool into a daily habit (PnL in the digest).
**Depends on:** Initiative 1 (per-user storage).

## Initiative 4: Simple signals (volatility / basic indicators)

**Status:** Idea
**Why:** Differentiates from "just a price lookup" bot. Could reuse
CoinGecko historical data or the existing CoinPaprika fallback.

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
