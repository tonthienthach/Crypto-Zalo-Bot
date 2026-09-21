# Spec — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Owner:** Product Owner
**Status:** Draft — reconstructed retroactively (see `intent.md` provenance note; this spec describes the behavior actually shipped in commit `b3d5ddb`, written as a real contract so `verify.md`/`review.md` have something concrete to check against)
**Created:** 2026-09-21
**Traces to:** `intent.md`

---

## 1. Overview

Replace the single hardcoded digest recipient (`DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` env vars) with a self-serve, per-chat subscription: any Zalo chat can opt in, pick its own watchlist, and opt out, and the daily 9am cron sends each active subscriber their own digest. Serves `intent.md` §5 ("Done looks like") in full.

## 2. Constraints applied

| Source | What it constrains |
|---|---|
| `docs/RULES.md` | Naming conventions (kebab-case files, `PascalCase` classes/interfaces, `UPPER_SNAKE_CASE` env/constants); new-module shape (`*.module.ts`/`*.service.ts`/`interfaces/`); new-bot-command checklist (parser → formatter → controller switch → **tests, including an e2e case when the command touches a new external dependency**); Conventional Commits; env vars only via `ConfigService`/`env.validation.ts`, never raw `process.env`. |
| `docs/ARCHITECTURE.md` | Serverless/stateless design (§"Why serverless"); error-handling philosophy (never go silent, never leak a stack trace, `/webhook*` and `/cron/*` always ack `200`); existing guard pattern (`WebhookSecretGuard`, `CronSecretGuard`, `UserThrottlerGuard`) as the bar new trust boundaries must meet. |
| `docs/ROADMAP.md` Initiative 1 | The scope this epic was scoped against: persistence choice (Vercel Postgres), schema shape, the three new commands, the digest read-path change, and the seed-migration requirement — all named explicitly, so this spec must not narrow or widen that scope without saying so. |
| `.aidlc/workspace.yaml` `risk-security-reviewer` skill | New data-at-rest, new trust boundary, and abuse-vector checks apply to `subscribers` (new PII-adjacent table: `chat_id`) and to `/dangky`/`/watchlist` (new inbound, user-controlled write path). |
| No `CLAUDE.md` in this repo | N/A — `docs/RULES.md` is this project's equivalent and was used instead. |

## 3. User scenarios

### 3.1 Primary flow

- **Given** a chat has never subscribed, **when** it sends `/dangky btc eth`, **then** it becomes an active subscriber with watchlist `[btc, eth]` and receives a confirmation reply.
- **Given** an active subscriber, **when** the 9am ICT cron fires, **then** it receives a digest message for exactly its own watchlist.
- **Given** an active subscriber, **when** it sends `/watchlist`, **then** it sees its current watchlist; **when** it sends `/watchlist sol ada`, **then** its watchlist is replaced and it gets a confirmation.
- **Given** an active subscriber, **when** it sends `/huy`, **then** it stops receiving digests and gets a confirmation; its row is soft-deleted (`is_active = false`), not removed.

### 3.2 Edge and error paths

- **Re-subscribe after unsubscribe**: `/dangky` on a previously-unsubscribed `chat_id` reactivates the same row (`is_active = true`) rather than erroring or creating a duplicate.
- **`/dangky` with no symbols**: defaults to watchlist `[btc, eth]` rather than rejecting the command.
- **`/watchlist <symbols>` on a chat that was never subscribed**: does not silently create a subscription; replies telling the chat to `/dangky` first.
- **Empty or over-limit watchlist** (`/watchlist ,,,` or more than 20 symbols): rejected with a specific error reply, not a generic failure.
- **Postgres unreachable during a webhook command**: the command's try/catch in `WebhookController` must still ack `200` and reply with a friendly message, per the project's existing error-handling philosophy — this repo has no dedicated `SubscribersUnavailableError`, so today this falls through to the generic-error branch (see §8 Concern 1).
- **Postgres unreachable during the cron digest**: one subscriber's failure (unknown symbol or send failure) must not block the rest of the batch; a failure loading the subscriber list itself must still let the endpoint return `200`.
- **Unknown symbol in a subscriber's watchlist at digest time**: that subscriber's digest is skipped and logged; other subscribers still receive theirs.

## 4. Functional requirements

