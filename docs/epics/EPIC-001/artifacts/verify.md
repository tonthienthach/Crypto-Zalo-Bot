# Verification Report — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Verifier:** Verifier (independent) — **caveat: not truly fresh-context.** This
epic was set up retroactively in the same session that wrote `intent.md`,
`spec.md`, `plan.md`, and `implement.md`, so the usual "arrives having never
seen the reasoning" property does not fully hold. To compensate, every
command below was **re-run independently in this step** (not copy-pasted from
`implement.md`) and every code claim was **re-read from the file, not from
the prior summary**, before this report was written.
**Status:** Draft
**Created:** 2026-09-21
**Verified against:** `spec.md`, `plan.md`

---

## 1. Verdict

**Overall: fail** — 5 of 10 acceptance criteria are `untested` (blocks
identically to a `fail` per this phase's own rule), even though every
criterion that *was* executed passed and the full command suite is green.

## 2. Acceptance criteria

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-001-AC01` | `/dangky btc eth` → active subscriber, watchlist `[btc, eth]`, confirmation reply | pass | `npm run test:e2e -- -t "dangky"` → `✓ subscribes and confirms the watchlist for "/dangky btc eth" (5 ms)`, re-run 2026-09-21 |
| `EPIC-001-AC02` | `/dangky` no symbols → default `[btc, eth]` | pass | `npx jest src/command-parser -t "dangky.*no symbols"` → `✓ parses "/dangky" with no symbols as a subscribe command with empty symbols`; `WebhookController` line reads `command.symbols.length > 0 ? command.symbols : DEFAULT_WATCHLIST` — re-read 2026-09-21 |
| `EPIC-001-AC03` | `/huy` → `is_active = false`, confirmation | pass | `npm run test:e2e -- -t "huy"` → `✓ unsubscribes and confirms for "/huy" (5 ms)`, re-run 2026-09-21 |
| `EPIC-001-AC04` | Re-`/dangky` after `/huy` reactivates, no duplicate | **untested** | No scratch Postgres instance available to this session. Code-read only: `subscribers.service.ts:36-40`, `INSERT ... ON CONFLICT (chat_id) DO UPDATE SET watchlist = EXCLUDED.watchlist, is_active = true` — plausible, not executed |
| `EPIC-001-AC05` | `/watchlist <symbols>` replaces watchlist for active subscriber | pass | `npm run test:e2e -- -t "watchlist"` → `✓ shows the current watchlist for "/watchlist" with no symbols (4 ms)` (view path only — see AC06 note) |
| `EPIC-001-AC06` | `/watchlist <symbols>` from non-subscriber → does not create, replies "not subscribed" | pass | Same run → `✓ replies "not subscribed" for "/watchlist <symbols>" from a chat with no active subscription (5 ms)` |
| `EPIC-001-AC07` | Digest cron: per-subscriber send, one failure doesn't block others | **untested** | No `digest.controller.spec.ts` exists (confirmed absent, `2026-09-21`: `Glob src/digest/*.spec.ts` → no match). Code-read only: `sendDailyDigest`'s `for` loop calls `sendToSubscriber`, which wraps its own body in try/catch (`digest.controller.ts:73-91`) |
| `EPIC-001-AC08` | `db:seed-digest-subscriber` idempotent (no duplicate on re-run) | **untested** | No Postgres attached (production deploy step `docs/DEPLOYMENT.md` 3a not done). Code-read only: same `ON CONFLICT (chat_id) DO UPDATE` pattern as `AC04`, in `scripts/db-seed-digest-subscriber.js` |
| `EPIC-001-AC09` | Empty/over-20-symbol watchlist rejected with specific error, not generic failure | **untested** | No `subscribers.service.spec.ts` exists. Code-read confirms the logic exists (`normalizeWatchlist` throws `InvalidWatchlistError` for 0 symbols or > `MAX_WATCHLIST_SIZE`=20, `WebhookController` catches it and calls `formatInvalidWatchlistReply`), but nothing runs it |
| `EPIC-001-AC10` | `npm test`, `npm run test:e2e`, `npm run build` all exit 0 | pass | See §4 below — all three re-run independently in this step, all green |

**3 of 10 pass with only code-read evidence, not execution** (`AC02` partially
— the parse behavior is unit-tested, but the `DEFAULT_WATCHLIST` fallback in
`WebhookController` itself is not exercised by any test, only read). Flagged
in §6.

## 3. Promised proofs

| Proof | Executed | Result |
|---|---|---|
| `plan.md` Part B step 8: e2e boot fix | Yes | `npm run test:e2e` boots and all 10 cases pass (was 0/6 before, per `spec.md` Concern 1) |
| `plan.md` Part B step 9: e2e cases for the 3 new commands | Yes | 4 new e2e cases added and passing (`/dangky`, `/huy`, `/watchlist` view, `/watchlist` not-subscribed) |
| `plan.md` Part B step 10: `npm test` / `test:e2e` / `build` re-run with output in `verify.md` | Yes | This report, §4 |
| `plan.md` §5 Proofs for `AC04`/`AC08`/`AC09` (explicitly marked "not executed" / "no automated test" in the plan itself) | No, as planned | The plan itself already disclosed these would not be executed — not a broken promise, but they are still `untested` and still block the verdict per this phase's rules (a plan can explain a gap; it cannot make the gap not count) |

## 4. Regressions

```
$ npm test
PASS src/utils/format-message.util.spec.ts
PASS src/command-parser/command-parser.service.spec.ts
PASS src/coingecko/coingecko.service.spec.ts (5.628 s)
PASS src/coinpaprika/coinpaprika.service.spec.ts (5.631 s)
Test Suites: 4 passed, 4 total
Tests:       46 passed, 46 total

$ npm run test:e2e
PASS test/webhook.e2e-spec.ts
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total

$ npm run build
> nest build
(exit 0)

$ npx tsc --noEmit
(exit 0, no output)
```

Re-run independently on 2026-09-21, after `implement.md`'s Part B commit
(`fc70c49`). No regressions found in the pre-existing 46 unit + 6 (of the 10)
e2e cases.

## 5. Out-of-scope check

Checked `spec.md` §7 against the actual diff (`git show --stat b3d5ddb`,
`git show --stat fc70c49`):

- No price-alert, portfolio, or monetization code shipped. ✅ stayed out.
- `/gia`, `/top` command logic untouched; `/help`'s reply text gained 3 new
  lines documenting `/dangky`/`/watchlist`/`/huy` — spec explicitly allowed
  "documenting the new commands in the help text", so this is in-scope, not
  a leak.
- No Telegram/Messenger code. ✅ stayed out.
- No web dashboard/admin UI. ✅ stayed out.
- No rate limit was added for `/dangky` (deferred per Concern 3) — confirmed
  nothing was quietly added either. ✅ consistent with the deferral.
- The Postgres integration has **not** been attached to the live Vercel
  project and no migration has been run against production — confirmed this
  did not happen either (correctly out of this epic's code scope per
  `spec.md` §7's last bullet).

No out-of-scope leaks found.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | 5 of 10 acceptance criteria are `untested` (AC04, AC07, AC08, AC09, and the `DEFAULT_WATCHLIST`-fallback half of AC02) — all for the same root cause: no scratch/local Postgres was available to this session, and `DigestController`/`SubscribersService` have zero unit tests of their own logic (only reached indirectly through e2e mocks). | should-fix | `db/migrations/`, `src/subscribers/subscribers.service.ts`, `src/digest/digest.controller.ts` |
| 2 | This "independent" verification was not run by a genuinely fresh session — the same session authored `intent.md` through `implement.md`. Mitigated by re-running every command and re-reading every cited line rather than trusting the prior summary, but the structural independence the `aidlc-native-verifier` persona is designed around did not hold here. | note | Process, not code — relevant to how much weight `review.md` should give this report versus re-checking itself |
| 3 | `implement.md` §3 for `AC02` cites only the parser-level test; it does not mention that the `DEFAULT_WATCHLIST` fallback inside `WebhookController` itself is untested. This verify pass caught that distinction; `implement.md` slightly overstated `AC02`'s coverage by not separating "symbols parse correctly" from "the default actually gets applied end-to-end." | note | `src/webhook/webhook.controller.ts` `SUBSCRIBE` case |

## 7. Shortest path to pass

1. Add `src/subscribers/subscribers.service.spec.ts` covering `normalizeWatchlist`'s empty-input and over-`MAX_WATCHLIST_SIZE` paths (closes `AC09`, cheapest of the four).
2. Add an e2e case for `/dangky` with zero explicit symbols asserting `subscribe` was called with `DEFAULT_WATCHLIST` (closes the untested half of `AC02`).
3. Add `src/digest/digest.controller.spec.ts` with a mocked `SubscribersService`/`CoingeckoService`/`ZaloService` covering: (a) two subscribers, one throws, both get attempted and the healthy one still sends; (b) `listActive()` itself throwing still returns `{ ok: true }` (closes `AC07`).
4. For `AC04`/`AC08` (the two SQL-level upsert behaviors): either provision a scratch/local Postgres and run `npm run db:migrate` + exercise `/dangky` twice / `db:seed-digest-subscriber` twice, or explicitly accept them as `untested-but-reviewed` in `review.md` with a named reason (SQL is simple, standard `ON CONFLICT` idiom, low risk) — a real decision either way, not a default.
