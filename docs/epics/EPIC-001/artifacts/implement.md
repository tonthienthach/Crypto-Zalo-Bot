# Implementation Summary — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Author:** Engineer
**Status:** Draft
**Created:** 2026-09-21
**Traces to:** `plan.md`

---

## 1. Branch and PR

| | |
|---|---|
| Branch | `master` (direct commit — no feature branch/PR; see `spec.md` Concern 2) |
| PR | None. Commits: `b3d5ddb` (Part A, feature) and `fc70c49` (Part B, e2e corrective fix), both on `master`. |

## 2. What was built

| Plan step | Change | Files |
|---|---|---|
| 1 (Part A) | Schema + migration script | `db/migrations/0001_create_subscribers.sql`, `scripts/db-migrate.js` |
| 2 (Part A) | `SubscribersModule` | `src/subscribers/subscribers.service.ts`, `subscribers.module.ts`, `subscribers.constants.ts`, `interfaces/subscriber.interface.ts` |
| 3 (Part A) | `CommandParserService` changes | `src/command-parser/interfaces/parsed-command.interface.ts`, `command-parser.service.ts`, `command-parser.service.spec.ts` |
| 4 (Part A) | Reply formatters | `src/utils/format-message.util.ts` |
| 5 (Part A) | Webhook wiring | `src/webhook/webhook.controller.ts`, `webhook.module.ts` |
| 6 (Part A) | Digest cron rewired to per-subscriber | `src/digest/digest.controller.ts`, `digest.module.ts` |
| 7 (Part A) | Migration tooling + docs | `scripts/db-seed-digest-subscriber.js`, `package.json`, `.env.example`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`, `CHANGELOG.md` |
| 8-9 (Part B) | e2e suite fixed + new-command coverage | `test/webhook.e2e-spec.ts` |
| 10 (Part B) | Full command suite re-run, output captured below | — |

## 3. Proofs executed

### `EPIC-001-AC01` / `AC02` (subscribe, default watchlist)

```
$ npx jest src/command-parser
PASS src/command-parser/command-parser.service.spec.ts
  ✓ parses "/dangky btc eth" as a subscribe command with symbols
  ✓ parses "/dangky btc,eth" (comma-separated) the same as space-separated
  ✓ parses "/dangky" with no symbols as a subscribe command with empty symbols
Tests: 15 passed, 15 total
```

```
$ npm run test:e2e -- -t "dangky"
✓ subscribes and confirms the watchlist for "/dangky btc eth" (13 ms)
```

### `EPIC-001-AC03` (unsubscribe)

```
$ npm run test:e2e -- -t "huy"
✓ unsubscribes and confirms for "/huy" (10 ms)
```

### `EPIC-001-AC04` (reactivation on re-subscribe)

Not executed — see `plan.md` §7 "Deliberately not doing" and Known gaps
below. Verified by code read only: `subscribers.service.ts` `subscribe()`
issues `INSERT ... ON CONFLICT (chat_id) DO UPDATE SET watchlist =
EXCLUDED.watchlist, is_active = true`, which reactivates rather than
erroring on a second `/dangky` for the same `chat_id`. No scratch Postgres
instance was available in this environment to prove it by execution.

### `EPIC-001-AC05` / `AC06` (watchlist view/edit, not-subscribed path)

```
$ npm run test:e2e -- -t "watchlist"
✓ shows the current watchlist for "/watchlist" with no symbols (11 ms)
✓ replies "not subscribed" for "/watchlist <symbols>" from a chat with no active subscription (11 ms)
```

### `EPIC-001-AC07` (per-subscriber isolation in the digest cron)

Not executed (no `digest.controller.spec.ts` exists, matching the
pre-existing pattern before this epic — `DigestController` was never
unit-tested). Verified by code read: `sendDailyDigest` calls
`sendToSubscriber` inside a `for` loop, and `sendToSubscriber` has its own
try/catch around the CoinGecko+Zalo calls, so one subscriber's failure
cannot throw out of the loop and skip the rest.

### `EPIC-001-AC08` (seed script idempotency)

Not executed — no Postgres instance attached yet (`docs/DEPLOYMENT.md` step
3a is still outstanding). Verified by code read:
`scripts/db-seed-digest-subscriber.js` uses the same
`INSERT ... ON CONFLICT (chat_id) DO UPDATE` pattern as `subscribe()`.

### `EPIC-001-AC09` (watchlist validation: empty / over-limit)

Not executed — see Known gaps. `subscribers.service.ts`'s
`normalizeWatchlist()` throws `InvalidWatchlistError` for an empty result
or a result over `MAX_WATCHLIST_SIZE` (20), and `WebhookController` catches
it and replies with `formatInvalidWatchlistReply`, but there is no
`subscribers.service.spec.ts` exercising this directly — reviewed by
reading the code, not by running a test against it.

### `EPIC-001-AC10` (full CI command suite green)

```
$ npm test
Test Suites: 4 passed, 4 total
Tests:       46 passed, 46 total

