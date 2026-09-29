# API reference

## `GET /health`

Liveness/health check for uptime monitoring and Vercel.

**Response `200`**

```json
{
  "status": "ok",
  "uptimeSeconds": 42,
  "timestamp": "2026-09-04T10:15:00.000Z"
}
```

> On Vercel, `uptimeSeconds` resets to near-zero whenever a request lands on
> a fresh ("cold") Lambda instance — see docs/ARCHITECTURE.md. It is not a
> measure of the bot's overall availability, only of the current instance's
> process age.

## `POST /webhook`

Receives inbound updates from the Zalo Bot Platform.

### Authentication

Requires the shared secret configured via `WEBHOOK_SECRET_TOKEN` (the same
value registered as `secret_token` via the Bot API's `setWebhook` call —
see docs/SETUP.md), passed as either:

- header `X-Bot-Api-Secret-Token: <token>` — what Zalo itself actually sends
  on every webhook request, or
- query parameter `?secret=<token>` — manual/local testing convenience only

Missing/incorrect secret → `401 Unauthorized`.

### Request body

Confirmed **live against a real production webhook call** (2026-09-04) — the
update is a **flat** object (an earlier reading of the docs suggested a
`{ ok, result }` wrapper; that turned out to be wrong — real traffic has no
such wrapper):

```json
{
  "event_name": "message.text.received",
  "message": {
    "message_id": "2d758cb5e222177a4e35",
    "text": "/gia btc",
    "chat": { "id": "6ede9afa66b88fe6d6a9", "chat_type": "PRIVATE" },
    "from": { "id": "6ede9afa66b88fe6d6a9", "display_name": "Nguyen Van A", "is_bot": false },
    "date": 1750316131602
  }
}
```

Only `message.text` and `message.chat.id` are required for the bot to
reply; other fields are optional and currently unused. Payloads with no
`message` (e.g. `event_name: "message.unsupported.received"`, sent for
protected accounts, or a "bot added to group" event) are accepted and
silently acknowledged.

### Response

Always `200`:

```json
{ "ok": true }
```

This endpoint intentionally never returns a non-2xx status for
business-logic failures (unknown command, CoinGecko outage, etc.) — those
are instead delivered to the user as a chat reply via the Zalo "send
message" API. A non-2xx response is reserved for auth failures (`401`) and
malformed request bodies (`400`, from DTO validation) that happen *before*
the controller can even attempt a reply. See docs/ARCHITECTURE.md → "Error
handling philosophy".

### Price source fallback

Ticker symbols are first resolved against CoinGecko (`SYMBOL_TO_COINGECKO_ID`
in `src/coingecko/coingecko.constants.ts`). Any symbol CoinGecko doesn't
resolve is retried against CoinPaprika's free, no-API-key ticker snapshot
(`src/coinpaprika/coinpaprika.service.ts`) before giving up with
`UnknownCoinSymbolsError`. This fallback never runs when CoinGecko resolves
every requested symbol, and a CoinPaprika outage never breaks the CoinGecko
path — it just means fewer symbols get filled in.

### Supported commands (message text)

