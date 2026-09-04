# Contributing

Thanks for contributing to `zalo-crypto-bot`. This document is the quick
process guide; day-to-day conventions (naming, testing, commit style,
branching) live in [`docs/RULES.md`](docs/RULES.md) — read that first.

## Workflow

1. Branch from `dev`: `git checkout -b feature/<short-description> dev`.
2. Make your change, following `docs/RULES.md`.
3. Add/update tests — a feature PR with no tests will not pass review.
4. Run locally before pushing:
   ```bash
   npm run lint
   npm test
   npm run test:e2e
   npm run build
   ```
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (Husky + lint-staged will block the commit if lint fails).
6. Open a PR into `dev`. CI (`.github/workflows/ci.yml`) must pass:
   lint, unit tests, e2e tests, build.
7. After review/approval, squash-merge into `dev`. Release PRs from `dev`
   into `main` are cut when `dev` is stable and ready to ship.

## Reporting bugs / requesting features

Open an issue describing:

- What you expected vs. what happened
- Steps to reproduce (the exact message text sent to the bot, if relevant)
- Relevant log output (redact any tokens/secrets first)

## Code of conduct

Be respectful and constructive in reviews and discussions. Assume good
intent; ask questions before assuming a mistake was careless.
