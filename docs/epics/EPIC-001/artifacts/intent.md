# Intent — Multi-tenant digest subscriptions

**Epic ID:** `EPIC-001`
**Originator:** Thach (project owner)
**Status:** Draft — reconstructed retroactively (see note below)
**Created:** 2026-09-21

> **Note on provenance:** this epic's code (implementation, tests, docs) was
> already written and committed (`b3d5ddb`) before this pipeline was set up.
> This `intent.md` is a retroactive reconstruction from `docs/ROADMAP.md`
> Initiative 1 and the conversation in which the originator approved scope
> and chose Vercel Postgres — not a live interview captured before the work
> started. It exists so this epic has the same paper trail as one run
> forward, and so `spec.md`/`plan.md`/`verify.md`/`review.md` have a real
> "why" to check the shipped code against.

---

## 1. Problem

The daily digest (`/cron/daily-digest`, Vercel Cron, 9am ICT) can only ever
serve one Zalo chat: the recipient and watchlist are read from two env vars,
`DIGEST_CHAT_ID` and `DIGEST_COIN_SYMBOLS`, set once at deploy time. There is
no way for a second person — or the same person from a second chat — to
receive the digest, or to pick their own watchlist, without editing env vars
and redeploying. The moment this breaks down: anyone other than the person
who configured `DIGEST_CHAT_ID` asks "can I get this digest too?" and the
honest answer today is "not without a code change."

## 2. Who hurts

The project owner (Thach), in the specific moment of wanting to share the
bot with a second person (family, friend, or a future public user) who wants
their own daily watchlist. Also, indirectly, that second person, who has no
self-serve way to opt in even though the interactive commands (`/gia`,
`/top`) already work for any chat.

## 3. Cost

| Dimension | Today | Notes |
|---|---|---|
| Time to onboard a 2nd digest recipient | Requires a code/env change + redeploy | Not self-serve |
| Addressable use case | 1 chat only | Blocks every downstream initiative in docs/ROADMAP.md (alerts, portfolio, monetization all assume "who are the users") |
| Watchlist personalization | 0 — one shared list for whoever `DIGEST_CHAT_ID` is | No per-user preference |

## 4. Evidence

No support tickets or usage metrics — this is a personal/small-scale bot
with one prior real user (the `DIGEST_CHAT_ID` recipient). The evidence is
architectural, not incident-driven: `docs/ROADMAP.md`'s "Current state"
section (as of 2026-09-17) explicitly named this as "the one genuinely
single-tenant part" of an otherwise stateless, any-chat-works bot, and named
it as the prerequisite for every other roadmap initiative (alerts,
portfolio, monetization). No data yet on actual demand from a second user —
this is a bet on the roadmap's stated direction, not a measured need.

## 5. Done looks like

- Any Zalo chat can subscribe to the daily digest with its own watchlist
  (`/dangky`), see or change it (`/watchlist`), and leave (`/huy`) —
  without a code change or redeploy.
- The daily 9am cron sends to every active subscriber, each with their own
  watchlist, not a single hardcoded chat.
- The pre-existing recipient (the current `DIGEST_CHAT_ID` value) keeps
  receiving their digest through the migration, unaffected.
- **Success metric:** at least one chat other than the original
  `DIGEST_CHAT_ID` recipient is an active subscriber (`is_active = true` in
  `subscribers`) within 30 days of production deploy. (Chosen deliberately
  over a pure reliability metric — the point of this initiative is proving
  *someone besides the owner* will self-serve subscribe; reliability is
  covered separately by `verify.md`.)

## 6. Not this

- Price alerts, portfolio tracking, or any paid tier — those are separate
  roadmap initiatives (2, 3, monetization) that depend on this one but are
  explicitly out of scope here.
- Changing the interactive commands (`/gia`, `/top`, `/help`) — they already
  work per-chat and are untouched.
- Multi-channel support (Telegram, Messenger) — roadmap Initiative 5,
  unrelated.
- A subscriber-facing UI beyond chat commands (e.g. a web dashboard).

## 7. Open questions

| # | Question | Who can answer |
|---|---|---|
| 1 | Does `/dangky` need its own abuse/rate-limit guard beyond the existing `UserThrottlerGuard`? | Thach — open question carried over from docs/ROADMAP.md Initiative 1 |
| 2 | Has the success metric (≥1 non-original subscriber within 30 days) actually been observed yet? | Not yet checked — production deploy (Postgres attach + migration) had not happened as of this reconstruction; see `docs/DEPLOYMENT.md` step 3a |

---

*No solution language in this document. No components, endpoints, screens,
libraries or schemas — those belong in `spec.md` and `plan.md`.*
