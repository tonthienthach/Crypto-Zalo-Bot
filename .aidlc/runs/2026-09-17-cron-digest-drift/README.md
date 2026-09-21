# Issue: daily digest cron fires at 13:00 ICT instead of 09:00

## Status
In progress — fix applied 2026-09-17, monitoring through ~2026-09-24 before closing.

## Symptom
User reported the daily BTC/ETH/YGG digest arriving around 13:00 ICT, not the
configured 09:00 ICT.

## Root cause (hypothesis, not yet confirmed by data)
`.github/workflows/daily-digest.yml` used a GitHub Actions `schedule` trigger
(`cron: '0 2 * * *'`, correctly 02:00 UTC = 09:00 ICT). The cron expression
itself was correct — GitHub Actions' shared scheduler infrastructure gives no
timing guarantee and is documented to delay scheduled workflows under load.
A ~4h delay (02:00 -> ~06:00 UTC) is within the range GitHub has publicly
acknowledged for `schedule` triggers, especially for low-activity repos.

No code bug was found in `DigestController` / `formatDailyDigestReply` — the
message content and target chat were correct, only the trigger time was off.

## Fix applied (2026-09-17)
1. Replaced the GitHub Actions workflow with **Vercel Cron**
   (`vercel.json` "crons": `0 2 * * *`), triggered by the platform hosting
   the function itself rather than a separate shared CI scheduler.
2. `DigestController.sendDailyDigest` (`src/digest/digest.controller.ts`) now
   accepts any HTTP method (`@All`) since Vercel Cron sends `GET`.
3. `CronSecretGuard` (`src/common/guards/cron-secret.guard.ts`) now also
   accepts Vercel's auto-injected `Authorization: Bearer <CRON_SECRET>`
   header, in addition to the original `X-Cron-Secret-Token` header (kept
   for manual `curl` testing).
4. Added **temporary drift tracking** (`DIGEST_CRON_TRACKING`, default
   `true`):
   - Every invocation logs actual-vs-expected (09:00 ICT) drift in minutes
     to Vercel function logs (`DigestController.logDrift`), warning above
     ±15 minutes.
   - The digest message itself gets a trailing line,
     `🕐 [cron-tracking] nhận lúc HH:mm (ICT) — lệch ±Xm so với 09:00`
     (`formatCronTrackingLine` in `src/utils/format-message.util.ts`), so
     drift is visible directly in the Zalo chat across days without needing
     a database (the app has no persistent storage between invocations).

## Known caveat — not fully resolved by this fix
Per the pre-existing note in `docs/ARCHITECTURE.md` (now updated), **Vercel's
Hobby-plan cron jobs are documented as possibly landing within an hour of the
scheduled time**, not minute-exact. This fix very likely resolves the
observed 4-hour drift (GH Actions' failure mode was worse and open-ended),
but may not get timing down to the minute if the project is on the Hobby
plan. The tracking mechanism above exists specifically to measure this
rather than assume it.

## Evaluation plan
- **When**: check back around 2026-09-20 to 2026-09-24 (after several daily
  runs).
- **What to check**:
  - Read the drift line appended to each day's digest message in the Zalo
    chat — is it consistently within a few minutes of 09:00 ICT?
  - Spot-check Vercel function logs (Project → Logs, filter `Cron invoked`)
    for the same drift values and confirm no `warn`-level entries
    (>15 min drift).
  - Confirm the digest didn't silently stop firing on any day (compare
    against Vercel dashboard → Cron Jobs → run history).
- **If drift is acceptable (a few minutes)**: set `DIGEST_CRON_TRACKING=false`
  in Vercel env vars, redeploy, remove this run folder or mark it closed.
- **If drift is still large/inconsistent**: likely the Hobby-plan timing
  caveat above — options to revisit: upgrade to Vercel Pro (tighter cron
  guarantees), or switch to an external scheduler with a real SLA
  (cron-job.org, EasyCron, etc.) hitting `/cron/daily-digest`.

## Files touched
- `vercel.json` — added `crons`.
- `src/digest/digest.controller.ts` — `@All`, drift logging, tracking line.
- `src/utils/format-message.util.ts` — `formatCronTrackingLine`.
- `src/common/guards/cron-secret.guard.ts` — accept `Authorization: Bearer`.
- `src/config/configuration.ts`, `src/config/env.validation.ts` —
  `DIGEST_CRON_TRACKING` env var.
- `.env.example`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`,
  `CHANGELOG.md` — documentation.
- `.github/workflows/daily-digest.yml` — removed.
