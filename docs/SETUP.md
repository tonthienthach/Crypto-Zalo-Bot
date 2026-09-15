# Setup guide

## 1. Prerequisites

- Node.js 18+ and npm
- A Zalo account
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

1. Open the **Zalo Bot Creator**: <https://zalo.me/s/botcreator/>.
2. Follow the on-screen flow to create a bot (name, avatar, etc.).
3. On success you'll see a message like:
   ```
   [Thông báo] Khởi tạo Bot thành công
   Vui lòng sử dụng token sau để tích hợp HTTP API:
   <numeric-id>:<random-string>
   ```
   Copy that whole `<numeric-id>:<random-string>` value — this is your
   `ZALO_BOT_TOKEN`. **Treat it like a password; never commit it.** Anyone
   with this token can fully control your bot.
4. Full API reference: <https://bot.zaloplatforms.com/docs/build-your-bot/>.

## 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in every variable — see the inline comments in `.env.example`. At
minimum you need:

- `ZALO_BOT_TOKEN` — from step 3
- `ZALO_API_BASE_URL` — `https://bot-api.zaloplatforms.com/bot` (default, confirmed against the official docs)
- `WEBHOOK_SECRET_TOKEN` — invent a random string, 8-256 characters, e.g. `openssl rand -hex 32`
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

Zalo's servers need a public HTTPS URL to send webhook calls to (Zalo
explicitly rejects `localhost`/private IPs).

```bash
ngrok http 3000
```

Copy the `https://<random>.ngrok-free.app` URL ngrok prints.

## 7. Register the webhook with Zalo (`setWebhook` API call)

Unlike some bot platforms, this isn't a form field in a dashboard — you
register the webhook by calling the Bot API's `setWebhook` method directly.
A helper script is included:

```bash
npm run webhook:register -- https://<random>.ngrok-free.app/webhook
```

This POSTs `{ url, secret_token }` to
`https://bot-api.zaloplatforms.com/bot<TOKEN>/setWebhook` using the values
from your `.env` (`ZALO_BOT_TOKEN`, `WEBHOOK_SECRET_TOKEN`). Zalo
immediately sends a test request to your endpoint and reports back whether
it succeeded — check the script's printed response for
`"outcome": "webhook.ok"`.

Equivalent manual curl, if you'd rather not use the script:

```bash
curl -X POST "https://bot-api.zaloplatforms.com/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<random>.ngrok-free.app/webhook", "secret_token": "<WEBHOOK_SECRET_TOKEN>"}'
```

From then on, every webhook POST Zalo sends carries header
`X-Bot-Api-Secret-Token: <WEBHOOK_SECRET_TOKEN>`, which `WebhookSecretGuard`
validates on every request.

> Re-run `npm run webhook:register` any time your public URL changes (new
> ngrok tunnel, new Vercel deployment domain).

## 8. Test end-to-end

Send your bot a message from Zalo (or share it to a group via the invite
link from the bot creator flow):

```
/gia btc
/gia btc eth sol
/gia
/help
```

You should receive a formatted reply within a couple of seconds. Watch the
`npm run start:dev` terminal for structured request logs.

## 9. Find your chat_id for the daily digest

The daily digest (`docs/ARCHITECTURE.md` → "Daily digest") pushes to a
single fixed `DIGEST_CHAT_ID`, not to whoever happens to message the bot.
To find yours: send the bot any message (step 8 above), then check the
`npm run start:dev` structured request logs for the incoming `POST /webhook`
call — the JSON body's `message.chat.id` field is your chat_id. Set it as
`DIGEST_CHAT_ID` in `.env` (local) and as a Vercel env var (production, see
`docs/DEPLOYMENT.md`).

## 10. Run the test suite

```bash
npm test          # unit tests
npm run test:e2e  # webhook e2e test (mocked CoinGecko/Zalo calls)
npm run test:cov  # coverage report
```

Next: `docs/DEPLOYMENT.md` to ship this to Vercel.
