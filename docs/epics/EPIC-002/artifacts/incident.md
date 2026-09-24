# Incident — Kiểm tra cảnh báo giá gần như không chạy sau deploy

**Epic ID:** `EPIC-002`
**Operator:** Operator (stage 6)
**Status:** Draft
**Created:** `2026-09-24`

---

## 1. Signal

> *The five fields, as received. Quoted, not paraphrased — later sources fill the
> same shape and these reports have to stay comparable.*

Nguồn: `docs/epics/EPIC-002/signal.json`, lấy từ lần owner chạy `npm run alerts:report` (lệnh chỉ đọc) trên production, khoảng 32 giờ sau khi deploy.

| Field | Value |
|---|---|
| `source` | manual |
| `observedAt` | 2026-09-24T15:10:00Z |
| `symptom` | Kiểm tra cảnh báo giá chỉ ghi nhận 2 lượt chạy trong ~32 giờ sau deploy, thay vì ~1 lượt/phút; khoảng cách p95 giữa các lượt là 115574.4s so với yêu cầu AC18 ≤ 90s. |
| `scope` | Toàn bộ tính năng cảnh báo giá trên production: 2 cảnh báo đang active, 0 lần gửi được ghi nhận, kể từ deploy 2026-09-23. |
| `evidence` | `Active alerts: 2` / `Runs logged: 2 (2026-09-23T06:55:42.247Z -> 2026-09-24T15:01:56.664Z)` / `Gap between runs: p50 115574.4s, p95 115574.4s, max 115574.4s  [AC18: p95 <= 90s]` / `Run duration: p95 1.0s, max 1.0s  [NFR02: <= 15s]` / `Totals over logged runs: fired 0, failed 0, rearmed 0, deferred 0` / `Deliveries logged: 0 delivered, 0 failed` |

## 2. What happened

Từ lúc deploy (2026-09-23) đến 2026-09-24T15:01Z, run log `price-alerts:runs` chỉ có **2** lượt kiểm tra hoàn tất. Với lịch mỗi phút, đáng lẽ phải có khoảng 1.900 lượt. Log giữ tối đa 1.440 mục (`MAX_RUN_LOG_ENTRIES`), nên con số 2 không phải do log bị cắt bớt. Hai lượt ghi được đều chạy khoảng 1 giây và không gửi cảnh báo nào. Suốt ~32 giờ này có 2 cảnh báo đang active. Không có báo động nào kêu, và không ai biết cho tới khi owner tự chạy report.

Kết luận: **AC18 fail** (p95 115574.4s so với yêu cầu ≤ 90s). NFR02 pass trên 2 mẫu này (1.0s ≤ 15s), nhưng 2 mẫu là quá ít để kết luận.

## 3. Why it happened

**Confidence:** confirmed (nguyên nhân gốc, owner xác nhận 2026-09-24) · confirmed (lý do chuyện này xảy ra mà không ai hay)

**Nguyên nhân gốc (confirmed, owner xác nhận 2026-09-24):** job cron-job.org được cấu hình **sai URL**, nên không lượt gọi nào tới được `/cron/price-alerts`. Gần nhất với H1 (job không gọi đúng endpoint). Owner đã sửa URL ngày 2026-09-24 và job đang chờ được bật lại. Việc đo lại AC18 trong 24h được theo dõi tự động từ phiên làm việc này.

**Confirmed: report không phân biệt được lượt "không được gọi" với lượt "được gọi nhưng hỏng".** `src/price-alerts/price-alerts.controller.ts:33-64` chỉ gọi `recordRun` khi đủ ba điều kiện: (1) request qua được `PriceAlertsCronSecretGuard`, (2) lấy được run lock, (3) `runCheck` không throw. Request sai secret sẽ bị trả 401 trước khi vào handler. Lượt không lấy được lock thì `return` sớm. Lượt throw thì rơi vào `catch`, chỉ ghi `logger.error`. Cả ba trường hợp đều trả 200 hoặc 401 và **không để lại dấu vết** trong Redis. Vì vậy chỉ riêng `alerts:report` không cho biết được nguyên nhân.

Các giả thuyết ban đầu, giữ lại để đối chiếu (H1 đúng về bản chất: sai URL; H2 và H3 bị loại):

