# Verification Report — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Verifier:** Verifier (independent)
**Status:** Draft
**Created:** `2026-09-23`
**Verified against:** `spec.md`, `plan.md`

---

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 18/19 tiêu chí pass, 0 fail, 1 untested (`EPIC-002-AC18`, chỉ đo được sau 24 giờ chạy production). Verdict này ra đúng theo luật: `untested` chặn như `fail`. Trước deploy không có tiêu chí nào sai, nhưng epic chỉ được coi là pass khi AC18 đã được đo trên production. Ngoài ra còn các finding ở §6, không finding nào làm hỏng một AC, nhưng #1–#3 nên được xử lý hoặc chấp nhận rõ ràng trước khi ship.

## 2. Acceptance criteria

Mọi lệnh bên dưới do verifier tự chạy trên `feature/epic-002-price-alerts` (HEAD `0bf89ed`), ngày 2026-09-23. `unit` = `npx jest --verbose src/...`, `e2e` = `npx jest --config ./test/jest-e2e.json --verbose`, `integration` = `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --verbose price-alerts.redis`, chạy với Redis thật (`redis:7-alpine` + `hiett/serverless-redis-http` qua Docker 29.6.2). Container và network đã được xoá sau khi chạy.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-002-AC01` | BTC = 95.000, `/canhbao btc > 100000` → tạo, xác nhận kèm số thứ tự, điều kiện, giá hiện tại | pass | e2e `√ creates an alert and confirms with its position and current price (AC01)` (kiểm tra `create('chat-a1','btc','above',100000)`, trả lời có `#1` và `$95,000.00`); unit `√ writes the alert key and both id sets, and returns its list position (AC01)`; integration `√ creates, lists and deletes per chat without touching other chats (AC01, AC11)`. Đọc `formatAlertCreatedReply`: có `#${position}`, điều kiện `BTC > $100,000.00`, giá USD + VND. |
| `EPIC-002-AC02` | Đang canh, giá 100.200 → đúng 1 tin chứa BTC, `> 100,000`, giá hiện tại; chuyển "đã báo" | pass | unit controller `√ fires a crossed alert: one message, state -> fired, delivery recorded (AC02, AC17)`: `sendTextMessage` gọi đúng 1 lần, text chứa `BTC > $100,000.00` và `$100,200.00`, `updateState` với `state: 'fired'`. Ghi chú: chuỗi hiển thị là `> $100,000.00` chứ không phải đúng ký tự `> 100,000`. Nội dung đúng về nghĩa. |
| `EPIC-002-AC03` | "Đã báo", giá 100.500 rồi 101.000 → không gửi thêm | pass | unit `√ does not fire again while a fired alert stays past the threshold (AC03)` (`'none'` ở T+1 và T+30 phút). Code `price-alert-evaluator.ts:25-30`: trạng thái `fired` chỉ trả `rearm`/`none`, không bao giờ `fire`. |
| `EPIC-002-AC04` | 99.800 → chưa bật lại; 99.400 → bật lại, không gửi; 100.100 sau > 15 phút → báo lần 2 | pass | unit `√ re-arms only once price is back past the 0.5% buffer, then fires again after the cooldown (AC04)`, `√ re-arms exactly at the buffer boundary` (99.500 → rearm, đúng FR06 "≤ 99.500"), controller `√ re-arms silently without sending (AC04)` (không gọi `sendTextMessage`, `rearmed: 1`). |
| `EPIC-002-AC05` | Báo lúc T, vượt lại lúc T+5 → không gửi; chỉ gửi từ T+15 | pass | unit `√ holds a re-armed alert inside the 15-minute cooldown, then fires (AC05)` (T+5 và T+14,9 → `none`, T+15 → `fire`). Cooldown tính theo `lastFiredAt`, và `lastFiredAt` được giữ lại khi rearm (`price-alerts.controller.ts:133`). |
| `EPIC-002-AC06` | `eth < 2000`, ETH = 1.990 → báo; đối xứng | pass | unit `√ handles "below" alerts symmetrically (AC06)` (1.990 → fire, 2.001 → none, 2.005 → none, 2.010 → rearm). |
| `EPIC-002-AC07` | BTC = 110.000, `/canhbao btc > 100000` → không tạo, báo đã thoả kèm giá | pass | unit `√ rejects a condition that is already met, writing nothing (AC07)`; e2e `√ replies with the current price when the condition is already met (AC07)` (trả lời chứa `$110,000.00`). |
| `EPIC-002-AC08` | `100k`, thiếu toán tử, `-5`, 9 chữ số lẻ → từ chối kèm ví dụ; `100,000` = 100000 | pass | unit parser `rejects "%s" as ALERT_INVALID (AC08, NFR06)` với 10 input, gồm cả 4 input của AC8, và `treats "," as a thousands separator (AC08)`: toàn bộ 91 test trong `src/price-alerts src/command-parser src/utils src/zalo` đều pass. e2e `√ rejects invalid syntax with an example, without creating anything (AC08)` (`createAlert` không được gọi, trả lời có `/canhbao btc > 100000`). |
| `EPIC-002-AC09` | `/canhbao xyzabc > 1` → "coin không tồn tại" giống `/gia` | pass | e2e `√ replies like /gia for an unknown coin (AC09)`; unit `√ lets UnknownCoinSymbolsError through unchanged, like /gia (AC09)`. `webhook.controller.ts:186` dùng chung nhánh `UnknownCoinSymbolsError` với `/gia`. |
| `EPIC-002-AC10` | Đã có 10, đặt cái thứ 11 → từ chối, nêu giới hạn 10 và cách xoá | pass | integration (Redis thật) `√ rejects the 11th alert of a chat (AC10)`; unit `√ rejects an 11th alert without looking up the price (AC10)`. `formatAlertLimitReply(10)` có "tối đa 10" và `/canhbao xoa <số>`. Việc kiểm tra giới hạn không atomic: plan đã chấp nhận điểm này. |
| `EPIC-002-AC11` | A có 2, B có 1: list đúng 2; xoá #2 của A không ảnh hưởng B; `xoa 99` → không tìm thấy | pass | integration (Redis thật) `√ creates, lists and deletes per chat without touching other chats (AC01, AC11)` (list `[100000, 90000]`, xoá #2 → còn `[100000]`, B vẫn `[120000]`, xoá 99 → `AlertNotFoundError`); e2e `√ lists and deletes the chat own alerts, and reports a missing position (AC11)`. |
| `EPIC-002-AC12` | Nguồn giá lỗi/timeout → không gửi, không đổi trạng thái, trả `200` | pass | unit `√ sends nothing and changes no state when the price source is down (AC12)` (kết quả `{ ok: true }`, không gọi `sendTextMessage`/`updateState`). Timeout 8 giây của CoinGecko cũng thành `CoingeckoUnavailableError` (`coingecko.service.ts:147-150`). |
| `EPIC-002-AC13` | Gửi chat 1 lỗi → chat 2 vẫn nhận; cảnh báo chat 1 vẫn canh, lượt sau thử lại | pass | unit `keeps going after a failed send, leaving that alert armed for a retry (AC13)` (pass trong suite 52 test của `src/price-alerts src/zalo src/utils`): chỉ `updateState` cho id 2, `recordDelivery` ghi `delivered: false` cho id 1. `ZaloService` trả `false` thay vì throw: `√ resolves false (without throwing) when Zalo answers ok: false`, `√ ... when the HTTP call fails`. |
| `EPIC-002-AC14` | 2 lượt đồng thời → tối đa 1 tin | pass | unit `√ skips the whole run when another run holds the lock (AC14)`; integration `√ lets only one run hold the lock at a time (AC14)`, `√ never resurrects an alert deleted mid-run: updateState uses SET XX (AC14)`. Verifier chạy thêm 5 lệnh `SET NX EX` **song song** trên Redis thật: `["OK",null,null,null,null]`. Lưu ý finding #3: khoá không kiểm tra chủ sở hữu khi release. |
| `EPIC-002-AC15` | 50 cảnh báo / 5 coin → nguồn giá gọi ≤ 2 lần | pass | unit `√ looks up prices once for all distinct coins, however many alerts (AC15)` (`getPricesBySymbols` gọi đúng 1 lần với 5 symbol). Đọc `coingecko.service.ts:77,102`: một lần gọi đó tốn tối đa 1 request CoinGecko cộng 1 request CoinPaprika (chỉ khi có symbol CoinGecko không nhận ra). Tổng ≤ 2. |
| `EPIC-002-AC16` | Không có secret / sai secret → `401`, không đánh giá gì | pass | e2e `√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)` (2 lần `401`, `acquireRunLock`/`listAll` không được gọi); log e2e có `UnauthorizedException: Invalid cron secret` và không có stack trace nào trong body. |
| `EPIC-002-AC17` | Bản ghi lần gửi truy vấn được; mỗi lượt 1 dòng log với số liệu NFR08 | pass | unit controller (AC02, AC17): `recordDelivery` có `alertId, chatId, priceUsd, delivered`, và theo code thì còn `symbol, direction, threshold, attemptedAt` (`price-alerts.controller.ts:154-163`). `recordRun` có `evaluated, fired, failed, rearmed, durationMs, driftMs`. integration `√ keeps delivery and run logs readable and capped (AC17)` (1.445 lần ghi → đọc lại 1.440, delivery đọc lại được). Dòng log có cấu trúc: `price-alerts.controller.ts:46` (`JSON.stringify({ event: 'price-alert-run', ...summary })`). Không test nào assert dòng log này; bằng chứng là code đã đọc. |
| `EPIC-002-AC18` | Production 24 giờ: p95 khoảng cách giữa hai lượt ≤ 90 giây | untested | Chưa deploy, nên không có gì để đo. Đây là tiêu chí chỉ kiểm được sau deploy, không phải lỗi của build. Công cụ đo đã có (`npm run alerts:report`, `scripts/price-alerts-report.js`, đọc `price-alerts:runs`). Verifier không chạy nó với production (theo chỉ dẫn). Lưu ý: lượt bị bỏ vì khoá, hoặc lượt lỗi Redis, không ghi summary, nên khoảng cách đo được có thể lớn hơn thực tế một chút. |
| `EPIC-002-AC19` | `/huy` → cảnh báo vẫn còn và vẫn chạy | pass | e2e `√ leaves alerts alone when the chat unsubscribes from the digest (AC19)` (`unsubscribe` được gọi, không hàm nào của `PriceAlertsService` bị gọi). Đọc code: `PriceAlertsController.runCheck` dùng `listAll()` mà không lọc theo subscriber, và `SubscribersService` không có trong diff. |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| AC01: e2e + unit `create` | Có (verifier chạy) | pass |
| AC02: unit controller | Có | pass |
| AC03–AC06: unit evaluator | Có | pass |
| AC07: unit service + e2e | Có | pass |
| AC08: unit parser + e2e | Có | pass |
| AC09: e2e `UnknownCoinSymbolsError` | Có | pass |
| AC10: unit + integration Redis thật | Có (Docker) | pass |
| AC11: integration Redis thật | Có (Docker) | pass |
| AC12, AC13: unit controller | Có | pass |
| AC14: unit + integration (khoá, `SET XX`) | Có (Docker) + verifier thêm phép thử `SET NX` song song | pass |
| AC15: unit controller | Có | pass (1 lần gọi `getPricesBySymbols`; ≤ 2 request HTTP theo code) |
| AC16: e2e `401` | Có | pass |
| AC17: unit + integration | Có (Docker) | pass |
| AC18: quan sát production 24 giờ | Không (chưa deploy) | untested |
| AC19: e2e + kiểm tra cấu trúc | Có | pass |
| §6 Feedback loop: `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` | Có | Cả 4 đều exit 0 (xem §4) |
| §6 Đầu cuối cục bộ (`start:dev` + `curl`) | Verifier không chạy (không có `.env` đủ `POSTGRES_URL`/`KV_REST_API_*`; không gọi URL production). `implement.md` §3 nói đã chạy với `node dist/main` và Zalo giả | Không xác nhận độc lập; các AC ở trên không dựa vào proof này |

