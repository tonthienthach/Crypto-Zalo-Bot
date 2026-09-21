# Implementation Plan — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Author:** Engineer
**Status:** Draft — Part A (files 1-19) is an as-built reconstruction of commit `b3d5ddb`, already merged to `master`; Part B (files 20-21, Order steps 8-10) is a real forward plan for `spec.md` Concern 1, not yet implemented
**Created:** 2026-09-21
**Traces to:** `spec.md`

---

## 1. Approach

**Part A (as-built).** The shipped change added a new `SubscribersModule`
(service + interface + constants) backed by Vercel Postgres via
`@neondatabase/serverless`'s HTTP query function — not a pooled client — because
this app is a Vercel serverless function with no long-lived process to hold a
connection pool open (matches the existing "Why serverless" tradeoff in
`docs/ARCHITECTURE.md`). The rejected alternative was `@vercel/postgres`,
Vercel's own former SDK; it is deprecated (Vercel's Postgres offering now runs
on Neon), so using it would have meant building EPIC-001 on a dependency
already scheduled for removal. Three new commands
(`/dangky`/`/huy`/`/watchlist`) were added to the existing
`CommandParserService`/`WebhookController` switch, following the exact pattern
`/gia` already uses. `DigestController` was changed from reading two env vars
to calling `SubscribersService.listActive()` and looping per-subscriber,
isolating failures (`sendToSubscriber` has its own try/catch) rather than
letting one bad watchlist fail the whole cron run.

**Part B (corrective, not yet built).** `spec.md` Concern 1 found that this
shipped change broke the existing e2e suite (`POSTGRES_URL` now required but
never set in `test/webhook.e2e-spec.ts`) and added zero e2e coverage for the
three new commands, violating `docs/RULES.md`'s "new bot command" checklist.
The alternative considered was leaving this for a *separate* follow-up epic —
rejected because `EPIC-001-NFR06`/`AC10` (CI green) are requirements of *this*
epic's own spec, not a new one; shipping code that fails the project's own e2e
suite is not "done" by this project's stated bar, so the fix belongs here, not
in a future epic.

## 2. Files

### Part A — as-built (already on `master`, commit `b3d5ddb`)

