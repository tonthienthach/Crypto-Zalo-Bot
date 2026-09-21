# Review Report — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Reviewer:** Reviewer (policy)
**Status:** Draft — **revised 2026-09-21** after commit `41e4e93` closed 3 of
`verify.md`'s 5 originally-untested acceptance criteria; see updated §3 row
and §7.
**Created:** 2026-09-21
**Reviewed against:** `docs/RULES.md`, `docs/ARCHITECTURE.md`, `.aidlc/skills/risk-security-reviewer.md` (this repo has no `CLAUDE.md`; `docs/RULES.md` is its equivalent)

---

## 1. Verdict

**Overall: hold** — one blocker (finding #1: an already-broken e2e suite was
committed to `master`, even though it was fixed one commit later in the same
diff range).

## 2. Scope reviewed

| | |
|---|---|
| Base | `e06c3a9` (last commit before this epic's work — "feat: add scheduled 9am daily digest for BTC/ETH/YGG") |
| Head | `fc70c49` (current `master`) |
| Files changed | 29 files, +991/-112 (spans two commits: `b3d5ddb` feature + `fc70c49` e2e corrective fix) |
| Read in full | file-by-file — 29 files is too large for one pass; each file was read against `spec.md`'s functional requirements list before judging it |

**Scope note:** this diff range also contains the daily-digest→Vercel-Cron
migration (`vercel.json`, `CronSecretGuard`, cron-drift-tracking) — that work
predates `EPIC-001`'s `intent.md` and is not this epic's scope per `spec.md`
§7. It is not re-reviewed here beyond confirming it doesn't conflict with
the subscriber changes (it doesn't — `DigestController`'s cron-trigger path
and cron-drift logging are untouched by the subscriber rewrite except for
the recipient-loading mechanism itself).

## 3. Policy checklist

| Source | Rule | Honored |
|---|---|---|
| `docs/RULES.md` "Naming conventions" | kebab-case files, `PascalCase` classes/interfaces, `UPPER_SNAKE_CASE` constants/env vars | yes — `subscribers.service.ts`, `SubscribersService`, `Subscriber`, `MAX_WATCHLIST_SIZE`, `POSTGRES_URL` all conform |
| `docs/RULES.md` "Adding a new module" | `*.module.ts`/`*.service.ts`/`interfaces/`; export only what's needed; narrowest import | yes — `SubscribersModule` exports only `SubscribersService`; imported only into `WebhookModule`/`DigestModule`, not `AppModule` globally |
| `docs/RULES.md` "Adding a new bot command" | parser → formatter → controller switch → tests, **e2e case required for new external dependency** | **no, at commit `b3d5ddb`** — zero e2e coverage and a broken e2e boot; **yes, at commit `fc70c49`** — fixed in the very next commit in this diff range. See finding #1. |
| `docs/RULES.md` "Testing requirements" | every new feature ships with tests | **yes, as of `41e4e93`** — was `partial` at initial review (parsing/formatting/webhook-wiring had unit+e2e coverage, but `SubscribersService.normalizeWatchlist` and `DigestController`'s per-subscriber isolation had none); closed by `subscribers.service.spec.ts` + `digest.controller.spec.ts`. Only `AC04`/`AC08` (real-Postgres-only behaviors) remain untested per `verify.md` §2/§7 — cited, not re-litigated here. |
| `docs/RULES.md` "Commit messages — Conventional Commits" | `<type>(<scope>): <summary>` | yes — `feat: add multi-tenant digest subscriptions and switch cron to Vercel`, `test(webhook): fix broken e2e suite...` both conform |
| `docs/RULES.md` "Branching (simplified git flow)" | `feature/*` branch → PR → merge to `dev`/`main` | **no** — both commits landed directly on `master`. See finding #2. |
| `docs/RULES.md` "Code style" | no unjustified `any`; secrets only via `ConfigService` | yes — `grep -rn '\bany\b'` across the new/changed files under review found zero matches; `POSTGRES_URL` is read only in `configuration.ts` via `process.env`, consumed everywhere else via `ConfigService.get('db.connectionString')` |
| `docs/ARCHITECTURE.md` "Error handling philosophy" | never go silent, never leak a stack trace, `/webhook*`/`/cron/*` always ack `200` | yes — `WebhookController`'s new switch cases all funnel through the existing try/catch → `handleReplyError`; `DigestController.sendToSubscriber` has its own try/catch, logged, never rethrown |
| `.aidlc/skills/risk-security-reviewer.md` "New trust boundary" | new inbound paths reuse existing guards at the same rigor | yes — `/dangky`/`/huy`/`/watchlist` are new *commands*, not new *routes*; they're reached through the existing `POST /webhook`, still behind `WebhookSecretGuard` + `UserThrottlerGuard` |
| `.aidlc/skills/risk-security-reviewer.md` "New data at rest" | new fields justified, not incidental PII | yes — `chat_id, watchlist, is_active, created_at` only; no name/phone/message content persisted |
| `.aidlc/skills/risk-security-reviewer.md` "Abuse vectors" | unbounded cost / spam protected | partial — see finding #3 |

## 4. Findings

| # | Severity | Location | Finding | Policy |
|---|---|---|---|---|
| 1 | blocker | `test/webhook.e2e-spec.ts` (as of `b3d5ddb`) | Commit `b3d5ddb` shipped `POSTGRES_URL` as a required env var without updating the e2e test's env setup, breaking all 6 pre-existing e2e cases (`Config validation error: "POSTGRES_URL" is required`), and added 3 new bot commands with zero e2e coverage. `master` was in a broken-CI state between `b3d5ddb` and `fc70c49`. It is fixed as of `fc70c49` (10/10 e2e passing, confirmed independently in `verify.md`) — the finding is that it shipped broken at all, on a branch this project treats as "always deployable" (`docs/RULES.md` "Branching" §: "`main`/`master` — always deployable"). | `docs/RULES.md` "Adding a new bot command" step 4 ("Tests are required... Add a webhook.e2e-spec.ts case if the command touches a new external dependency") + "Testing requirements" ("A PR that adds behavior with no corresponding test is not mergeable per CI") |
| 2 | should-fix | n/a (process, not a file) | Both commits in this epic (`b3d5ddb`, `fc70c49`) were pushed directly to `master`, with no `feature/*` branch and no PR. `docs/RULES.md`'s branching section requires `feature/<desc>` branched from `dev`, merged via PR after CI passes. This is a real, repeated policy violation, not unique to this epic — see Policy amendments §8. | `docs/RULES.md` "Branching (simplified git flow)" |
| 3 | should-fix | `src/webhook/dto/zalo-webhook.dto.ts:14` (`ZaloWebhookChatDto.id`) | `chat.id` is validated only as `@IsString() @IsNotEmpty()` — no max length. Before this epic, `chat.id` was never persisted (only used transiently to route a reply). As of this epic, it is written to `subscribers.chat_id` (`TEXT PRIMARY KEY`, unbounded) on every `/dangky`. A crafted webhook payload with a very long `chat.id` string would be accepted and stored as-is. Low actual impact today (webhook is only reachable with the correct `X-Bot-Api-Secret-Token`, per `WebhookSecretGuard` — this is not an unauthenticated surface), but it's a new persistence-layer exposure of an existing under-validated field that didn't exist before this epic. | `.aidlc/skills/risk-security-reviewer.md` "Abuse vectors" (unbounded cost) — no existing `docs/RULES.md` line covers DTO field length limits, so this is partially `opinion` |
| 4 | note | `db/migrations/0001_create_subscribers.sql` | `watchlist TEXT[]` has no DB-level length constraint; the `MAX_WATCHLIST_SIZE=20` cap is enforced only in `SubscribersService.normalizeWatchlist` (application layer). Since the DB is only ever written to through this one service today, this is low-risk — flagged as `opinion`/defense-in-depth, not a real gap given the current single-writer architecture. | `opinion` |
| 5 | note | `.aidlc/skills/risk-security-reviewer.md` "Abuse vectors" (subscriber-count fan-out) | Already named and explicitly deferred to Thach in `spec.md` Concern 3 / `intent.md` Open question 1 — not re-raised as a new finding, cited here only so this report shows it was checked. | `opinion` (cited from `spec.md`, not re-litigated) |

## 5. Always-in-scope checks

| Check | Result |
|---|---|
| Secrets in code / fixtures / logs | clean — `POSTGRES_URL` only ever read via `ConfigService`; test fixture value (`postgres://test:test@localhost:5432/test`) is a non-functional placeholder, not a real credential; no connection string is logged by `scripts/db-migrate.js` or `scripts/db-seed-digest-subscriber.js` |
| Data handling (PII, retention, boundaries) | clean, with finding #3 noted (unbounded `chat_id` length now persisted) — no cross-subscriber data leakage found in the digest loop (`sendToSubscriber` logs only the subscriber's own `chatId` on its own failure) |
| Silent failure (swallowed errors, ignored codes) | clean — every new catch block either logs (`DigestController`) or replies with a specific message (`WebhookController`'s `InvalidWatchlistError` branch); none swallow silently. Matches the pre-existing pattern where `UnknownCoinSymbolsError`/`CoingeckoUnavailableError` also reply without logging (existing convention, not a new deviation) |
| Newly reachable surface (API, route, permission) | clean — no new HTTP route; `/dangky`/`/huy`/`/watchlist` are new *command* branches inside the existing, already-guarded `POST /webhook` handler |

## 6. Not re-checked

Per `verify.md` (already covered there, cited not redone):
- Whether `EPIC-001-AC01`-`AC10` individually pass/fail/untested — see `verify.md` §2. This review does not re-run those checks; it takes the "5 of 10 untested" result as given and reflects it in finding #… only where it intersects with a *policy* rule (`docs/RULES.md` "Testing requirements"), not as a fresh verification finding.
- Regression check (`npm test`, `npm run test:e2e`, `npm run build` all green) — see `verify.md` §4.
- Out-of-scope leak check (did anything from `spec.md` §7 ship anyway) — see `verify.md` §5, confirmed clean there.

## 7. Shortest path to ship

1. Acknowledge finding #1 as resolved-in-range: `fc70c49` already fixes it within this same diff. Nothing further to *do* for #1 — it is recorded as a blocker because `master` was briefly broken, not because it is broken now. **Recommendation: treat as ship-with-condition** — see note below the table.
2. Finding #2 (branching policy): either (a) the project owner decides `docs/RULES.md`'s branching section is aspirational and amends the doc to match actual practice (direct-to-`master`, small personal project), or (b) future epics actually use `feature/*` + PR. Either resolves it; inaction does not. Owner: Thach.
3. Finding #3 (unbounded `chat_id` length): add a `@MaxLength(...)` to `ZaloWebhookChatDto.id` (a reasonable cap — Zalo chat/user ids are numeric strings, well under 64 chars in practice; pick a generous-but-bounded value). Small, low-risk fix, does not require a new epic.

**Note on verdict:** finding #1 is technically a blocker by the letter of "never ship broken CI to `master`", but it was already corrected one commit later within the same reviewed range, and `master`'s *current* state (`fc70c49`) has all tests green. Recommend the project owner treat this verdict as **ship (head is clean) / hold only retroactively** — i.e., no action is needed against current `HEAD`, but the sequencing (broken commit → separate fix commit, both direct-to-`master`) is exactly what a `feature/*` branch + PR (finding #2) would have prevented, since CI would have caught it before merge instead of after.

## 8. Policy amendments

| Proposed rule | Where it belongs | Why |
|---|---|---|
| "A PR/commit that changes `src/config/env.validation.ts` to add a required env var must, in the same PR/commit, update every `test/*.e2e-spec.ts` env setup block — CI does not currently catch this because `npm test` (unit, `rootDir: src`) and `npm run test:e2e` are separate commands, and this epic's first commit only ran the former before committing." | `docs/RULES.md` "Adding a new bot command" or a new "Changing env.validation.ts" subsection | Directly caused finding #1; the existing checklist already says e2e tests are required for new external dependencies, but doesn't say the *existing* e2e boot must be checked before commit — this closes that gap explicitly rather than trusting it to be remembered |
| Either enforce `docs/RULES.md`'s `feature/*` + PR branching model in CI (e.g. branch-protection on `master`) or rewrite the branching section to describe what this project actually does (direct-to-`master`, personal scale) | `docs/RULES.md` "Branching (simplified git flow)" | Found broken twice now (this epic's own commits) with no enforcement mechanism — a documented rule nobody follows is worse than no rule, since it gives false confidence to a reader (or reviewer) relying on it |

---

*Reviewed by the same session that authored `intent.md` through `verify.md` for this retroactive epic — see `verify.md`'s independence caveat, which applies equally here. Findings were traced to specific policy lines and re-read from source rather than from memory, to partially offset the lack of true session independence.*