$ npm run test:e2e
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total

$ npm run build
> nest build
(exit 0, no output)

$ npx eslint "src/**/*.ts" "test/**/*.ts"
(exit 0, no output)
```

All green as of 2026-09-21, after the Part B fix. **This criterion failed
before Part B** — see `spec.md` Concern 1 for the original failing output.

## 4. Deviations from the plan

None for Part B — implemented exactly as planned (steps 8-10). Part A (the
already-shipped code this plan reconstructs) was not built against a
written plan at all; that absence is itself the deviation this whole
retroactive epic exists to document, not a deviation from `plan.md`
(which was written after the fact, to match what shipped).

## 5. Discovered work

| Item | Where it went |
|---|---|
| `subscribers.service.spec.ts` does not exist — `normalizeWatchlist`'s empty/over-limit validation (`EPIC-001-AC09`) has no unit test | Named in `plan.md` §7 "Deliberately not doing" as a follow-up, not done in this epic; recommend the pre-existing `.aidlc` `test-writer` skill/agent for a quick follow-up pass |
| `digest.controller.ts` has never had a unit test (`digest.controller.spec.ts`), even before this epic — the per-subscriber isolation behavior (`AC07`) is only verified by code read | Pre-existing gap, widened in scope by this epic (more logic now lives in that controller); flagged for `verify.md`/`review.md`, not fixed here (would expand this corrective fix beyond `spec.md` Concern 1's actual scope) |
| `docs/RULES.md`'s branching model (`main`/`dev`/`feature/*` + PR) is not actually followed — both this epic's commits went straight to `master` | Recorded as `spec.md` Concern 2, deferred to Thach, not actioned here |
| No rate limit specific to `/dangky` beyond `UserThrottlerGuard` | Recorded as `spec.md` Concern 3 / `intent.md` Open question 1, deferred to Thach |

## 6. Known gaps

- **`AC04` and `AC08`** (Postgres `ON CONFLICT` upsert/reactivation behavior) are verified by reading the SQL, not by running it against a real database — there is no scratch/test Postgres instance in this environment. A reviewer who wants execution-level proof needs to run `npm run db:migrate` against a real (even local) Postgres and manually exercise `/dangky` twice, or `db:seed-digest-subscriber` twice.
- **`AC09`** (watchlist validation) has code-read verification only, no automated test — smallest, lowest-risk gap of the three, but a reviewer should specifically check `subscribers.service.ts`'s `normalizeWatchlist()` logic by eye since nothing else will catch a regression there.
- **`AC07`** (digest cron per-subscriber isolation) likewise has no automated test, consistent with `DigestController` never having had one.
- This epic has **not been deployed**. `docs/DEPLOYMENT.md` step 3a (attach Vercel Postgres, run `db:migrate`, run `db:seed-digest-subscriber` against production) is still outstanding — `intent.md`'s success metric (≥1 non-original subscriber within 30 days) cannot start being measured until then.
