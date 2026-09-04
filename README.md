# zalo-crypto-bot

![CI](https://img.shields.io/badge/CI-GitHub%20Actions-blue)
![NestJS](https://img.shields.io/badge/NestJS-10-E0234E)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

A Zalo bot that replies with live cryptocurrency market prices (via
CoinGecko) when asked, e.g. `/gia btc`. Built with NestJS + TypeScript,
deployed as a Vercel serverless function.

## Quick start

```bash
npm install
cp .env.example .env   # fill in ZALO_BOT_TOKEN, WEBHOOK_SECRET_TOKEN, etc.
npm run start:dev      # local dev server on http://localhost:3000
```

Then expose it with `ngrok http 3000` and register the webhook URL with
your Zalo bot — full walkthrough in [docs/SETUP.md](docs/SETUP.md).

## Example

```
You:  /gia btc eth
Bot:  💰 Giá thị trường:
      🔺 BTC (BTC): $65,000.00 (~1.651.000.000₫) | +2.50% (24h)
      🔻 ETH (ETH): $3,000.00 (~76.200.000₫) | -1.20% (24h)
```

## Docs

| Doc | What's in it |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow diagram, module map, key design decisions (why CoinGecko, why the cache is best-effort, serverless vs. long-running trade-offs) |
| [docs/SETUP.md](docs/SETUP.md) | Getting a Zalo Bot token, local setup, ngrok tunneling |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to Vercel step by step, env vars, rollback |
| [docs/API.md](docs/API.md) | `/webhook` and `/health` request/response reference |
| [docs/RULES.md](docs/RULES.md) | Coding conventions, how to add a module/command, commit & branching rules, test requirements |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Rate limits, webhook secret issues, cold starts |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution workflow |
| [CHANGELOG.md](CHANGELOG.md) | Version history (Keep a Changelog) |

## Scripts

```bash
npm run start:dev     # local dev server, hot reload
npm run build          # compile to dist/ (sanity check; not what Vercel deploys)
npm run lint            # ESLint
npm run format          # Prettier
npm test                # unit tests
npm run test:e2e        # e2e tests (webhook controller, mocked externals)
npm run test:cov        # coverage report
vercel --prod            # deploy to production (see docs/DEPLOYMENT.md)
```

## Tech stack

NestJS 10 · TypeScript 5 · `@nestjs/axios` · `@nestjs/config` (Joi
validation) · `@nestjs/throttler` · `@nestjs/cache-manager` ·
class-validator/class-transformer · Jest + Supertest · ESLint + Prettier ·
Husky + lint-staged · GitHub Actions · Vercel serverless functions.

## License

MIT
