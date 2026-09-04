# Troubleshooting

## The app won't start: `ValidationError: "ZALO_BOT_TOKEN" is required`

`src/config/env.validation.ts` failed Joi validation. Check:

- `.env` exists locally (copy from `.env.example`) and every required
  variable is set — or on Vercel, that the same variables are set for the
  environment you're deploying to (Production/Preview/Development are
  configured independently).
- Numeric variables (`PORT`, `USD_TO_VND_RATE`, etc.) aren't accidentally
  quoted with invalid characters.

The error message names the exact variable(s) at fault — fix those and
restart.

## Bot never replies / webhook seems to receive nothing

1. Confirm the webhook URL registered with Zalo matches your actual public
   URL exactly, including the `?secret=...` query param (or the
   `x-webhook-secret` header, if configured that way).
2. Check `WEBHOOK_SECRET_TOKEN` matches on both sides — a mismatch causes a
   silent `401` (Zalo Bot Manager should show a delivery failure/log entry;
   check its dashboard).
3. Locally: make sure ngrok is still running and the tunnel URL hasn't
   rotated (free ngrok URLs change every restart unless you have a
   reserved domain) — re-register the webhook URL if it has.
4. Check the server logs (`npm run start:dev` terminal, or
   `vercel logs <deployment-url>` in production) for `HTTP` log lines and
   any `AllExceptionsFilter`/`WebhookController` error entries.

## `401 Unauthorized` on every webhook call

- `WEBHOOK_SECRET_TOKEN` differs between what's deployed and what's
  registered with Zalo. Re-check both.
- If testing with `curl`/Postman, make sure you're sending
  `x-webhook-secret: <token>` header or `?secret=<token>` query param.

## Bot replies "Không thể lấy dữ liệu giá lúc này" (CoinGecko unavailable)

This means `CoingeckoService` caught an HTTP error calling CoinGecko.
Common causes:

- **Rate limiting (HTTP 429)**: CoinGecko's free tier has a modest rate
  limit per IP. Under bursty traffic from many users, requests may briefly
  fail. Mitigations:
  - The best-effort 30s cache (`COINGECKO_CACHE_TTL_SECONDS`) already
    reduces duplicate calls for the same coin within a short window on a
    warm Lambda instance — but has no effect across cold starts, see
    docs/ARCHITECTURE.md.
  - Get a free CoinGecko Demo API key and set `COINGECKO_API_KEY` to raise
    your rate limit tier.
  - Increase `COINGECKO_CACHE_TTL_SECONDS` if slightly staler prices are
    acceptable.
- **Network/DNS issues** reaching `api.coingecko.com` from the deployment
  region — check Vercel's status page and CoinGecko's status page.
- **CoinGecko API schema changes** — check the response shape against
  `src/coingecko/interfaces/coingecko-response.interface.ts` and update if
  CoinGecko has changed their response format.

## Bot replies "Không tìm thấy đồng coin: XYZ"

The ticker symbol you sent isn't in
`src/coingecko/coingecko.constants.ts`'s `SYMBOL_TO_COINGECKO_ID` map, and
using the lowercase symbol as a CoinGecko id directly also didn't resolve.
Add the correct `symbol -> coingecko-id` mapping (look it up on
coingecko.com's coin page URL, e.g. `coingecko.com/en/coins/<id>`) and
redeploy.

## Cold start timeout on Vercel (first request after idle is slow / times out)

- Vercel serverless functions have execution time limits depending on your
  plan (commonly 10s on Hobby, longer on Pro). A cold start pays for: Node
  process boot + Nest module graph construction + the CoinGecko HTTP call
  itself.
- Mitigations already in place: `api/index.ts` caches the built Nest app
  across invocations on the same warm instance (only the *first* request to
  a new instance pays the full Nest bootstrap cost).
- Further mitigations if this remains an issue in production:
  - Reduce `httpService` timeouts (`CoingeckoService`/`ZaloService` already
    cap at 8s) so a hanging upstream call fails fast instead of exhausting
    the function's whole time budget.
  - Consider a Vercel Cron Job hitting `/health` every few minutes to keep
    an instance warm (accepting the extra invocation cost), if cold starts
    are unacceptably disruptive for your traffic pattern.

## Tests fail locally with a Joi validation error

The e2e test suite (`test/webhook.e2e-spec.ts`) sets required env vars at
the top of the file before importing `AppModule`. If you add a new
*required* Joi field in `env.validation.ts`, add a matching line there (and
in `.github/workflows/ci.yml`'s e2e step `env:` block) or the test suite
will fail the same way production would.