| Input | Behavior |
| --- | --- |
| `/gia btc` or `/giá btc` or `/price btc` | Current USD/VND price + 24h change for BTC |
| `/gia btc eth sol` | Prices for multiple coins in one reply |
| `/gia` (no symbols) | Top 5 coins by market capitalization |
| `/help` or `/start` | Usage instructions |
| `/dangky btc eth` | Subscribe to the 9am ICT daily digest with this watchlist (default `btc eth`) |
| `/watchlist` / `/watchlist sol ada` | View / replace the digest watchlist |
| `/huy` | Unsubscribe from the daily digest (price alerts are unaffected) |
| `/canhbao btc > 100000` or `/cảnhbáo`, `/alert` | Alert when BTC rises to ≥ $100,000 (`<` for "falls to ≤"). USD; `.` decimal, `,` thousands (`100,000`); no `100k`. Max 10 per chat; rejected if already true at the current price |
| `/canhbao` | List this chat's alerts, numbered, with state (watching / fired) |
| `/canhbao xoa 2` (or `xóa`, `delete`) | Delete alert #2 of this chat's list |
| `/danhmuc mua btc 0.5 60000` (or `/danhmục`, `/portfolio buy`) | Record a buy of 0.5 BTC at $60,000 per coin; `ban`/`bán`/`sell` records a sell (refused if it exceeds what the chat holds). Price uses the `/canhbao` number rules (`,` groups thousands: `60,000`); the **quantity takes no comma at all** (`1.5`, never `1,5` or `1,500` — refused, since a decimal comma would be read 1000× off); quantity up to 8 decimals, ≤ 10^12. Only coins `/gia` can price. Max 200 trades and 20 held coins per chat. **Private chats only** — in a group, or with no `chat_type`, every `/danhmuc` command is refused |
| `/danhmuc` | Portfolio: each held coin's value and unrealized PnL, total value, unrealized and realized PnL, 24h change — USD with ~VND. Weighted-average cost. Coins with no price right now are listed and left out of the totals |
| `/danhmuc lichsu [trang]` (or `history`) | Trade history, newest first, 20 per page, with the stable trade numbers |
| `/danhmuc xoa 3` (or `xoá`, `delete`) | Delete trade #3 (refused if a later sell would then exceed the holding) |
| `/danhmuc xoahet` → `/danhmuc xoahet xacnhan` | Delete every trade of this chat, only after the confirmation command |
| anything else | "I don't understand this command" reply |

A fired alert re-arms (silently) once the price is back past the level by
0.5%, and never sends more than one message per 15 minutes.

### Example reply text

```
💰 Giá thị trường:
🔺 BTC (BTC): $65,000.00 (~1,651,000,000₫) | +2.50% (24h)
```

## `GET /cron/price-alerts`

Machine-triggered price-alert check, called every minute by cron-job.org
(see docs/DEPLOYMENT.md step 8a). Any HTTP method is accepted.

**Authentication:** its **own** secret, `PRICE_ALERTS_CRON_SECRET` (not the
digest's `CRON_SECRET_TOKEN`), as header `X-Cron-Secret-Token: <secret>` or
`Authorization: Bearer <secret>`. Missing/incorrect, or the env var unset →
`401`.

**Response:** always `200 { "ok": true }` once authenticated, even when
CoinGecko, Zalo or Redis fail during the run (logged server-side). A call
that arrives while a previous run still holds the run lock is skipped.
Every authenticated call is logged with its outcome (`healthy`, `no-price`,
`failed`, `skipped`); rejected calls are counted, at most one write a minute.

## `GET /cron/price-alerts-watch`

The watcher for the price-alert check (EPIC-002-FIX), called every 5
minutes by Upstash QStash — a different scheduler than the check's (see
docs/DEPLOYMENT.md step 8b). Any HTTP method is accepted. When the check
has had no healthy run for 15 minutes it sends the owner (`OWNER_CHAT_ID`)
a Zalo message, then at most one reminder per 6 hours, and one message when
the check is back.

**Authentication:** its **own** secret, `PRICE_ALERTS_WATCH_SECRET` (neither
`CRON_SECRET_TOKEN` nor `PRICE_ALERTS_CRON_SECRET`), as header
`X-Cron-Secret-Token: <secret>` or `Authorization: Bearer <secret>`.
Missing/incorrect, or the env var unset → `401`, and nothing is sent.

**Response:** always `200 { "ok": true }` once authenticated, even when Redis
or Zalo fail (logged server-side).

## Errors

All error responses (guard/validation failures on non-webhook routes, or
`/webhook` auth failures) share this shape:

```json
{
  "statusCode": 401,
  "message": "Invalid webhook secret",
  "timestamp": "2026-09-04T10:15:00.000Z",
  "path": "/webhook"
}
```

No stack trace is ever included in a client-facing response — see
`src/common/filters/all-exceptions.filter.ts`.