## 4. Regressions

```
$ npm run lint
> eslint "{src,apps,libs,test,api}/**/*.ts" --fix
EXIT 0            (git status sau đó: không có file nguồn nào bị --fix sửa)

$ npm test
PASS src/price-alerts/price-alerts.controller.spec.ts
PASS src/digest/digest.controller.spec.ts
PASS src/price-alerts/price-alerts.service.spec.ts
...
Test Suites: 10 passed, 10 total
Tests:       123 passed, 123 total
EXIT 0

$ npm run test:e2e
PASS test/webhook.e2e-spec.ts
Test Suites: 1 skipped, 1 passed, 1 of 2 total
Tests:       5 skipped, 20 passed, 25 total
EXIT 0            (5 test bị skip là price-alerts.redis, chạy riêng bên dưới)

$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local \
    npx jest --config ./test/jest-e2e.json --verbose price-alerts.redis
  √ creates, lists and deletes per chat without touching other chats (AC01, AC11) (225 ms)
  √ rejects the 11th alert of a chat (AC10) (144 ms)
  √ never resurrects an alert deleted mid-run: updateState uses SET XX (AC14) (47 ms)
  √ lets only one run hold the lock at a time (AC14) (27 ms)
  √ keeps delivery and run logs readable and capped (AC17) (6157 ms)
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total

$ npm run build
> nest build
EXIT 0
```

