# Verification Report — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 2)
**Created:** `2026-09-23`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 2**, kiểm lại trên HEAD `40eda89` (các commit `5469af2` + `40eda89`).
> **Rev 1** (HEAD `0bf89ed`) ra kết quả 18/19 pass, AC18 untested, và 8 finding: (1) NFR02 có nguy cơ vỡ vì gửi tuần tự, mỗi lần timeout 8 giây; (2) log gửi thất bại đẩy mất log gửi thành công; (3) khoá lượt không kiểm tra chủ sở hữu; (4) quota CoinGecko chưa được so với giới hạn tháng; (5) `chat.id` dài hơn 64 ký tự trả `400`; (6) mức giá nhỏ hiển thị thành `$0.00`; (7) `driftMs` không có dấu; (8) gửi trùng nếu `updateState` lỗi sau khi đã gửi thành công.
> Rev 2 kiểm độc lập từng bản sửa trong `implement.md` §4 mục 7–12. Kết quả ở §6.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 17/19 pass, 1 fail (`EPIC-002-AC13`), 1 untested (`EPIC-002-AC18`).

- **AC13 fail** vì code giờ lệch khỏi câu chữ của spec, không phải vì lỗi chức năng. Backoff 5 phút (bản sửa cho finding #2 của rev 1) khiến lượt kế tiếp **không** thử gửi lại. Trong khi đó AC13 và spec §3.2 ghi rõ "lượt sau thử gửi lại". Hành vi mới hợp lý, nhưng nó đổi hợp đồng. Cần sửa spec (PO/originator duyệt) hoặc bỏ backoff.
- **AC18 untested** vì chỉ đo được sau 24 giờ chạy production. Việc này không làm được trước deploy, và không phải lỗi của build.

## 2. Acceptance criteria

Mọi lệnh bên dưới do verifier tự chạy trên HEAD `40eda89`, ngày 2026-09-23. `unit` = `npx jest --verbose` (129/129 pass). `e2e` = `npm run test:e2e -- --verbose` (20 pass, 5 skip). `integration` = `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --verbose price-alerts.redis` (5/5 pass), chạy với Redis thật (`redis:7-alpine` + `hiett/serverless-redis-http`). Container và network đã được xoá sau khi chạy.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-002-AC01` | BTC = 95.000, `/canhbao btc > 100000` → tạo, xác nhận kèm số thứ tự, điều kiện, giá hiện tại | pass | e2e `√ creates an alert and confirms with its position and current price (AC01)`; unit `√ writes the alert key and both id sets, and returns its list position (AC01)`; integration `√ creates, lists and deletes per chat without touching other chats (AC01, AC11)`. |
| `EPIC-002-AC02` | Giá 100.200 → đúng 1 tin chứa BTC, `> 100,000`, giá hiện tại; chuyển "đã báo" | pass | unit `√ fires a crossed alert: one message, state -> fired, delivery recorded (AC02, AC17)` (1 lần `sendTextMessage`, text chứa `BTC > $100,000.00` và `$100,200.00`, `state: 'fired'`). Ghi chú: chuỗi hiển thị là `> $100,000.00`; đúng về nghĩa. |
| `EPIC-002-AC03` | "Đã báo", 100.500 / 101.000 → không gửi thêm | pass | unit `√ does not fire again while a fired alert stays past the threshold (AC03)`. |
| `EPIC-002-AC04` | 99.800 chưa bật lại; 99.400 bật lại, không gửi; 100.100 sau > 15 phút → báo lần 2 | pass | unit `√ re-arms only once price is back past the 0.5% buffer, then fires again after the cooldown (AC04)`, `√ re-arms exactly at the buffer boundary`, controller `√ re-arms silently without sending (AC04)`. |
| `EPIC-002-AC05` | Vượt lại lúc T+5 → không gửi; chỉ gửi từ T+15 | pass | unit `√ holds a re-armed alert inside the 15-minute cooldown, then fires (AC05)`. |
| `EPIC-002-AC06` | `eth < 2000`, ETH = 1.990 → báo; đối xứng | pass | unit `√ handles "below" alerts symmetrically (AC06)`. |
| `EPIC-002-AC07` | BTC = 110.000 → không tạo, trả lời kèm giá hiện tại | pass | unit `√ rejects a condition that is already met, writing nothing (AC07)`; e2e `√ replies with the current price when the condition is already met (AC07)`. |
| `EPIC-002-AC08` | `100k`, thiếu toán tử, `-5`, 9 chữ số lẻ → từ chối kèm ví dụ; `100,000` = 100000 | pass | unit parser `rejects "%s" as ALERT_INVALID (AC08, NFR06)` (10 case), `treats "," as a thousands separator (AC08)`; e2e `√ rejects invalid syntax with an example, without creating anything (AC08)`. |
| `EPIC-002-AC09` | Coin không tồn tại → thông báo giống `/gia` | pass | e2e `√ replies like /gia for an unknown coin (AC09)`; unit `√ lets UnknownCoinSymbolsError through unchanged, like /gia (AC09)`. |
| `EPIC-002-AC10` | Cái thứ 11 → từ chối, nêu giới hạn 10 và cách xoá | pass | integration `√ rejects the 11th alert of a chat (AC10)`; unit `√ rejects an 11th alert without looking up the price (AC10)`. |
| `EPIC-002-AC11` | List/xoá theo chat; `xoa 99` → không tìm thấy | pass | integration `√ creates, lists and deletes per chat without touching other chats (AC01, AC11)`; e2e `√ lists and deletes the chat own alerts, and reports a missing position (AC11)`. |
| `EPIC-002-AC12` | Nguồn giá lỗi/timeout → không gửi, không đổi trạng thái, `200` | pass | unit `√ sends nothing and changes no state when the price source is down (AC12)`. |
| `EPIC-002-AC13` | Gửi chat 1 lỗi → chat 2 vẫn nhận; cảnh báo chat 1 vẫn canh và **lượt sau thử gửi lại** | fail | Phần cô lập lỗi và "vẫn canh" pass: unit `√ keeps going after a failed send, leaving that alert armed for a retry (AC13)` (chat 2 được gửi; id 1 vẫn `state: 'armed'` kèm `lastFailedAt`). Phần "lượt sau thử gửi lại" **không** còn đúng: unit `√ backs off 5 minutes after a failed send before retrying (AC13)` xác nhận T+1 và T+4,9 phút → `none`, chỉ T+5 → `fire` (`price-alert-evaluator.ts:35-39`, `ALERT_RETRY_BACKOFF_MS = 5 * 60_000`). Với chu kỳ 1 phút, 4 lượt kế tiếp đều bỏ qua cảnh báo này. Hệ quả: khi Zalo lỗi thoáng qua, tin tới trễ ≥ 5 phút, vượt ngân sách 2 phút của NFR01 trong trường hợp đó. |
| `EPIC-002-AC14` | 2 lượt đồng thời → tối đa 1 tin | pass | unit `√ skips the whole run when another run holds the lock (AC14)`, `√ releases the run lock with a compare-and-delete on its own token (AC14)`; integration `√ lets only one run hold the lock at a time (AC14)` (token lạ không xoá được khoá), `√ never resurrects an alert deleted mid-run: updateState uses SET XX (AC14)`. Verifier tự chạy thêm trên Redis thật: 4 lệnh `SET NX` song song → `["OK",null,null,null]`; `EVAL` với token lạ → `0`, khoá vẫn còn; `EVAL` với token của holder → `1`, khoá hết. |
| `EPIC-002-AC15` | 50 cảnh báo / 5 coin → nguồn giá ≤ 2 lần | pass | unit `√ looks up prices once for all distinct coins, however many alerts (AC15)`; code `coingecko.service.ts:77,102` cho thấy tối đa 1 request CoinGecko + 1 request CoinPaprika. |
| `EPIC-002-AC16` | Không có / sai secret → `401`, không đánh giá gì | pass | e2e `√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)`. |
| `EPIC-002-AC17` | Bản ghi lần gửi truy vấn được; mỗi lượt 1 dòng log NFR08 | pass | unit `(AC02, AC17)`, `√ logs failed deliveries separately so they cannot evict successful ones (FR12)`; integration `√ keeps delivery and run logs readable and capped (AC17)` (đọc lại được cả `deliveries` lẫn `delivery-failures`). Dòng log: `price-alerts.controller.ts:47` (`JSON.stringify({ event: 'price-alert-run', ...summary })`), giờ có thêm `deferred`. |
| `EPIC-002-AC18` | Production 24 giờ: p95 khoảng cách giữa các lượt ≤ 90 giây | untested | Chưa deploy. Chỉ kiểm được sau deploy bằng `npm run alerts:report` (`docs/DEPLOYMENT.md` bước 8a.4). Không làm được trước deploy và không phải lỗi build. Verifier không gọi production. |
| `EPIC-002-AC19` | `/huy` → cảnh báo vẫn còn và vẫn chạy | pass | e2e `√ leaves alerts alone when the chat unsubscribes from the digest (AC19)`; `runCheck` dùng `listAll()` và không lọc theo subscriber. |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| AC01–AC17, AC19: unit / e2e theo `plan.md` §5 | Có (verifier chạy lại trên `40eda89`) | pass, trừ AC13 (lệch spec, xem §2) |
| AC10, AC11, AC14, AC17: integration Redis thật | Có (Docker; giờ gồm cả `EVAL`) | 5/5 pass |
| AC18: quan sát production 24 giờ | Không (chưa deploy) | untested |
| §6 Feedback loop: lint, unit, e2e, build | Có | Cả 4 đều exit 0 (xem §4) |
| §6 Đầu cuối cục bộ (`start:dev` + `curl`) | Không (thiếu `.env` đủ biến; không gọi production) | Không xác nhận độc lập; không AC nào phụ thuộc vào proof này |
| Proof mới ở rev 2: NFR02 send budget, signed drift | Có | unit `√ defers remaining sends once the 6s send budget is spent, keeping the run under 15s (NFR02)`, `√ records drift signed from the nearest minute (100ms early -> -100)` |

## 4. Regressions

```
$ npm run lint
EXIT 0            (git status sau đó sạch: --fix không sửa file nào)