| # | Giả thuyết | Bằng chứng ủng hộ | Cách xác nhận |
|---|---|---|---|
| H1 | Job cron-job.org chưa được tạo, đang tắt, hoặc chưa được bật lại sau đợt verify | `epic-memory.json` (2026-09-23) ghi "Use npm run alerts:report + Vercel Usage **after re-enabling cron-job.org**". Theo ghi chép thì job đã có lúc bị tắt, và không có entry nào ghi là đã bật lại. Lượt đầu (06:55:42Z) khớp với lần smoke test thủ công trong ghi chép deploy | Mở cron-job.org → job → trạng thái Enabled + Execution history |
| H2 | Job có chạy nhưng gửi sai header hoặc secret, bị trả 401 | Ở review should-fix #1, secret đã được đổi từ `CRON_SECRET_TOKEN` sang `PRICE_ALERTS_CRON_SECRET` (`8699422`). Một job tạo theo hướng dẫn cũ sẽ mang secret của digest và bị từ chối (e2e đã chứng minh: secret của digest → 401) | Execution history của cron-job.org: toàn mã 401? |
| H3 | Job có gọi, qua được guard, nhưng `runCheck` throw ở gần như mọi lượt (vd. CoinGecko keyless trả 429, hoặc lỗi Redis) | Production không có `COINGECKO_API_KEY` (`docs/DEPLOYMENT.md` §8a). Lỗi throw bị nuốt ở `catch` và không ghi run | Vercel → Logs, lọc `Price-alert check failed` |

Lượt thứ hai (2026-09-24T15:01:56Z) diễn ra khoảng 5 phút trước khi owner pull env (~15:06Z). Có thể đó là lần gọi thủ công hoặc job vừa được bật. Hiện chưa rõ.

| | |
|---|---|
| Code | `src/price-alerts/price-alerts.controller.ts:40-50` (chỉ ghi run khi lượt thành công) |
| Introduced by | Cấu hình tay trên cron-job.org lúc deploy (không phải code). Khoảng trống quan sát có từ EPIC-002 implement (`3e51687..44a0087`) |
| Specified in | `spec.md` NFR08 / AC18 (đo khoảng cách giữa các lượt); không có yêu cầu nào về việc phát hiện hay báo động khi các lượt ngừng chạy |

## 4. Blast radius

| Dimension | Value |
|---|---|
| Users affected | Mọi chat đang có cảnh báo. Hiện có 2 cảnh báo active; chưa biết thuộc bao nhiêu chat, và có phải chat của owner hay không |
| Frequency | Liên tục ~32 giờ kể từ deploy (gần như 100% số lượt dự kiến bị thiếu) |
| Data at risk | none. Cảnh báo vẫn nằm nguyên trong Redis. Việc 0 lần gửi là đúng hay đã bỏ lỡ một lần vượt ngưỡng thì **chưa biết**, vì không có lượt kiểm tra nào để so sánh |
| Workaround | Có, một phần: người dùng tự tra `/gia`. Tính năng cảnh báo thì mất tác dụng hoàn toàn |

Mức độ: đây là tính năng chính của EPIC-002. Người đặt cảnh báo tin rằng họ sẽ được báo và không được báo. Lỗi này không làm mất dữ liệu, nhưng nó phá niềm tin mà tính năng cần có.

## 5. What would have caught this

| Where it should have been caught | What was missing |
|---|---|
| `spec.md` (NFR/AC) | Không có yêu cầu *phát hiện* việc lượt kiểm tra ngừng chạy. AC18 chỉ đo khoảng cách **sau đó**, bằng tay, sau 24 giờ. Thiếu một điều kiện kiểu "owner được báo trong vòng N phút khi không có lượt nào hoàn tất". Đây là điều kiện liveness cho một job chạy nền mà người dùng phụ thuộc |
| Chỉ số ghi lại (NFR08) | Run log chỉ ghi lượt thành công. Lượt 401, lượt bỏ qua vì lock, và lượt throw đều không để lại dấu vết, nên không phân biệt được H1/H2/H3 từ dữ liệu của chính hệ thống |
| Checklist deploy (`docs/DEPLOYMENT.md` §8a, `review.md` "Sau deploy") | Bước "tạo/bật job cron-job.org" không có bước xác nhận ngay (vd. "sau 5 phút chạy report, phải thấy ≥ 4 lượt"). Kiểm tra đầu tiên nằm ở mốc 24 giờ, nên một lỗi cấu hình mất tới một ngày mới lộ ra |
| `docs/DEPLOYMENT.md` §8a bước 4 | Tài liệu sai: `vercel env pull .env.alerts` **không** lấy được `KV_REST_API_URL`/`KV_REST_API_TOKEN` vì chúng là biến Sensitive trên Vercel (CLI ghi `[SENSITIVE]` vào file, còn script báo `UrlError`). Owner phải copy tay từ Upstash Console. Hướng dẫn đo AC18 chưa từng được chạy thử thật trước khi đưa vào tài liệu |
| `epic-memory.json` / ghi chép deploy | Mục "re-enable cron-job.org" chỉ nằm trong ghi chú, không thành bước bắt buộc có người xác nhận |

