# Setup guide

## 1. Prerequisites

- Node.js 18+ and npm
- A Zalo account able to create/manage a Zalo Bot
- [ngrok](https://ngrok.com/) (or any HTTP tunnel) for local webhook testing
- (Optional) Git, for version control and CI

## 2. Clone and install

```bash
git clone <your-repo-url> zalo-crypto-bot
cd zalo-crypto-bot
npm install
```

`npm install` also configures Husky git hooks (`prepare` script) — see
`docs/RULES.md` for what runs on commit.

## 3. Create a Zalo Bot and get a token

> Exact menu names may change — this reflects the general Zalo Bot Platform
> onboarding flow at the time of writing. If the UI has moved, search Zalo's
> official bot/developer documentation for "Zalo Bot Platform" or "Zalo Bot
> Manager".

1. Open the Zalo Bot Manager (Zalo's bot-creation mini app, conceptually
   similar to Telegram's BotFather).
2. Create a new bot: choose a name, username, and avatar.
3. The bot manager issues a **bot token** — copy it, this is your
   `ZALO_BOT_TOKEN`. Treat it like a password; never commit it.
4. Note the Bot API base URL documented for your bot (this project assumes a
   Telegram-Bot-API-like shape: `https://bot-api.zapps.me/bot<TOKEN>/<method>`).
   Set the base *without* the token as `ZALO_API_BASE_URL` in your `.env`
   (the token is appended by `ZaloService` at call time).

## 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in every variable — see the inline comments in `.env.example`. At
minimum you need:

- `ZALO_BOT_TOKEN` — from step 3
- `ZALO_API_BASE_URL` — from step 3
- `WEBHOOK_SECRET_TOKEN` — invent a long random string, e.g. `openssl rand -hex 32`
- `COINGECKO_API_BASE_URL` — `https://api.coingecko.com/api/v3` (default free tier)
- `USD_TO_VND_RATE` — a static rate, e.g. `25400`

The app **will not start** if any required variable is missing or malformed
(`src/config/env.validation.ts` fails fast with a descriptive Joi error).

## 5. Run locally

```bash
npm run start:dev
```

This starts a full Nest HTTP server (not a serverless handler) on
`http://localhost:3000` with hot reload. Check it's alive:

```bash
curl http://localhost:3000/health
```

## 6. Expose your local server with ngrok

Zalo's servers need a public HTTPS URL to send webhook calls to.

```bash
ngrok http 3000
```

Copy the `https://<random>.ngrok-free.app` URL ngrok prints.

## 7. Register the webhook URL with Zalo

In the Zalo Bot Manager, set the bot's webhook URL to:

```
https://<random>.ngrok-free.app/webhook?secret=<WEBHOOK_SECRET_TOKEN>
```

(or configure the platform to send the `x-webhook-secret` header instead of
a query param, if it supports custom headers — `WebhookSecretGuard` accepts
either.)

## 8. Test end-to-end

Send your bot a message from the Zalo app:

```
/gia btc
/gia btc eth sol
/gia
/help
```

You should receive a formatted reply within a couple of seconds. Watch the
`npm run start:dev` terminal for structured request logs.

## 9. Run the test suite

```bash
npm test          # unit tests
npm run test:e2e  # webhook e2e test (mocked CoinGecko/Zalo calls)
npm run test:cov  # coverage report
```

Next: `docs/DEPLOYMENT.md` to ship this to Vercel.
