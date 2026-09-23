# Implementation Summary — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Author:** Engineer
**Status:** Draft
**Created:** 2026-09-23
**Traces to:** `plan.md`

---

## 1. Branch and PR

| | |
|---|---|
| Branch | `feature/epic-002-price-alerts` (tách từ `docs/mark-epic-001-deployed`, vì branch đó chưa merge vào `master`) |
| PR | [#3](https://github.com/tonthienthach/Crypto-Zalo-Bot/pull/3) (mở qua trình duyệt, vì máy không có `gh` CLI) |

## 2. What was built

| Plan step | Change | Files |
|---|---|---|
| 1 | Env và config Redis (`KV_REST_API_URL`/`KV_REST_API_TOKEN`); `ZaloService.sendTextMessage` trả `Promise<boolean>` (có thêm trường hợp body `ok: false`), vẫn không throw; `@MaxLength(64)` cho `chat.id`; env giả trong e2e | `src/config/env.validation.ts`, `src/config/configuration.ts`, `src/zalo/zalo.service.ts`, `src/zalo/zalo.service.spec.ts` (mới), `src/webhook/dto/zalo-webhook.dto.ts`, `test/webhook.e2e-spec.ts`, `.env.example`, `package.json` |
| 2 | Hàm thuần `evaluateAlert()` / `isConditionMet()`, constants, interfaces | `src/price-alerts/price-alert-evaluator.ts` (+ spec), `price-alerts.constants.ts`, `interfaces/price-alert.interface.ts` |
| 3 | Parse `/canhbao` (tạo / list / xoá / không hợp lệ), alias `/cảnhbáo`, `/alert`, `xóa`, `delete` | `src/command-parser/command-parser.service.ts` (+ spec), `interfaces/parsed-command.interface.ts` |
| 4 | `PriceAlertsService` trên Upstash Redis; integration spec opt-in chạy với driver thật | `src/price-alerts/price-alerts.service.ts` (+ spec), `price-alerts.module.ts`, `test/price-alerts.redis.e2e-spec.ts` |
| 5 | 8 formatter mới; `/help`; 4 nhánh `case` và map 3 lỗi trong webhook; e2e `/canhbao` | `src/utils/format-message.util.ts` (+ spec), `src/webhook/webhook.controller.ts`, `src/webhook/webhook.module.ts`, `test/webhook.e2e-spec.ts` |
| 6 | `PriceAlertsController` (`/cron/price-alerts`) và spec; e2e 401 | `src/price-alerts/price-alerts.controller.ts` (+ spec), `price-alerts.module.ts`, `src/app.module.ts`, `test/webhook.e2e-spec.ts` |
| 7 | Docs, và script báo cáo chỉ đọc `npm run alerts:report` | `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` (bước 3b, 8a), `CHANGELOG.md`, `docs/ROADMAP.md`, `scripts/price-alerts-report.js`, `package.json` |
| 8 | **Chưa làm**: deploy và theo dõi là việc của owner (xem §6) | — |

Commit, mỗi bước một commit: `3e51687` (1), `bd53d0f` (2), `c2cbd3a` (3),
`3163c48` (4), `feba26a` (5), `64c9c46` (6), commit docs/implement (7).

## 3. Proofs executed

Toàn bộ bộ kiểm tra được chạy lại lần cuối sau bước 7:

```
$ npm run lint        -> exit 0
$ npm test            -> Test Suites: 10 passed, 10 total / Tests: 129 passed, 129 total   (mốc trước epic: 63; rev 1: 123)
$ npm run test:e2e    -> Test Suites: 1 skipped, 1 passed / Tests: 5 skipped, 20 passed, 25 total   (mốc: 11)
$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local \
    npx jest --config ./test/jest-e2e.json price-alerts.redis
                      -> Test Suites: 1 passed / Tests: 5 passed, 5 total
$ npm run build       -> exit 0
```

(5 test bị skip trong `npm run test:e2e` chính là integration spec với Redis thật. Không có `REDIS_INT_URL` thì nó tự skip, nên CI vẫn tự chạy được mà không cần Redis.)

Integration chạy với Redis scratch gồm `redis:7-alpine` và
`hiett/serverless-redis-http` (giả lập REST API của Upstash), qua driver
`@upstash/redis` thật.

### `EPIC-002-AC01`

```
√ writes the alert key and both id sets, and returns its list position (AC01)            [unit, service]
√ creates an alert and confirms with its position and current price (AC01)               [e2e]
√ creates, lists and deletes per chat without touching other chats (AC01, AC11)          [integration, Redis thật]
```

### `EPIC-002-AC02`

```
√ fires an armed alert once the price crosses (AC02)                                      [unit, evaluator]
√ fires a crossed alert: one message, state -> fired, delivery recorded (AC02, AC17)     [unit, controller]
```

### `EPIC-002-AC03`

```
√ does not fire again while a fired alert stays past the threshold (AC03)
```

### `EPIC-002-AC04`

```
√ re-arms only once price is back past the 0.5% buffer, then fires again after the cooldown (AC04)
√ re-arms silently without sending (AC04)                                                 [controller]
```

### `EPIC-002-AC05`

```
√ holds a re-armed alert inside the 15-minute cooldown, then fires (AC05)
```

### `EPIC-002-AC06`

```
√ handles "below" alerts symmetrically (AC06)
```

### `EPIC-002-AC07`

```
√ rejects a condition that is already met, writing nothing (AC07)                        [unit, service]
√ replies with the current price when the condition is already met (AC07)                [e2e]
```

### `EPIC-002-AC08`

```
√ treats "," as a thousands separator (AC08)
√ rejects "/canhbao btc > 100k" | "btc 100000" | "btc > -5" | "btc > 0" | "btc > 1.123456789"
  | "btc > 1000000000001" | "btc > 10,00" | "btc = 100" | "> 100" | 21-char symbol  as ALERT_INVALID (10 case)
√ rejects invalid syntax with an example, without creating anything (AC08)               [e2e]
```

### `EPIC-002-AC09`

```
√ lets UnknownCoinSymbolsError through unchanged, like /gia (AC09)                       [unit]
√ replies like /gia for an unknown coin (AC09)                                            [e2e]
```

### `EPIC-002-AC10`

```
√ rejects an 11th alert without looking up the price (AC10)                              [unit]
√ rejects the 11th alert of a chat (AC10)                                                 [integration, Redis thật]
```

### `EPIC-002-AC11`

```
√ deletes the alert at a 1-based position of the chat list (AC11)
√ throws AlertNotFoundError for a position the list does not have (AC11)
√ lists and deletes the chat own alerts, and reports a missing position (AC11)           [e2e]
√ creates, lists and deletes per chat without touching other chats (AC01, AC11)          [integration]
```

### `EPIC-002-AC12`

```
√ sends nothing and changes no state when the price source is down (AC12)
```

### `EPIC-002-AC13`

```
√ keeps going after a failed send, leaving that alert armed for a retry (AC13)
```

Kiểm tra thêm trên app thật (`node dist/main`, Redis scratch, CoinGecko
thật, Zalo trỏ vào cổng đóng): run summary
`{"evaluated":2,"fired":0,"failed":1,...}`; delivery log
`{"alertId":1,...,"priceUsd":87117,"delivered":false}`; alert vẫn ở
`"state":"armed"`.

### `EPIC-002-AC14`

```
√ skips the whole run when another run holds the lock (AC14)                             [controller]
√ acquireRunLock uses SET NX with a TTL (AC14)                                            [unit]
√ lets only one run hold the lock at a time (AC14)                                        [integration, Redis thật]
√ never resurrects an alert deleted mid-run: updateState uses SET XX (AC14)               [integration, Redis thật]
```

### `EPIC-002-AC15`

```
√ looks up prices once for all distinct coins, however many alerts (AC15)
  (50 cảnh báo / 5 coin -> getPricesBySymbols gọi đúng 1 lần với 5 symbol)
```

### `EPIC-002-AC16`

```
√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)             [e2e]
$ curl -s -o /dev/null -w "%{http_code}" localhost:3100/cron/price-alerts   -> 401        [app thật]
```

### `EPIC-002-AC17`

```
√ caps the delivery and run logs with LTRIM (AC17)                                        [unit]
√ keeps delivery and run logs readable and capped (AC17)                                  [integration: 1.445 lần ghi -> còn 1.440]
```

Dòng log có cấu trúc trên app thật:
`[PriceAlertsController] {"event":"price-alert-run","startedAt":"2026-09-23T04:34:19.588Z","evaluated":2,"fired":0,"failed":0,"rearmed":0,"durationMs":19,"driftMs":19588}`

### `EPIC-002-AC18`

**Chưa chứng minh được, và đây không phải việc có thể làm trước khi deploy.**
Tiêu chí này cần 24 giờ quan sát trên production. Công cụ đo đã có sẵn và
chạy được với dữ liệu scratch:

```
$ KV_REST_API_URL=http://localhost:8079 KV_REST_API_TOKEN=local npm run -s alerts:report
Active alerts: 2
Runs logged: 4 (2026-09-23T04:34:19.588Z -> 2026-09-23T04:34:46.800Z)
Gap between runs: p50 2.3s, p95 23.5s, max 23.5s  [AC18: p95 <= 90s]
Run duration: p95 0.6s, max 0.6s  [NFR02: <= 15s]
Totals over logged runs: fired 1, failed 1, rearmed 0

Deliveries logged: 2
  local-chat-1: 1 delivered, 1 failed
```

(Các khoảng cách ở trên là của mấy lần gọi tay, chưa phải số đo production.)

### `EPIC-002-AC19`

```
√ leaves alerts alone when the chat unsubscribes from the digest (AC19)                  [e2e]
```

### Đường gửi thành công, chạy thật đầu cuối

App thật, dùng một Zalo giả luôn trả `{"ok":true}` và ghi lại tin nhận được:
lượt A bắn (`"fired":1`, alert chuyển sang `"state":"fired","lastFiredAt":...`),
lượt B không gửi thêm (`"fired":0`). Tin nhắn thật nhận được:

```
🚨 Cảnh báo giá: BTC > $1.00
Giá hiện tại: $87,159.00 (~2.213.838.600₫)
Cảnh báo sẽ tự bật lại khi giá quay về. Gõ /canhbao để xem hoặc xoá.
```

Webhook thật (client UTF-8) gửi `/cảnhbáo eth < 1,000.5` → `/canhbao` →
`/canhbao xóa 1` → `/canhbao`, và nhận lần lượt:
`🔔 Đã đặt cảnh báo #1: ETH < $1,000.50 / Giá hiện tại: $2,784.69 ...`,
`1. ETH < $1,000.50 — đang canh`, `🗑️ Đã xoá cảnh báo #1 ...`,
`📭 Bạn chưa có cảnh báo giá nào.`

## 4. Deviations from the plan

1. **Chat id dài hơn 64 ký tự bị trả `400`, không phải `200`.** Plan §4 cho rằng `AllExceptionsFilter` luôn trả 200 cho `/webhook*`. Đọc code (`all-exceptions.filter.ts:44`) thì filter chỉ làm vậy với lỗi *không phải* `HttpException`; lỗi validation DTO vẫn trả 400, và đây là hợp đồng đã ghi sẵn trong `docs/API.md`. Mình giữ hành vi hiện có, sửa test cho đúng, và sửa câu mô tả sai trong bảng module của `docs/ARCHITECTURE.md` (chính câu đó đã khiến plan viết nhầm). Ảnh hưởng thực tế gần như bằng 0 vì id thật dài 20 ký tự.
2. **`AlertConditionAlreadyMetError` mang thêm `direction`,** để câu trả lời nói đúng "vượt lên" hay "rơi xuống" mà không phải parse lại tin nhắn.
3. **Thêm `scripts/price-alerts-report.js` và `npm run alerts:report`.** Plan chỉ ghi "lệnh đọc được ghi trong `DEPLOYMENT.md`". Một script chỉ đọc giúp owner đo AC18, NFR02 và tiêu chí thành công ở intent §5 bằng một lệnh.
4. **`AlertRunSummary` dùng `driftMs`** (độ lệch so với mốc phút) thay vì khoảng cách giữa hai lượt. Khoảng cách được script báo cáo tính từ `startedAt`, vì lượt chạy không biết thời điểm của lượt trước nếu không đọc thêm Redis.
5. **Bảng lệnh trong `docs/API.md` được bổ sung luôn `/dangky`, `/watchlist`, `/huy`.** Ba lệnh này thiếu từ EPIC-001, và cần có để ghi rõ AC19 ("`/huy` không ảnh hưởng cảnh báo").
6. **Cập nhật state `fired` trước khi ghi delivery log.** Khi viết mục Known gaps, mình thấy thứ tự ban đầu (ghi log rồi mới cập nhật state) có thể gửi trùng một tin nếu ghi log lỗi sau khi đã gửi thành công. Đã đổi thứ tự và thêm test `marks a delivered alert fired even if the delivery log write then fails (no double send)`. Chạy lại: unit 123/123, e2e 20 pass + 5 skip, build và lint sạch.

**Revision 2 (2026-09-23), sửa theo `verify.md` rev 1.** Verify độc lập ra 18/19 pass. AC18 untested vì cần 24 giờ production, và verify tìm thêm các lỗi sau. Mình sửa từng lỗi:

7. **NFR02 (lượt chạy ≤ 15 giây) có nguy cơ vỡ, verify defect #1.** Các tin được gửi tuần tự, mỗi tin có timeout 8 giây, nên chỉ cần 2 lần gửi bị treo là quá 15 giây. Đã thêm `RUN_SEND_BUDGET_MS = 6_000`: khi lượt chạy đã quá 6 giây thì không bắt đầu gửi tin mới nữa, các cảnh báo còn lại vẫn đang canh và được gửi ở lượt sau. Số cảnh báo bị hoãn ghi vào trường mới `deferred`. Test: `defers remaining sends once the 6s send budget is spent...`.
8. **Log gửi thất bại đẩy mất log thành công, verify defect #2.** Một chat chặn bot từng có thể sinh khoảng 1.440 bản ghi lỗi mỗi ngày trong một list chỉ giữ 1.000 mục. Đã sửa hai chỗ: tách thất bại sang list riêng `price-alerts:delivery-failures`, và thêm `ALERT_RETRY_BACKOFF_MS = 5 phút` qua trường mới `lastFailedAt` (sau một lần gửi lỗi thì 5 phút sau mới thử lại). Test: `backs off 5 minutes after a failed send...`, `logs failed deliveries separately...`, cùng integration với Redis thật.
9. **Mở khoá không kiểm tra chủ sở hữu, verify defect #3.** Đây là amendment so với plan §7, vốn ghi "không dùng Lua". Khoá giờ dùng một token mới cho mỗi lượt chạy (không dùng chung theo instance, vì một instance ấm có thể xử lý nhiều request chồng nhau), và được mở bằng một script Lua compare-and-delete qua `EVAL`. Integration với Redis thật xác nhận: token cũ không xoá được khoá của lượt đang giữ, còn token đúng thì xoá được.
10. **Mức giá nhỏ bị hiển thị thành `$0.00`, verify defect #6.** Đã thêm `ALERT_THRESHOLD_FORMATTER` hiển thị tối đa 8 chữ số thập phân.
11. **`driftMs` không có dấu, verify defect #7.** Giờ tính theo mốc phút gần nhất: sớm 100 ms thì ghi `-100`. Test với đồng hồ giả.
12. **Không sửa:** defect #4 (quota CoinGecko). Mình đã kiểm tra trên Vercel: production **không có** `COINGECKO_API_KEY`, tức là dùng API công khai, không có hạn mức theo tháng, nên con số 10k/tháng của gói Demo không áp dụng. Defect #5 (400 cho chat id quá dài) giữ nguyên theo §4 mục 1. Defect #8 (gửi trùng nếu gửi thành công rồi mà `updateState` lỗi) được chấp nhận: xem §6.

**Revision 3 (2026-09-23), sửa theo `verify.md` rev 2:**

13. **AC13 fail do backoff ở revision 2:** backoff 5 phút áp dụng ngay từ lần thất bại đầu tiên, nên lượt sau không thử lại, trái với AC13 và làm vỡ ngân sách trễ 2 phút. Giờ lần thất bại thứ 1 và thứ 2 được thử lại ngay ở lượt kế tiếp; chỉ từ lần thứ 3 liên tiếp mới backoff (`ALERT_FAILURES_BEFORE_BACKOFF = 3`, trường mới `consecutiveFailures`, về 0 khi gửi thành công). Không cần đổi spec. Test: `retries a failed send on the very next run (AC13)`, `backs off 5 minutes only after 3 failures in a row`.
14. **Ngân sách gửi tính cả thời gian gọi CoinGecko:** nếu CoinGecko trả lời chậm hơn 6 giây thì mọi cảnh báo đến hạn đều bị hoãn ở mọi lượt. Giờ ngân sách chỉ bắt đầu tính sau khi đã có giá. Test: `does not count a slow price lookup against the send budget`.
15. **CoinGecko Demo key:** thêm cảnh báo vào `docs/DEPLOYMENT.md` bước 8a.

Chạy lại sau revision 2: `npm test` 129/129, `npm run test:e2e` 20 pass + 5 skip, integration với Redis thật 5/5, lint 0 lỗi, build exit 0.

## 5. Discovered work

| Item | Where it went |
|---|---|
| `curl` trên Git Bash (Windows) gửi `/cảnhbáo` sai encoding, nên bot trả "chưa hiểu lệnh". Không phải bug: gửi lại bằng client UTF-8 thì chạy đúng, và `/giá` gặp đúng hiện tượng tương tự | Ghi ở đây. Khi test tay, dùng client UTF-8 |
| `.env` ở máy chưa có `POSTGRES_URL` và `KV_REST_API_*`, nên `npm run start:dev` không khởi động được | Owner chạy `vercel env pull .env` sau khi gắn Upstash (`docs/DEPLOYMENT.md` bước 3b) |
| Preview deployment cho mỗi PR cần `KV_REST_API_*` ở môi trường Preview, nếu không app sẽ fail config lúc boot | Đã ghi vào `docs/DEPLOYMENT.md` bước 3b; owner cần kiểm tra |

## 6. Known gaps

- **AC18 và ngân sách Vercel Hobby (4 giờ CPU/tháng) chưa được đo.** Đây là rủi ro plan đánh giá là ít chắc chắn nhất. Chỉ đo được sau deploy: bật lại job cron-job.org, chờ 24–48 giờ, rồi chạy `npm run alerts:report` và xem Vercel → Usage.
- **Giới hạn 10 cảnh báo không atomic:** hai lệnh tạo đồng thời của cùng một chat có thể đẩy lên 11. Đây là rủi ro đã chấp nhận trong plan, và có ghi chú trong code.
- **Gửi trùng hiếm gặp:** nếu Zalo đã nhận tin nhưng lệnh `updateState` (một lệnh Redis) lỗi ngay sau đó, cảnh báo vẫn đang canh và lượt sau có thể gửi lại một lần. Mình chấp nhận rủi ro này vì cần Redis lỗi đúng giữa hai lệnh, và cái giá là một tin thừa, không mất tin.
- **`PriceAlertsService.create` gọi CoinGecko lúc tạo cảnh báo,** nên mỗi lệnh `/canhbao` tạo mới tốn thêm 1 request vào quota dùng chung với `/gia`.
- Reviewer nên xem kỹ nhất `price-alerts.controller.ts`, đặc biệt thứ tự "gửi → cập nhật state `fired` → ghi delivery log". Thứ tự này là cố ý (xem §4 mục 6): nếu ghi log lỗi thì chỉ mất một dòng log, cảnh báo không bị gửi trùng.