## 6. Decision

**open `EPIC-002-FIX`**

Lý do: nguyên nhân gốc đã xác nhận là cấu hình sai URL, và chỉ cần sửa cấu hình (owner bật hoặc sửa job cron-job.org), không cần qua pipeline. Nhưng phần **đã confirmed** là tính năng có thể ngừng hoạt động mà không ai được báo, và đó là lỗi của sản phẩm. Lần sau job hỏng (cron-job.org đổi chính sách, secret bị xoay, CoinGecko chặn), tín hiệu này sẽ lặp lại, và chỉ lộ ra khi có người tự chạy report. Vậy là thoả điều kiện "the same signal will return".

Việc cho owner (ngoài pipeline, operator không tự sửa):
1. Kiểm tra cron-job.org (Enabled, execution history, mã phản hồi) và Vercel Logs (`Price-alert check failed`), để chốt H1, H2 hay H3 rồi ghi kết quả vào mục 3.
2. Bật hoặc sửa job cho đúng §8a (header `X-Cron-Secret-Token: <PRICE_ALERTS_CRON_SECRET>`). Sau ~10 phút chạy lại `npm run alerts:report`, phải thấy runs tăng khoảng 1/phút. Sau 24 giờ đo lại AC18.
3. Sửa `docs/DEPLOYMENT.md` §8a bước 4: KV credentials phải lấy từ Upstash Console, không lấy bằng `vercel env pull`.

## 7. Follow-up intent

> *Only when the decision is `open`. This is the seed of the new epic's
> `intent.md`, and it obeys stage-1 rules — no components, endpoints, schemas or
> libraries, however sure you are which line is at fault.*

| Heading | Content |
|---|---|
| Problem | Người dùng đặt cảnh báo giá và tin rằng bot đang canh giúp. Nhưng việc canh giá có thể dừng hẳn mà không ai biết: không người dùng nào được báo, và owner không có dấu hiệu gì. Lần này nó dừng ~32 giờ ngay sau khi ra mắt, và chỉ lộ ra khi owner tự đi đo |
| Who hurts | Người dùng đặt cảnh báo, chờ được nhắn khi giá vượt ngưỡng để kịp hành động. Owner vận hành bot, cần biết tính năng chính có đang chạy không mà không phải tự kiểm tra bằng tay |
| Cost | ~32 giờ (gần như toàn bộ thời gian kể từ ra mắt), 100% cảnh báo đang có (2) không được canh. Chưa biết có lần vượt ngưỡng nào bị bỏ lỡ không. Mỗi lần như vậy có thể kéo dài vô hạn cho tới khi có người để ý |
| Evidence | `docs/epics/EPIC-002/signal.json` và `incident.md` §1–3: "Runs logged: 2 (2026-09-23T06:55:42.247Z -> 2026-09-24T15:01:56.664Z)", "p95 115574.4s  [AC18: p95 <= 90s]"; dữ liệu hiện có không phân biệt được "không được gọi" với "được gọi mà hỏng" |
| Done looks like | Khi việc canh giá ngừng hoặc liên tục hỏng quá một khoảng thời gian ngắn đã thống nhất, owner được báo mà không phải tự đi kiểm tra. Nhìn vào dữ liệu là biết lượt nào bị bỏ lỡ và vì sao: không được gọi, bị từ chối, hay bị lỗi |
| Open questions | (1) Owner muốn được báo trong bao lâu: 5 phút, 15 phút, 1 giờ? (2) Báo qua kênh nào để chắc chắn tới tay owner, kể cả khi chính kênh gửi tin đang hỏng? (3) Người có cảnh báo có nên được biết khi việc canh giá tạm dừng không? (4) Nguyên nhân lần này là H1, H2 hay H3 (owner xác nhận)? (5) Có gộp việc sửa hướng dẫn đo AC18 (biến Sensitive) vào epic này, hay sửa tài liệu riêng? |

---

*Diagnose and hand forward. The fix goes through the same pipeline as any other
change — that is what makes it a loop rather than a patch.*
