# Deployment (Vercel)

## 1. Install the Vercel CLI

```bash
npm install -g vercel
vercel login
```

## 2. Link the project

From the project root:

```bash
vercel link
```

Follow the prompts to create/select a Vercel project.

## 3. Set environment variables on Vercel

Every variable in `.env.example` must be set for **Production** (and
**Preview**/**Development** if you use those environments too). Either via
the dashboard (Project → Settings → Environment Variables) or the CLI:

```bash
vercel env add ZALO_BOT_TOKEN production
vercel env add ZALO_API_BASE_URL production
vercel env add WEBHOOK_SECRET_TOKEN production
vercel env add COINGECKO_API_BASE_URL production
vercel env add COINGECKO_API_KEY production      # optional, can be empty
vercel env add COINGECKO_CACHE_TTL_SECONDS production
vercel env add USD_TO_VND_RATE production
vercel env add THROTTLE_TTL_SECONDS production
vercel env add THROTTLE_LIMIT production
vercel env add LOG_LEVEL production
vercel env add NODE_ENV production
```

`vercel env add <name> production` prompts you to paste the value.

## 4. Deploy

Preview deployment (safe, generates a unique preview URL, does not affect
production):

```bash
vercel
```

Production deployment:

```bash
vercel --prod
```

Vercel builds `api/index.ts` (see `vercel.json`) as a Node serverless
function; it does **not** need `dist/` from `nest build` — the function
bundler compiles TypeScript from source directly. `npm run vercel-build`
(`nest build`) still runs as a sanity check but its output isn't what's
deployed to the function.

## 5. Point the Zalo webhook at your production domain

After the first production deploy, Vercel gives you a domain like
`https://zalo-crypto-bot.vercel.app` (or your configured custom domain).
Register it via the Bot API's `setWebhook` call — the same helper script
used locally works here too, just point it at your production domain:

```bash
npm run webhook:register -- https://zalo-crypto-bot.vercel.app/webhook
```

(Requires `ZALO_BOT_TOKEN` and `WEBHOOK_SECRET_TOKEN` in your local `.env`
to match exactly what you set on Vercel in step 3 — the script calls the
Zalo API directly, it doesn't touch Vercel.) Confirm the response includes
`"outcome": "webhook.ok"`.

## 6. Verify

```bash
curl https://zalo-crypto-bot.vercel.app/health
```

Then message the bot from Zalo with `/gia btc` and confirm a reply arrives.

## 7. Rollback

If a deployment misbehaves:

```bash
vercel ls                 # list recent deployments
vercel rollback <url>     # promote a previous deployment back to production
```

Or from the dashboard: Deployments tab → find the last-known-good
deployment → "Promote to Production".

## 8. Ongoing deploys

Once the GitHub repo is connected to the Vercel project (Vercel dashboard →
Project → Git), every push to `main` triggers a production deployment and
every PR gets its own preview deployment automatically — no manual `vercel
--prod` needed after initial setup. Combine with the CI workflow in
`.github/workflows/ci.yml`, which independently runs lint/test/build on every
PR so a broken change fails CI before (or alongside) the Vercel preview
build.
