# Project rules & conventions

## Naming conventions

- **Files**: `kebab-case`, suffixed by role — `coingecko.service.ts`,
  `coingecko.service.spec.ts`, `coingecko.module.ts`, `parsed-command.interface.ts`.
- **Classes**: `PascalCase` — `CoingeckoService`, `WebhookController`.
- **Interfaces/types**: `PascalCase`, no `I` prefix — `CoinMarketData`, not `ICoinMarketData`.
- **Constants**: `UPPER_SNAKE_CASE` for module-level constants (`SYMBOL_TO_COINGECKO_ID`).
- **Env vars**: `UPPER_SNAKE_CASE`, always read through `ConfigService`/`configuration.ts` — never `process.env.X` outside of `src/config/`.

## Adding a new module

1. `nest g module <name>` (or create the folder by hand following the
   existing modules' shape: `<name>.module.ts`, `<name>.service.ts`,
   `interfaces/` if it has its own DTOs/types).
2. Export only what other modules actually need from the module's
   `providers`/`exports`.
3. Add a `.spec.ts` alongside every service with non-trivial logic.
4. Wire the new module into `AppModule.imports` if it needs to be reachable
   app-wide, or into the specific consuming module (e.g. `WebhookModule`)
   otherwise — prefer the narrowest import that works.

## Adding a new bot command

1. Add the parsing rule in `src/command-parser/command-parser.service.ts`
   (extend `CommandType` if it's a genuinely new command type, or extend
   the alias set if it's a synonym of an existing one).
2. Add/extend a formatter in `src/utils/format-message.util.ts` — keep
   formatting logic pure (no I/O) so it stays trivially unit-testable.
3. Wire the new `CommandType` case into `WebhookController.replyToMessage`'s
   `switch`.
4. **Tests are required**: at minimum, a `command-parser.service.spec.ts`
   case for the new parsing rule and a `format-message.util.spec.ts` case
   for the new formatter. Add a `webhook.e2e-spec.ts` case if the command
   touches a new external dependency.
5. Document the command in `docs/API.md`'s command table.

## Testing requirements

- **Every new feature must ship with tests.** A PR that adds behavior with
  no corresponding test is not mergeable per CI (`.github/workflows/ci.yml`
  runs `npm test` and `npm run test:e2e` on every PR).
- Pure logic (parsing, formatting) → unit tests, no mocking needed.
- Services with I/O (`CoingeckoService`, `ZaloService`) → unit tests with
  the HTTP client mocked (see `coingecko.service.spec.ts` for the pattern).
- Controller wiring → e2e test via `@nestjs/testing` + `supertest`, with
  external services (`CoingeckoService`, `ZaloService`) overridden via
  `overrideProvider(...).useValue(...)`.

## Commit messages — Conventional Commits

```
<type>(<optional scope>): <short summary>

[optional body]
[optional footer(s)]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`.

Examples:

```
feat(command-parser): support "/price" as an English alias for "/gia"
fix(webhook): always ack 200 even when CoinGecko times out
docs(deployment): add Vercel rollback steps
test(coingecko): cover cache-read failure path
```

## Branching

**Enforced from 2026-09-21** (see `docs/epics/EPIC-001/artifacts/review.md`
finding #2 — prior to this date, every commit went directly to `master`
despite this section; that history is not rewritten, but new work follows
this from here on):

- `master` — the only long-lived branch, and the trunk: always deployable,
  every commit here is (or was) in production. No separate `dev`/`main`
  split — at this project's scale (single maintainer/small team), one
  trunk is simpler and there is no integration-branch use case a direct
  `feature/* -> master` PR doesn't already cover.
- `feature/<short-description>` — branched from `master`, merged back into
  `master` via PR once CI passes and the required tests are added.
- `hotfix/<short-description>` — same rule, branched from and merged back
  into `master`; the separate name is only a signal to reviewers that it's
  urgent, not a different merge target.

PRs require: CI green (lint + unit + e2e + build), at least the tests
described above for any new behavior. Direct pushes to `master` are not
used going forward, including for docs-only or process/tooling changes —
the AIDLC epic pipeline (`docs/epics/<EPIC-ID>/artifacts/implement.md`)
already tracks this per-epic; a PR just makes it enforceable, not just
documented.

## Code style

- ESLint + Prettier are enforced pre-commit via Husky + lint-staged
  (`.husky/pre-commit` runs `npx lint-staged`, configured in
  `package.json`'s `lint-staged` block). A commit is blocked if lint fails.
- No `any` without a `@typescript-eslint/no-explicit-any` justification —
  prefer a proper interface.
- No secrets in code, ever — always through `ConfigService`. `env.validation.ts`
  is the single source of truth for what env vars exist and their shape.
