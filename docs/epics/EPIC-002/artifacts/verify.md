# Verification Report — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 3)
**Created:** `2026-09-23`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 3**, kiểm lại trên HEAD `f1d81cb`, đối chiếu với `implement.md` §4 mục 13–15.
> **Rev 1** (`0bf89ed`) ra kết quả 18/19 pass, AC18 untested. Rev 1 có 8 finding: NFR02 có nguy cơ vỡ vì gửi tuần tự, log gửi thất bại đẩy mất log thành công, khoá không kiểm tra chủ sở hữu, quota CoinGecko chưa được so với giới hạn tháng, `chat.id` quá 64 ký tự trả `400`, mức giá nhỏ hiển thị `$0.00`, `driftMs` không có dấu, và gửi trùng hiếm gặp.
> **Rev 2** (`40eda89`) ra kết quả 17/19. Các bản sửa của rev 1 được xác nhận, nhưng AC13 fail vì backoff 5 phút khiến lượt kế tiếp không thử gửi lại nữa. Rev 2 cũng thấy ngân sách gửi bị tính cả thời gian tra giá, và DEPLOYMENT.md chưa cảnh báo về key Demo.
> Rev 3 kiểm độc lập ba bản sửa cho các điểm đó.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 18/19 pass, 0 fail, 1 untested (`EPIC-002-AC18`).

Theo luật của skill, verdict là fail chỉ vì AC18. AC18 cần 24 giờ quan sát trên production, nên không thể kiểm trước deploy, và đây không phải lỗi của build. Về mặt kỹ thuật, không còn gì chặn deploy. Chạy AC18 sau deploy mà đạt thì verdict chuyển sang pass.

## 2. Acceptance criteria