| Id | Requirement | Priority | Traces to |
|---|---|---|---|
| `EPIC-001-FR01` | `/dangky [symbols...]` creates or reactivates a subscriber row for the sending `chat_id` with the given watchlist (default `[btc, eth]` if none given), and replies with the resulting watchlist. | Must | intent §5 |
| `EPIC-001-FR02` | `/huy` sets the sending `chat_id`'s subscriber row `is_active = false` and replies with a confirmation. Existing row/watchlist data is preserved, not deleted. | Must | intent §5 |
| `EPIC-001-FR03` | `/watchlist` with no arguments replies with the sending `chat_id`'s current watchlist if it is an active subscriber, or a "not subscribed" message otherwise. | Must | intent §5 |
| `EPIC-001-FR04` | `/watchlist <symbols...>` replaces the sending `chat_id`'s watchlist if it is an active subscriber, and replies with the new list; if not an active subscriber, it does not create one — it replies telling the chat to `/dangky` first. | Must | intent §5 |
| `EPIC-001-FR05` | The daily digest cron (`POST/GET /cron/daily-digest`) loads every active subscriber and sends each one a digest built from their own watchlist, instead of a single hardcoded chat/watchlist pair. | Must | intent §5 |
| `EPIC-001-FR06` | A one-off, idempotent migration path exists to seed the pre-existing single-tenant recipient (`DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS`) as the first subscriber row, so that recipient's digest is uninterrupted by the cutover. | Must | intent §5, ROADMAP Initiative 1 scope item 5 |
| `EPIC-001-FR07` | Symbol input to `/dangky`/`/watchlist` accepts space- or comma-separated tokens, is case-insensitive, deduplicated, and diacritics-stripped, consistent with the existing `/gia` parsing behavior. | Should | ROADMAP Initiative 1; consistency with existing `/gia` UX |

## 5. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| `EPIC-001-NFR01` | A watchlist write is rejected, not silently truncated or accepted, past a fixed size cap. | ≤ 20 symbols per subscriber (`MAX_WATCHLIST_SIZE`) |
| `EPIC-001-NFR02` | The digest cron never fails the whole run because of one subscriber. | Per-subscriber try/catch; endpoint still returns `200` even if the subscriber list itself fails to load |
| `EPIC-001-NFR03` | No new inbound trust boundary is introduced. | `/dangky`/`/huy`/`/watchlist` reuse the existing `WebhookSecretGuard` + `UserThrottlerGuard` already applied to `POST /webhook` — no new unauthenticated endpoint |
| `EPIC-001-NFR04` | New env var(s) fail the app fast at boot if missing/malformed, matching every existing var. | `POSTGRES_URL` required and shape-validated (`postgres`/`postgresql` URI) in `env.validation.ts` |
| `EPIC-001-NFR05` | New persisted field (`chat_id`) is the minimum needed for the feature — no incidental PII collected. | Schema is exactly `chat_id, watchlist, is_active, created_at` — no name, phone, or message content stored |
| `EPIC-001-NFR06` | The app's existing test commands (`npm test`, `npm run test:e2e`, `npm run build`) all pass after this change, per `docs/RULES.md`'s PR requirement ("CI green (lint + unit + e2e + build)"). | All three green — **currently violated, see §8 Concern 1** |

## 6. Acceptance criteria

| Id | Given / When / Then |
|---|---|
| `EPIC-001-AC01` | Given no prior subscription, when a chat sends `/dangky btc eth`, then it becomes an active subscriber with `watchlist = [btc, eth]` and receives a confirmation reply naming that list. |
| `EPIC-001-AC02` | Given no prior subscription, when a chat sends `/dangky` with no symbols, then it becomes an active subscriber with `watchlist = [btc, eth]` (the default). |
| `EPIC-001-AC03` | Given an active subscriber, when it sends `/huy`, then its row has `is_active = false` and it receives a confirmation; a subsequent `/watchlist` from the same chat replies "not subscribed". |
| `EPIC-001-AC04` | Given a previously-unsubscribed chat (`is_active = false`), when it sends `/dangky`, then its existing row is reactivated (`is_active = true`) rather than erroring or duplicating. |
| `EPIC-001-AC05` | Given an active subscriber with `watchlist = [btc, eth]`, when it sends `/watchlist sol`, then its watchlist becomes `[sol]` and it receives a confirmation. |
| `EPIC-001-AC06` | Given a chat that has never subscribed, when it sends `/watchlist sol`, then no row is created and it receives a "not subscribed, use /dangky" reply. |
| `EPIC-001-AC07` | Given two active subscribers with different watchlists, when the daily digest cron fires, then each receives a message containing only their own watchlist's coins, and a failure for one (e.g. unknown symbol) does not prevent the other's message from sending. |
| `EPIC-001-AC08` | Given the legacy `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` env vars are set, when `npm run db:seed-digest-subscriber` is run, then a subscriber row for that `chat_id` exists with that watchlist and `is_active = true`, and re-running the script does not duplicate or error. |
| `EPIC-001-AC09` | Given a watchlist input of more than 20 symbols or of only empty/comma tokens, when submitted via `/dangky` or `/watchlist`, then the subscriber's stored watchlist is unchanged and the chat receives a specific validation error reply (not a generic failure). |
| `EPIC-001-AC10` | Given the repository's existing CI commands, when `npm test`, `npm run test:e2e`, and `npm run build` are run, then all three exit `0`. |