Các test cũ (`/gia`, `/dangky`, `/huy`, `/watchlist`, digest, guard) đều vẫn xanh. Các dòng `ERROR` trong output là log cố ý từ các test đường lỗi, không phải test bị hỏng.

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không có. Cụ thể:
- Không có cảnh báo theo %, chỉ báo kỹ thuật hay VND. Chỉ có `>`/`<` với mức USD (`ALERT_CREATE_PATTERN`).
- Hậu tố `100k`/`1m` bị từ chối (test parser).
- Không có lệnh sửa cảnh báo, không có chế độ báo một lần.
- Không thêm kênh ngoài Zalo. Bản tin 9h không đổi: `src/digest/` và `vercel.json` không có trong diff.
- Không tự dọn cảnh báo của chat chặn bot. Gửi lỗi chỉ được ghi log (nhưng xem finding #2 về hệ quả).

Phạm vi ngoài plan đã ship: `scripts/price-alerts-report.js` (chỉ đọc) và bổ sung `/dangky`, `/watchlist`, `/huy` vào bảng lệnh của `docs/API.md`. Cả hai được ghi trong `implement.md` §4 và vô hại.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Rủi ro NFR02/timeout: gửi tuần tự, mỗi lần timeout 8 giây.** Một lượt gửi từng tin một, và mỗi `sendTextMessage` có timeout 8 giây. Chỉ cần 2 tin tới Zalo bị treo, hoặc vài chục cảnh báo cùng bắn, là lượt chạy đã vượt NFR02 (≤ 15 giây); nếu nặng hơn thì vượt cả TTL khoá 120 giây hay thời gian tối đa của function trên Vercel. NFR02 không có AC nào, và plan cũng không có proof nào đo nó với 1.000 cảnh báo. Hiện NFR02 chưa được chứng minh. | Medium | `src/price-alerts/price-alerts.controller.ts:82-98`, `src/zalo/zalo.service.ts:39` |
| 2 | **Một chat chặn bot đẩy các lần gửi thành công ra khỏi delivery log.** Theo AC13, cảnh báo gửi lỗi vẫn ở trạng thái armed và được thử lại mỗi phút. Một chat đã chặn bot mà điều kiện vẫn đúng sẽ ghi khoảng 1.440 bản ghi `delivered: false` mỗi ngày vào list chỉ giữ 1.000 mục. Sau chưa tới 17 giờ, các bản ghi gửi thành công đã bị `LTRIM` xoá mất. Như vậy FR12 không còn phục vụ được mục đích của nó (kiểm tiêu chí thành công trong 30 ngày ở intent §5), và chat đó còn tốn 1 lần gọi Zalo mỗi phút mãi mãi. | Medium | `src/price-alerts/price-alerts.controller.ts:154-167`, `src/price-alerts/price-alerts.constants.ts:46` |
| 3 | **Khoá lượt không kiểm tra chủ sở hữu.** `runLockToken` được tạo ra nhưng không dùng: `releaseRunLock` chạy `DEL` vô điều kiện. Nếu một lượt chạy lâu hơn 120 giây (xem #1), nó sẽ xoá khoá của lượt sau, và hai lượt có thể chạy chồng nhau. Lúc đó AC14 có thể bị vi phạm. Trường hợp này hiếm, nhưng nó chính là kiểu sự cố #1 gây ra. `implement.md` §6 đã tự khai điểm này. | Low–Medium | `src/price-alerts/price-alerts.service.ts:64,192-194` |
| 4 | **Quota CoinGecko không được so với giới hạn tháng (Concern 7).** Khi có ít nhất 1 cảnh báo, bộ kiểm tra gọi CoinGecko mỗi phút, khoảng 43.200 lần/tháng; cache 30 giây không giúp được với chu kỳ 60 giây. Nếu production đặt `COINGECKO_API_KEY` gói Demo (giới hạn tháng khoảng 10.000 call theo hiểu biết của verifier, cần owner xác nhận), quota sẽ hết sau khoảng 1 tuần và `/gia` bắt đầu lỗi, tức là vi phạm NFR03. Plan §7 chỉ viết "đủ nhỏ so với giới hạn free" mà không đưa ra con số như Concern 7 yêu cầu. | Medium (phụ thuộc cấu hình production) | `src/price-alerts/price-alerts.controller.ts:109-113`, `plan.md` §7 |
| 5 | **`chat.id` dài hơn 64 ký tự trả `400` trên `/webhook`**, trong khi spec §2 viết "`/webhook*` luôn trả `200`", và bot im lặng với chat đó. Đây là hợp đồng validation DTO đã có sẵn (`docs/API.md:76`, `all-exceptions.filter.ts:44`), đã được ghi trong `implement.md` §4 mục 1 và có test e2e. NFR06 được đáp ứng (bị từ chối, không lưu gì). Id thật chỉ dài 20 ký tự, nên ảnh hưởng thực tế rất nhỏ. Tuy vậy nên sửa câu chữ trong spec cho khớp. | Low | `src/webhook/dto/zalo-webhook.dto.ts`, `test/webhook.e2e-spec.ts:348` |
| 6 | **Mức giá hiển thị bị làm tròn tới 6 chữ số lẻ, dù parser chấp nhận 8.** Ví dụ `/canhbao shib < 0.00001234` được xác nhận là `SHIB < $0.000012`, còn mức `0.0000000123` hiển thị thành `$0.00` (verifier đã chạy thử `Intl.NumberFormat`). Người dùng thấy một điều kiện khác với điều kiện thật được lưu. | Low | `src/utils/format-message.util.ts:4-9` (`formatAlertCondition`) |
| 7 | **`driftMs = startedAt % 60000` không có dấu.** Một lượt tới sớm 100 ms (lúc :59.9) bị ghi thành drift 59.900 ms. Chỉ số NFR08 này dễ gây hiểu nhầm; AC18 không bị ảnh hưởng vì dùng khoảng cách tính từ `startedAt`. | Low | `src/price-alerts/price-alerts.controller.ts:74` |
| 8 | **Gửi thành công nhưng `updateState` lỗi (Redis chập chờn) thì cảnh báo vẫn armed**, và lượt sau gửi lại, vi phạm FR07 trong trường hợp hiếm này. Test `marks a delivered alert fired even if the delivery log write then fails` chỉ bao trường hợp ghi log lỗi. | Low | `src/price-alerts/price-alerts.controller.ts:141-153` |
| 9 | **Kiểm chứng:** mọi test name và số liệu mà `implement.md` §3 đưa ra đều khớp với lần chạy của verifier (123 unit, 20+5 e2e, 5 integration). Riêng phần chạy đầu cuối bằng `node dist/main` thì verifier không tái hiện. | Info | `implement.md` §3 |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. Deploy lên production, bật job cron-job.org, chờ 24 giờ, rồi chạy `npm run alerts:report` và ghi lại kết quả: p95 khoảng cách giữa các lượt ≤ 90 giây thì AC18 chuyển sang pass. Đây là thay đổi duy nhất bắt buộc để lật verdict.
2. (Khuyến nghị, không bắt buộc để lật verdict) Trước hoặc cùng lúc deploy: owner xác nhận production có đặt `COINGECKO_API_KEY` gói Demo hay không (finding #4); engineer lên kế hoạch cho finding #1, #2 và #3 qua `plan.md`: giới hạn thời gian mỗi lượt hoặc gửi song song có giới hạn; backoff hoặc không ghi log trùng cho chat gửi lỗi liên tục; release khoá theo token.