Mọi lệnh bên dưới do verifier tự chạy trên HEAD `f1d81cb`, ngày 2026-09-23:
- `unit` = `npx jest --verbose`: 131/131 pass.
- `e2e` = `npm run test:e2e -- --verbose`: 20 pass, 5 skip.
- `integration` là lần chạy với Redis thật ở rev 2 (5/5 pass, gồm cả `EVAL`). Từ `40eda89` tới `f1d81cb`, `price-alerts.service.ts` và `test/price-alerts.redis.e2e-spec.ts` không đổi (`git diff 40eda89..HEAD --stat`), nên rev 3 không chạy lại phần này.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-002-AC01` | BTC = 95.000, `/canhbao btc > 100000` → tạo, xác nhận kèm số thứ tự, điều kiện, giá hiện tại | pass | e2e `√ creates an alert and confirms with its position and current price (AC01)`; unit `√ writes the alert key and both id sets, and returns its list position (AC01)`; integration (rev 2) `√ creates, lists and deletes per chat without touching other chats (AC01, AC11)`. |
| `EPIC-002-AC02` | Giá 100.200 → đúng 1 tin chứa BTC, `> 100,000`, giá hiện tại; chuyển "đã báo" | pass | unit `√ fires a crossed alert: one message, state -> fired, delivery recorded (AC02, AC17)`. Text chứa `BTC > $100,000.00` và `$100,200.00`; nội dung đúng về nghĩa. |
| `EPIC-002-AC03` | "Đã báo", 100.500 / 101.000 → không gửi thêm | pass | unit `√ does not fire again while a fired alert stays past the threshold (AC03)`. |
| `EPIC-002-AC04` | 99.800 chưa bật lại; 99.400 bật lại, không gửi; 100.100 sau > 15 phút → báo lần 2 | pass | unit `√ re-arms only once price is back past the 0.5% buffer, then fires again after the cooldown (AC04)`, `√ re-arms silently without sending (AC04)`. |
| `EPIC-002-AC05` | Vượt lại lúc T+5 → không gửi; chỉ gửi từ T+15 | pass | unit `√ holds a re-armed alert inside the 15-minute cooldown, then fires (AC05)`. |
| `EPIC-002-AC06` | `eth < 2000`, ETH = 1.990 → báo; đối xứng | pass | unit `√ handles "below" alerts symmetrically (AC06)`. |
| `EPIC-002-AC07` | BTC = 110.000 → không tạo, trả lời kèm giá hiện tại | pass | unit `√ rejects a condition that is already met, writing nothing (AC07)`; e2e `√ replies with the current price when the condition is already met (AC07)`. |
| `EPIC-002-AC08` | Cú pháp sai → từ chối kèm ví dụ; `100,000` = 100000 | pass | unit parser `rejects "%s" as ALERT_INVALID (AC08, NFR06)` (10 case), `treats "," as a thousands separator (AC08)`; e2e `√ rejects invalid syntax with an example, without creating anything (AC08)`. |
| `EPIC-002-AC09` | Coin không tồn tại → thông báo giống `/gia` | pass | e2e `√ replies like /gia for an unknown coin (AC09)`. |
| `EPIC-002-AC10` | Cái thứ 11 → từ chối, nêu giới hạn 10 và cách xoá | pass | unit `√ rejects an 11th alert without looking up the price (AC10)`; integration (rev 2) `√ rejects the 11th alert of a chat (AC10)`. |
| `EPIC-002-AC11` | List/xoá theo chat; `xoa 99` → không tìm thấy | pass | e2e `√ lists and deletes the chat own alerts, and reports a missing position (AC11)`; integration (rev 2). |
| `EPIC-002-AC12` | Nguồn giá lỗi/timeout → không gửi, không đổi trạng thái, `200` | pass | unit `√ sends nothing and changes no state when the price source is down (AC12)`. |
| `EPIC-002-AC13` | Gửi chat 1 lỗi → chat 2 vẫn nhận; cảnh báo chat 1 vẫn canh và lượt sau thử gửi lại | pass | unit `√ retries a failed send on the very next run (AC13)` (`consecutiveFailures` 1 và 2 → `fire` ở T+1 phút); `√ keeps going after a failed send, leaving that alert armed for a retry (AC13)` (chat 2 được gửi; id 1 vẫn `armed`, `consecutiveFailures: 1`; id 2 được reset về `0`); `√ backs off 5 minutes only after 3 failures in a row`. Code: `price-alert-evaluator.ts:37-40`, backoff chỉ áp dụng khi `consecutiveFailures >= 3`. Finding AC13 của rev 2 đã đóng. |
| `EPIC-002-AC14` | 2 lượt đồng thời → tối đa 1 tin | pass | unit `√ skips the whole run when another run holds the lock (AC14)`, `√ releases the run lock with a compare-and-delete on its own token (AC14)`. Integration và phép thử `SET NX`/`EVAL` trên Redis thật ở rev 2 vẫn còn giá trị, vì service không đổi. |
| `EPIC-002-AC15` | 50 cảnh báo / 5 coin → nguồn giá ≤ 2 lần | pass | unit `√ looks up prices once for all distinct coins, however many alerts (AC15)`. |
| `EPIC-002-AC16` | Không có / sai secret → `401`, không đánh giá gì | pass | e2e `√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)`. |
| `EPIC-002-AC17` | Bản ghi lần gửi truy vấn được; mỗi lượt 1 dòng log NFR08 | pass | unit `(AC02, AC17)`, `√ logs failed deliveries separately so they cannot evict successful ones (FR12)`; integration (rev 2) `√ keeps delivery and run logs readable and capped (AC17)`; dòng log ở `price-alerts.controller.ts:47`. |
| `EPIC-002-AC18` | Production 24 giờ: p95 khoảng cách giữa các lượt ≤ 90 giây | untested | Chưa deploy. Chỉ đo được sau deploy bằng `npm run alerts:report` (`docs/DEPLOYMENT.md` bước 8a). Việc này không làm được trước deploy, và không phải lỗi build. |
| `EPIC-002-AC19` | `/huy` → cảnh báo vẫn còn và vẫn chạy | pass | e2e `√ leaves alerts alone when the chat unsubscribes from the digest (AC19)`. |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| AC01–AC17, AC19: unit / e2e theo `plan.md` §5 | Có (chạy lại trên `f1d81cb`) | pass |
| AC10, AC11, AC14, AC17: integration Redis thật | Có ở rev 2; rev 3 không chạy lại vì service layer không đổi | 5/5 pass (rev 2) |
| AC18: quan sát production 24 giờ | Không (chưa deploy) | untested |
| §6 Feedback loop: lint, unit, e2e, build | Có | Cả 4 đều exit 0 (xem §4) |
| §6 Đầu cuối cục bộ (`start:dev` + `curl`) | Không (thiếu `.env`; không gọi production) | Không có AC nào phụ thuộc vào proof này |
| Proof mới ở rev 3 | Có | `√ retries a failed send on the very next run (AC13)`, `√ backs off 5 minutes only after 3 failures in a row`, `√ does not count a slow price lookup against the send budget` |

## 4. Regressions

```
$ npm run lint
EXIT 0            (git status sạch sau đó)