| Path | Change | Why |
|---|---|---|
| `src/subscribers/subscribers.service.ts` | New | CRUD over `subscribers` (subscribe/unsubscribe/updateWatchlist/findActiveByChatId/listActive), `InvalidWatchlistError` |
| `src/subscribers/subscribers.module.ts` | New | Wires `SubscribersService` for DI |
| `src/subscribers/subscribers.constants.ts` | New | `DEFAULT_WATCHLIST`, `MAX_WATCHLIST_SIZE` |
| `src/subscribers/interfaces/subscriber.interface.ts` | New | `Subscriber` shape returned by the service |
| `db/migrations/0001_create_subscribers.sql` | New | `subscribers` table schema |
| `scripts/db-migrate.js` | New | Applies `db/migrations/*.sql` in order |
| `scripts/db-seed-digest-subscriber.js` | New | One-off: seeds `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` as first subscriber row |
| `package.json` | Modify | `db:migrate`, `db:seed-digest-subscriber` scripts; `@neondatabase/serverless` dependency |
| `src/command-parser/interfaces/parsed-command.interface.ts` | Modify | Add `SUBSCRIBE`/`UNSUBSCRIBE`/`WATCHLIST` to `CommandType` |
| `src/command-parser/command-parser.service.ts` | Modify | Parse `/dangky`, `/huy`, `/watchlist` (+ comma-separated symbol support) |
| `src/command-parser/command-parser.service.spec.ts` | Modify | Unit tests for the 3 new parse rules |
| `src/utils/format-message.util.ts` | Modify | Reply formatters: subscribe/unsubscribe/watchlist view/update/not-subscribed/invalid-watchlist |
| `src/webhook/webhook.controller.ts` | Modify | Switch cases for `SUBSCRIBE`/`UNSUBSCRIBE`/`WATCHLIST`; `InvalidWatchlistError` handling |
| `src/webhook/webhook.module.ts` | Modify | Import `SubscribersModule` |
| `src/digest/digest.controller.ts` | Modify | Read `listActive()` instead of `digest.chatId`/`digest.coinSymbols`; per-subscriber send loop |
| `src/digest/digest.module.ts` | Modify | Import `SubscribersModule` |
| `src/config/configuration.ts` | Modify | `db.connectionString` from `POSTGRES_URL`; drop `digest.chatId`/`digest.coinSymbols` |
| `src/config/env.validation.ts` | Modify | `POSTGRES_URL` required (postgres/postgresql URI); `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` now optional |
| `.env.example`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`, `CHANGELOG.md` | Modify | Document the new module, persistence section, deployment step 3a, initiative status |

### Part B — corrective (not yet built)

| Path | Change | Why |
|---|---|---|
| `test/webhook.e2e-spec.ts` | Modify | Set `POSTGRES_URL` in env setup; `overrideProvider(SubscribersService)` with jest mocks (same pattern as `ZaloService`/`CoingeckoService`); add e2e cases for `/dangky`, `/huy`, `/watchlist` per `docs/RULES.md` | Fixes `spec.md` Concern 1 — restores a bootable e2e suite and closes the coverage gap |

## 3. Order

*(Part A steps 1-7 are recorded for traceability — they already happened, in
this order, on `master`. Part B steps 8-10 are the actual forward plan.)*

1. Schema + migration script (`db/migrations/0001_create_subscribers.sql`,
   `scripts/db-migrate.js`) — after this, a `subscribers` table can be created
   in any Postgres instance the script points at.
2. `SubscribersModule` (service, constants, interface) — after this, subscriber
   CRUD exists but nothing calls it yet.
3. `CommandParserService` + interface changes — after this, `/dangky`/`/huy`/`/watchlist`
   parse into structured commands but no controller acts on them yet.
4. `format-message.util.ts` reply formatters — after this, the reply text exists
   but is still unwired.
5. `WebhookController`/`WebhookModule` wiring — after this, the three commands are
   live end-to-end for any chat that messages the bot.
6. `DigestController`/`DigestModule` — after this, the cron reads subscribers
   instead of env vars.
7. Migration tooling (`db:seed-digest-subscriber`) + docs — after this, the
   cutover from the old single recipient is operationally ready (pending the
   manual Postgres-attach step in `docs/DEPLOYMENT.md` 3a).
8. **(Part B)** Fix `test/webhook.e2e-spec.ts` bootstrap: add
   `process.env.POSTGRES_URL` and an `overrideProvider(SubscribersService)`
   stub — after this, `npm run test:e2e` boots again and the 6 pre-existing
   cases pass.
9. **(Part B)** Add e2e cases: `/dangky` creates+confirms, `/huy` unsubscribes,
   `/watchlist` view + edit + not-subscribed path — after this,
   `EPIC-001-AC01`/`AC03`/`AC05`/`AC06` have e2e-level proof, not just unit-level.
10. **(Part B)** Re-run `npm test`, `npm run test:e2e`, `npm run build` and
    record output in `verify.md` — after this, `EPIC-001-NFR06`/`AC10` hold.

## 4. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| e2e mock of `SubscribersService` drifts from the real Postgres-backed behavior (e.g. a mocked `subscribe()` that doesn't reject an over-limit watchlist the way the real `InvalidWatchlistError` path does) | Medium | Mock only the methods `WebhookController` calls (`subscribe`, `unsubscribe`, `updateWatchlist`, `findActiveByChatId`), matching the same jest-mock pattern already used for `CoingeckoService`/`ZaloService` in the same file — validation logic itself (`normalizeWatchlist`) is already unit-tested at the point it lives, not re-tested through the e2e mock |
| `POSTGRES_URL` value used in tests is not a real reachable database | Low — by design | The e2e suite never exercises the real `SubscribersService`/`neon()` client (it's overridden), so the value only needs to satisfy `env.validation.ts`'s URI-shape check, e.g. `postgres://test:test@localhost/test` |
| Fixing the e2e suite reveals a *second*, currently-unknown gap (e.g. a route or guard interaction not yet exercised) | Low | `verify.md` re-runs the full command suite fresh after the fix and reports real output either way |
| No existing caller of `DigestController`/`WebhookController` outside this repo (`blast-radius`: none — both are HTTP controllers reached only via Vercel Cron / the Zalo webhook, not called from other in-process code) | N/A | Confirmed by inspection: no other module imports `DigestController` or `WebhookController` directly; the only external "caller" is Vercel Cron and the Zalo Bot Platform, both reached over HTTP, so nothing else in the codebase needs updating for this change's shape |
| Hard to reverse: once `POSTGRES_URL` is required and `DIGEST_CHAT_ID`/`DIGEST_COIN_SYMBOLS` are no longer read at runtime, rolling back a *production* deploy of this epic without also reverting the DB schema/env changes would break the digest entirely (no code path left that reads the old env vars) | Low at current stage (not yet deployed — see `docs/DEPLOYMENT.md` 3a) | Rollback plan owned by `release-manager`/`aidlc-native-operator` at release time, not this plan; noted here so it isn't forgotten |