## 7. Out of scope

- Price alerts, portfolio tracking, or any paid/monetized tier (roadmap Initiatives 2, 3, and "Monetization").
- Changes to `/gia`, `/top`, `/help` beyond documenting the new commands in the help text.
- Multi-channel support (Telegram, Messenger — roadmap Initiative 5).
- A non-chat UI (web dashboard, admin panel) for managing subscribers.
- A dedicated rate limit for `/dangky` beyond the existing per-chat `UserThrottlerGuard` — carried forward as `intent.md` Open question 1, still unresolved.
- Actually attaching the Vercel Postgres integration, running the migration against the production database, and confirming the first real production digest send — tracked as deployment work in `docs/DEPLOYMENT.md` step 3a, not as part of this epic's code scope.

## 8. Concerns

| # | Concern | Needs | Resolution |
|---|---|---|---|
| 1 | `docs/RULES.md`'s "Adding a new bot command" checklist requires an e2e test case (`webhook.e2e-spec.ts`) "if the command touches a new external dependency" — `/dangky`/`/huy`/`/watchlist` touch a brand-new external dependency (Postgres) and have **zero** e2e coverage. Worse: `test/webhook.e2e-spec.ts` does not set `POSTGRES_URL`, and since `env.validation.ts` now requires it, the **entire existing e2e suite fails to boot** (`Config validation error: "POSTGRES_URL" is required`, all 6 pre-existing e2e tests fail). Confirmed by running `npm run test:e2e` on 2026-09-21 during this spec's research. This also means `EPIC-001-NFR06`/`AC10` do not currently hold. | Engineer (build-plan/implement) | **Not deferred — corrective work item.** This must be fixed as part of this epic before it can pass `verify.md`: (a) set `POSTGRES_URL` in the e2e test's env setup, (b) override `SubscribersService` in the e2e test module the same way `ZaloService`/`CoingeckoService` are overridden today, (c) add at least one e2e case each for `/dangky`, `/huy`, `/watchlist` per `docs/RULES.md`. Tracked as `build-plan.md` Phase 2 / `implement.md` deviation. |
| 2 | `docs/RULES.md`'s branching model describes `main`/`dev`/`feature/*` with PRs required before merge, but this repo has only ever had a single `master` branch, and `EPIC-001`'s code was committed directly to `master` (`b3d5ddb`), not via a feature branch + PR. | Thach (project owner) — is `docs/RULES.md`'s branching section aspirational/not-yet-adopted, or should it be followed from here on? | **Deferred, not blocking.** Does not change what this epic built; flagged here so `review.md` doesn't re-raise it as a surprise, and so a future policy pass (see `.aidlc/skills/release-manager.md`) can either update the doc or start enforcing it. |
| 3 | `.aidlc/skills/risk-security-reviewer.md` requires abuse-vector coverage for "subscribing thousands of fake chat ids, triggering unlimited CoinGecko calls." `UserThrottlerGuard` rate-limits *webhook requests* per chat, but nothing caps the *total number of distinct subscriber rows*, and each subscriber's watchlist independently drives a CoinGecko call at digest time (fan-out cost scales with subscriber count × avg watchlist size). | Thach — is this an acceptable risk at current/expected scale (personal bot, low subscriber count), or does it need a cap before wider rollout? | **Deferred with owner**, matching `intent.md` Open question 1 (rate-limit gap already named there). At today's scale (single real subscriber, no public launch) this is a `note`, not a `block`, in `review.md`, but it should not be forgotten if this bot is ever advertised publicly. |

---

*No implementation detail: no libraries, tables, endpoints or file layouts.*