$ npx jest --verbose
Test Suites: 10 passed, 10 total
Tests:       131 passed, 131 total
EXIT 0

$ npm run test:e2e -- --verbose
Test Suites: 1 skipped, 1 passed, 1 of 2 total
Tests:       5 skipped, 20 passed, 25 total
EXIT 0

$ npm run build
EXIT 0
```

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Rev 3 chỉ đổi logic thử gửi lại và điểm bắt đầu của ngân sách gửi, cộng một cảnh báo trong tài liệu. Không có tính năng nào mới.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **NFR02 vẫn chưa bị chặn cứng, nhưng giờ là một trade-off có chủ đích.** Ngân sách gửi giờ bắt đầu sau khi tra giá, nên riêng phần gửi tối đa khoảng 14 giây. Lượt đầy đủ vẫn có thể vượt 15 giây khi nguồn giá chậm: tra giá tối đa 8 + 8 giây, cộng phần gửi khoảng 14 giây. Hệ quả chỉ là lượt đó chậm; TTL khoá 120 giây vẫn dư. Nên theo dõi `durationMs` p95 trong `alerts:report` sau deploy. | Low | `src/price-alerts/price-alerts.controller.ts:80-82` |
| 2 | **Rev 2 #1 (AC13): đã đóng.** Lần lỗi thứ 1 và thứ 2 được thử lại ngay ở lượt kế tiếp. Từ lần lỗi thứ 3 liên tiếp, cảnh báo chỉ thử lại mỗi 5 phút. Gửi thành công thì bộ đếm reset về 0. Với một chat đã chặn bot, số bản ghi lỗi vẫn ở mức khoảng 290 mỗi ngày trong list lỗi riêng. | Closed | `src/price-alerts/price-alert-evaluator.ts:37-40`, `price-alerts.controller.ts:157-172` |
| 3 | **Rev 2 #2 (ngân sách gửi tính cả thời gian tra giá): đã đóng.** `sendsStartedAt` được lấy sau `loadPrices`. Test `√ does not count a slow price lookup against the send budget` cho thấy khi tra giá mất 7 giây, cả 2 tin vẫn được gửi (`deferred: 0`). | Closed | `src/price-alerts/price-alerts.controller.ts:82,145` |
| 4 | **Rev 1 #4 (quota CoinGecko): đã đóng.** `docs/DEPLOYMENT.md` bước 8a giờ có cảnh báo về key Demo. Coordinator cho biết đã tự xem Vercel dashboard: chỉ có `COINGECKO_API_BASE_URL` và `COINGECKO_CACHE_TTL_SECONDS`, không có `COINGECKO_API_KEY`. Đây là thông tin nhận lại; verifier không truy cập Vercel. | Closed | `docs/DEPLOYMENT.md` |
| 5 | **Còn lại từ rev 1, đã được chấp nhận:** `chat.id` quá 64 ký tự trả `400` (hợp đồng DTO có sẵn), và gửi trùng hiếm gặp nếu `updateState` lỗi ngay sau khi gửi thành công. Cả hai không chặn deploy. | Low (accepted) | `src/webhook/dto/zalo-webhook.dto.ts`, `price-alerts.controller.ts` |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. Deploy lên production, bật job cron-job.org và chờ 24 giờ. Sau đó chạy `npm run alerts:report`: nếu p95 khoảng cách giữa các lượt ≤ 90 giây thì AC18 pass và verdict chuyển sang pass (19/19). Không cần thay đổi code nào.