## 5. Proofs

| Criterion | Proof | How it is run |
|---|---|---|
| `EPIC-001-AC01` | Unit: `command-parser.service.spec.ts` "parses /dangky btc eth..."; component: `subscribers.service.ts` `subscribe()` upsert | `npx jest src/command-parser` (existing, passing) |
| `EPIC-001-AC02` | Unit: `command-parser.service.spec.ts` "parses /dangky with no symbols..."; `WebhookController` defaults to `DEFAULT_WATCHLIST` | `npx jest src/command-parser` (existing, passing) |
| `EPIC-001-AC03` | Unit: `command-parser.service.spec.ts` "/huy" case; manual code read of `WebhookController` `UNSUBSCRIBE` case + `SubscribersService.unsubscribe` | Unit test passing; e2e case added in Part B step 9 |
| `EPIC-001-AC04` | Code read: `subscribe()`'s `ON CONFLICT (chat_id) DO UPDATE SET ... is_active = true` | No automated test today — SQL-level behavior, would need an integration test against a real/scratch Postgres to prove mechanically; flagged as a gap in `verify.md` |
| `EPIC-001-AC05`/`AC06` | Unit: `command-parser.service.spec.ts` "/watchlist" cases; code read of `WebhookController` `WATCHLIST` case (`updateWatchlist` returns `null` → not-subscribed reply) | Unit test passing; e2e case added in Part B step 9 |
| `EPIC-001-AC07` | Manual verification during this epic: `sendDailyDigest` loops `subscribers` sequentially, each in its own try/catch | Code read of `digest.controller.ts`; no unit test exists for `DigestController` itself (no `digest.controller.spec.ts` in the repo, matching the pre-existing pattern — this controller was never unit-tested even before EPIC-001) |
| `EPIC-001-AC08` | Manual: `scripts/db-seed-digest-subscriber.js` uses `ON CONFLICT (chat_id) DO UPDATE` | Requires a real Postgres connection to run — not executed as part of this epic (no DB attached yet); tracked as a `docs/DEPLOYMENT.md` 3a manual step, not an automated proof |
| `EPIC-001-AC09` | Unit: would need a `subscribers.service.spec.ts` case for `normalizeWatchlist`'s empty/over-limit paths — **does not exist today**, a real gap distinct from Concern 1 (parser-level tests exist, service-level validation tests do not) | Not yet proven — flagged as a second, smaller gap in `verify.md`; recommended for a follow-up `test-writer` pass, not blocking this epic (validation logic is simple and was read/reviewed by hand) |
| `EPIC-001-AC10` | `npm test && npm run test:e2e && npm run build` | Part B step 10 — captured with real output in `verify.md` |

## 6. Feedback loop

Existing project test commands, unchanged in kind: `npx jest` (unit, `rootDir: src`), `npm run test:e2e` (`test/*.e2e-spec.ts` via `test/jest-e2e.json`), `npx tsc --noEmit` / `npm run build` (type-check + Nest build). Part B's loop is exactly these three commands, run after the e2e-spec fix, with real output pasted into `verify.md` — no new tooling needed.

## 7. Deliberately not doing

- Not writing `subscribers.service.spec.ts` (service-level unit tests for `normalizeWatchlist`'s edge cases) in this plan's Part B — it's a real gap (see Proofs, `AC09`) but smaller and lower-risk than the e2e boot failure; recorded as a follow-up rather than expanding this plan's scope further. (`test-writer` skill in the *other* `.aidlc` pipeline — the pre-existing `plan-review`/`release-review` one — is the natural owner if the user wants it done next.)
- Not adding a dedicated rate limit for `/dangky` beyond `UserThrottlerGuard` (`spec.md` Concern 3, deferred to Thach).
- Not touching `DIGEST_CRON_TRACKING` / cron-drift-tracking logic — unrelated, pre-existing feature, out of this epic's diff.
- Not attempting an integration test against a real/scratch Postgres instance for `AC04`/`AC08` (upsert/reactivation, seed idempotency) — no scratch DB is available in this environment; both are simple, well-understood SQL (`ON CONFLICT ... DO UPDATE`) verified by code read rather than execution. Named explicitly here rather than silently skipped.
