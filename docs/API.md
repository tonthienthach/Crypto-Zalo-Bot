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

Requires the shared secret configured via `WEBHOOK_SECRET_TOKEN`, passed as
either:

- header `x-webhook-secret: <token>`, or
- query parameter `?secret=<token>`

Missing/incorrect secret → `401 Unauthorized`.

### Request body

```json
{
  "event_name": "message.text",
  "message": {
    "message_id": "abc123",
    "text": "/gia btc",
    "chat": { "id": "user-or-chat-id" },
    "from": { "id": "sender-id", "display_name": "Nguyen Van A" }
  }
}
```

Only `message.text` and `message.chat.id` are required for the bot to
reply; other fields are optional and currently unused. Payloads with no
`message` (e.g. a "bot added to group" event) are accepted and silently
acknowledged.

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

### Supported commands (message text)

| Input | Behavior |
| --- | --- |
| `/gia btc` or `/giá btc` or `/price btc` | Current USD/VND price + 24h change for BTC |
| `/gia btc eth sol` | Prices for multiple coins in one reply |
| `/gia` (no symbols) | Top 5 coins by market capitalization |
| `/help` or `/start` | Usage instructions |
| anything else | "I don't understand this command" reply |

### Example reply text

```
💰 Giá thị trường:
🔺 BTC (BTC): $65,000.00 (~1,651,000,000₫) | +2.50% (24h)
```

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