$ npx jest --verbose
Test Suites: 10 passed, 10 total
Tests:       129 passed, 129 total
EXIT 0

$ npm run test:e2e -- --verbose
Test Suites: 1 skipped, 1 passed, 1 of 2 total
Tests:       5 skipped, 20 passed, 25 total
EXIT 0

$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local \
    npx jest --config ./test/jest-e2e.json --verbose price-alerts.redis
  √ creates, lists and deletes per chat without touching other chats (AC01, AC11) (238 ms)
  √ rejects the 11th alert of a chat (AC10) (112 ms)
  √ never resurrects an alert deleted mid-run: updateState uses SET XX (AC14) (38 ms)
  √ lets only one run hold the lock at a time (AC14) (28 ms)
  √ keeps delivery and run logs readable and capped (AC17) (5328 ms)
Tests:       5 passed, 5 total

$ npm run build
EXIT 0
```

Các test cũ (`/gia`, `/dangky`, `/huy`, `/watchlist`, digest, guard) đều vẫn xanh.

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Rev 2 không thêm tính năng mới. Kết luận của rev 1 vẫn giữ nguyên: không có cảnh báo %/VND/`100k`, không có lệnh sửa cảnh báo, không có chế độ báo một lần, digest và `vercel.json` không đổi. Backoff và list log lỗi riêng chỉ là thay đổi triển khai. Tuy vậy, backoff có đổi một hành vi mà spec đã ghi rõ (AC13, xem §2). Rev 2 cũng dùng Lua `EVAL`, trái với plan §7 ("không dùng Lua"); `implement.md` §4 mục 9 đã ghi đây là amendment.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Backoff 5 phút làm AC13 và spec §3.2 không còn đúng ("lượt sau thử gửi lại"),** đồng thời một lỗi Zalo thoáng qua làm tin trễ ≥ 5 phút, vượt NFR01. Muốn pass thì cần một trong hai: PO/originator sửa spec (AC13, §3.2, có thể thêm FR mới về backoff), hoặc chỉ bật backoff sau N lần gửi lỗi liên tiếp. | Medium (lệch hợp đồng) | `src/price-alerts/price-alert-evaluator.ts:35-39`, `src/price-alerts/price-alerts.constants.ts` (`ALERT_RETRY_BACKOFF_MS`) |
| 2 | **Ngân sách gửi tính từ `startedAt`, tức là tính cả thời gian tra giá.** Nếu CoinGecko trả chậm hơn 6 giây (timeout của nó là 8 giây), **mọi** cảnh báo tới hạn đều bị hoãn, và cứ thế ở mọi lượt chừng nào CoinGecko còn chậm. Lúc đó hệ thống không gửi được tin nào dù đã có giá. Chưa có test cho trường hợp này. Nên đo ngân sách từ lúc có giá, hoặc luôn cho phép ít nhất một lần gửi. | Low–Medium | `src/price-alerts/price-alerts.controller.ts:141-145` |
| 3 | **NFR02 vẫn chưa bị chặn cứng.** Riêng phần tra giá đã có thể mất 8 giây (CoinGecko) + 8 giây (CoinPaprika) = 16 giây. Ngoài ra `timeout` của axios trên Node không bao phần DNS/connect một cách chặt chẽ. Trường hợp thường là 1 lần gửi bắt đầu trước giây thứ 6 cộng 8 giây, khoảng 14 giây, nên vừa trong ngưỡng. Nên xem `durationMs` p95 trong `alerts:report` sau deploy. | Low | `src/coingecko/coingecko.service.ts:143`, `src/coinpaprika/coinpaprika.service.ts` |
| 4 | **Rev 1 #2 (log gửi thất bại đẩy mất log thành công): đã đóng.** Log thành công và thất bại nằm ở hai list riêng (`price-alerts:delivery-failures`). Kết hợp backoff, một chat lỗi mãi chỉ sinh khoảng 288 bản ghi mỗi ngày trong list lỗi, và không động tới list thành công. Kiểm bằng unit và integration. | Closed | `src/price-alerts/price-alerts.service.ts` (`recordDelivery`) |
| 5 | **Rev 1 #3 (khoá không kiểm tra chủ sở hữu): đã đóng.** Mỗi lượt có token riêng, được mở bằng Lua compare-and-delete. Verifier kiểm trên Redis thật: token lạ → `0`, khoá vẫn còn; token đúng → `1`. | Closed | `src/price-alerts/price-alerts.service.ts` (`RELEASE_LOCK_SCRIPT`, `acquireRunLock`, `releaseRunLock`) |
| 6 | **Rev 1 #1 (NFR02): phần lớn đã đóng.** Có `RUN_SEND_BUDGET_MS = 6000` và trường `deferred`, test với đồng hồ giả pass. Phần còn lại nằm ở finding #2 và #3. | Partly closed | `src/price-alerts/price-alerts.controller.ts:141-145` |
| 7 | **Rev 1 #6 và #7: đã đóng.** Test `√ shows tiny thresholds with all 8 decimals instead of $0.00` pass. `driftMs` có dấu: test `√ records drift signed from the nearest minute (100ms early -> -100)` pass. | Closed | `src/utils/format-message.util.ts` (`ALERT_THRESHOLD_FORMATTER`), `price-alerts.controller.ts` (`signedMinuteDrift`) |
| 8 | **Rev 1 #4 (quota CoinGecko): đóng có điều kiện.** Engineer cho biết production không đặt `COINGECKO_API_KEY`; verifier không truy cập Vercel nên không tự xác nhận được. API công khai không có hạn mức tháng, và bộ kiểm tra chỉ tốn khoảng 1 call/phút trong giới hạn tần suất của API công khai (khoảng 5–30 call/phút, tính theo IP, có thể dùng chung IP egress với các tenant Vercel khác). Mức đó chấp nhận được với NFR03. Nếu sau này ai đó thêm key gói Demo thì giới hạn tháng khoảng 10k sẽ quay lại, và `docs/DEPLOYMENT.md` chưa cảnh báo điều này. | Low | `docs/DEPLOYMENT.md`, `.env.example:43-45` |
| 9 | **Rev 1 #5 (`chat.id` quá 64 ký tự trả `400`) và #8 (gửi trùng hiếm gặp khi `updateState` lỗi): được chấp nhận, không sửa** (`implement.md` §4 mục 1 và §6). Verifier đồng ý cả hai đều không chặn deploy. | Low (accepted) | `src/webhook/dto/zalo-webhook.dto.ts`, `price-alerts.controller.ts:150-157` |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. **AC13:** PO/originator sửa `spec.md` AC13 và §3.2 thành "thử gửi lại sau tối thiểu 5 phút" (chỉ sửa tài liệu), hoặc engineer bỏ backoff ở lần lỗi đầu tiên. Sau đó verifier kiểm lại AC13.
2. **AC18:** deploy, chạy 24 giờ, rồi `npm run alerts:report` phải cho p95 khoảng cách giữa các lượt ≤ 90 giây.
3. (Khuyến nghị, không bắt buộc để lật verdict) Sửa finding #2: tính ngân sách gửi từ lúc đã có giá. Thêm một dòng vào `docs/DEPLOYMENT.md` về giới hạn tháng của key Demo (finding #8).
