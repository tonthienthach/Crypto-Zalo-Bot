# Verification Report — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 2)
**Created:** `2026-09-26`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 2**, kiểm lại trên nhánh `feature/epic-002-fix-alert-monitoring`, HEAD `63a2af9`, gồm các commit sửa `b208458`, `bc91f92`, `6b94a63`, `32f0b04`, `9158a35` (`git log --oneline 1de8c85..HEAD`). Ngày 2026-09-29. Verifier làm trong một git worktree riêng, sau `npm ci`. Không gọi endpoint production nào. Docker không chạy, nên các test Redis thật (opt-in) bị skip.
> **Rev 1** (HEAD `66c2a2d`, 2026-09-26) ra kết quả **fail**: 14/20 pass, 1 fail (`AC18`: bước xác nhận 5 phút không làm được khi run log đã đầy), 5 untested (`AC04`, `AC15`, `AC16`, `AC17`, `AC19`). Rev 1 có 8 finding. Các finding chính: #1 AC18 (High), #2 hold "≤ 1 tin/giờ" chỉ nằm trong bộ nhớ instance (Medium), #3 report không thấy đợt ngừng khi run log rỗng (Low), #4 tin hồi phục ghi mốc kết thúc là lượt khoẻ mới nhất (Low), #5 NFR04 chưa có số thật (Medium), #6 so sánh secret không dùng thời gian cố định (Low).
> Theo quyết định của owner (2026-09-29), số dùng Upstash thật (NFR04), test Redis thật opt-in và các criterion chỉ kiểm được trên production vẫn để `untested` tới sau deploy. Rev 2 kiểm độc lập từng bản sửa, chấm lại toàn bộ 20 AC và tìm lỗi mới do chính các bản sửa gây ra.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 15/20 pass, 0 fail, 5 untested (`AC04`, `AC15`, `AC16`, `AC17`, `AC19`).

AC18 đã chuyển từ fail sang pass. Không còn dòng nào fail. Verdict vẫn là fail theo luật của skill, vì còn 5 dòng untested. Cả 5 dòng này đều được owner cố ý hoãn: 3 dòng (AC04, AC15, AC19) chờ bộ test Redis thật, 2 dòng (AC16, AC17) chỉ kiểm được sau deploy. Rev 2 tìm thấy một lỗi mới do bản sửa `6b94a63` gây ra (finding #1, Medium). Lỗi này không làm hỏng AC nào như spec đang viết, nhưng vi phạm NFR01 sau một lần Redis lỗi thoáng qua. Nên sửa trước deploy.

## 2. Acceptance criteria

Ký hiệu dùng trong bảng:
- `unit` = `npx jest --verbose`: 15 suite, **206/206 pass**, exit 0.
- `e2e` = `npm run test:e2e -- --verbose`: **23 pass, 9 skip** (cả suite `test/price-alerts.redis.e2e-spec.ts` bị skip vì không có `REDIS_INT_URL`), exit 0.
- `probe` = script tạm của verifier trong scratchpad. `probe-r2.ts` chạy bằng `npx ts-node --transpile-only`, dựng `PriceAlertsMonitorService` thật với một kho Redis giả có thể bật lỗi theo từng lệnh. `probe-r2-report.js` chạy bằng `node`, gọi thẳng `printReport` của `scripts/price-alerts-report.js` với dữ liệu giả. Không script nào sửa file trong repo.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-002-FIX-AC01` | 2 cảnh báo, giá bình thường → lượt ghi `healthy`, lượt khoẻ gần nhất được cập nhật | pass | unit `√ logs a priced run as healthy (FIX-AC01)`. Các commit rev 2 không đụng tới `price-alerts.controller.ts` (`git diff --stat 1de8c85..HEAD`). |
| `EPIC-002-FIX-AC02` | Nguồn giá lỗi → `no-price`, lượt khoẻ không đổi; không có cảnh báo → `healthy` | pass | unit `√ logs a run whose price lookup failed as no-price (FIX-AC02)`, `√ logs a run with no alerts as healthy without pricing anything (FIX-AC02)`, `√ does not flap around the threshold: one outage ends only on a healthy run`. |
| `EPIC-002-FIX-AC03` | Sai / thiếu secret / lock bị giữ / lỗi → `rejected`/`rejected`/`skipped`/`failed`, `401`/`401`/`200`/`200`, không lưu secret | pass | unit `√ rejects a wrong or missing secret with 401 and records it, without the secret (FIX-AC03)`, `√ logs a lock-skipped call as skipped and still answers 200 (FIX-AC03)`, `√ logs a run ended by an unhandled error as failed and still answers 200 (FIX-AC03)`. e2e `√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)`. Guard giờ so sánh bằng `secretEquals` (`cron-secret.guard.ts:38`), và unit `√ CronSecretGuard: right secret as header or bearer passes, anything else is 401` vẫn xanh. |
| `EPIC-002-FIX-AC04` | 10.000 request sai secret / 1 phút → ≤ 1 lệnh ghi, không có tin, report vẫn thấy ≥ 1 | untested | Phần logic đạt: unit `√ writes at most once per minute under 10,000 rejected calls, keeping the count (FIX-AC04)` (15.897 ms) và `√ adds the count to its UTC minute in the day hash with one EVAL, storing nothing else (FIX-AC04)`. Proof đã hứa trên Redis thật vẫn bị **skip** (không có Docker), như rev 1. Owner đã hoãn việc này. Cách đóng: `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis`. |
| `EPIC-002-FIX-AC05` | T+14 không gửi; một lần chạy bất kỳ trong [T+15, T+20] → đúng 1 tin đủ trường FR04 | pass | unit `√ stays quiet at T+14 and sends one full "down" message in [T+15, T+20] (FIX-AC05)`, `√ carries every field FR04 asks for, in Vietnam time (FIX-AC05)`; service `√ messages the owner once the check has been down 15 minutes, with alert count and signal`. Khi không có sự cố Redis thì hold không được đặt, nên `notify` chỉ tốn thêm 1 `EXISTS` rồi gửi. Xem finding #1 về trường hợp có một lần Redis lỗi trước đó. |
| `EPIC-002-FIX-AC06` | Chưa từng có lượt khoẻ, bên quan sát bắt đầu lúc S → tới S+20 đã có tin, ghi "chưa từng" | pass | unit `√ alerts with "never" when there was no healthy run since the watcher started (FIX-AC06)`, `√ says "never" when there was no healthy run (FIX-AC06)`. |
| `EPIC-002-FIX-AC07` | N+1h…N+5h59 không gửi; N+6h (±5 phút) → 1 tin nhắc | pass | unit `√ sends nothing more for 6h after a delivered message, then one reminder (FIX-AC07)`. |
| `EPIC-002-FIX-AC08` | Đợt đã báo, có lượt khoẻ R → ≤ R+5 phút đúng 1 tin hồi phục; đợt 10 phút → không gửi | pass | unit `√ sends one "recovered" message after a notified outage, then nothing (FIX-AC08)`, `√ dates the recovery at the FIRST healthy run after the outage, not the newest (verify finding #4)`, `√ sends nothing for a 10-minute gap that recovers, or for an unnotified outage (FIX-AC08)`; service `√ sends one recovery message after a notified outage (FIX-AC08)`. Mốc kết thúc giờ là lượt khoẻ đầu tiên (`firstHealthyAfter`, `price-alert-monitor.ts:44-54,123`). Lưu ý: nếu tin hồi phục bị hold giữ lại quá 30 phút thì mốc này lại sai (finding #1). |
| `EPIC-002-FIX-AC09` | Toàn `rejected` → "bị từ chối" kèm số lần; toàn `no-price` → "không lấy được giá"; không có gì → "không có lượt gọi nào" | pass | unit `√ names what was seen after the last healthy run, with counts (FIX-AC09)`, `√ reports rejected calls since the outage began (FIX-AC09)`, `√ names the signal seen during an outage (FIX-AC09)`. |
| `EPIC-002-FIX-AC10` | Gửi thất bại → không đánh dấu đã gửi, thử lại ở lần chạy sau; tin cảnh báo giá không bị ảnh hưởng | pass | unit `√ keeps retrying the "down" message until it is delivered (FIX-AC10)`; service `√ does not mark a failed send as notified and retries on the next run (FIX-AC10)`, `√ gives the claim back when the message could not be delivered, so the next run retries`. Gửi hỏng không đặt hold ở đường `notify` (`price-alerts-monitor.service.ts:116-125`). |
| `EPIC-002-FIX-AC11` | Thiếu chat owner → boot bình thường, không gửi, vẫn ghi nhận, report hiện "chưa cấu hình" | pass | e2e boot với `OWNER_CHAT_ID` bị xoá, 23 test pass; service `√ sends nothing without an owner chat, but keeps watching and records that (FIX-AC11)`. Cảnh báo lúc boot khi secret watch bị dùng lại không chặn boot: `√ warns at boot when the watch secret equals another secret, and still boots (FIX-NFR08)`. |
| `EPIC-002-FIX-AC12` | Kho trạng thái hỏng 3 giờ → ≤ 3 tin | pass | service `√ sends at most 3 messages over 3 hours when Redis is unreachable (FIX-AC12)`, `√ flaky state reads (every other one fails) send at most one message an hour` (rev 1: 6 tin/giờ, giờ còn 1), `√ two instances taking turns share the hold after a delivered message fails to save`. probe P1b (Redis hỏng hẳn, 1 instance, 3 giờ) → `sends = 3`. Giới hạn còn lại: probe P1 (Redis hỏng **hẳn**, mỗi lượt một instance mới) → `sends = 36`. Test `a fresh instance on every run (cold starts) still sends at most one an hour` chỉ đúng khi Redis vẫn nhận lệnh `SET` của hold, trong khi lệnh đọc state lỗi. `implement.md` §6 đã tự ghi giới hạn này. Criterion, theo đúng proof trong plan (1 service, Redis throw ở mọi lượt), đạt. |
| `EPIC-002-FIX-AC13` | Bên quan sát ngừng từ W → tới W+35 đã có 1 tin; chạy lại → 1 tin hồi phục | pass | unit `√ alerts once the watcher is silent 30 minutes, and by W+35 at the latest (FIX-AC13)`, `√ sends one "recovered" message when the watcher runs again (FIX-AC13)`, `√ checks the watcher on minutes divisible by 5, after releasing the lock (FIX-AC13)`; service `√ messages the owner once the watcher has been silent 30 minutes (FIX-AC13)`, `√ does not repeat a delivered watcher alarm every 5 minutes when its state cannot be saved`. |
| `EPIC-002-FIX-AC14` | Log 32 phút trống + 20 phút `rejected` + `healthy` → 1 đợt 52 phút, có "không được gọi" và "bị từ chối", p95 chỉ trên `healthy` | pass | unit `√ finds one 52-minute outage made of "not called" then "rejected" (FIX-AC14)`. Khi run log rỗng, report giờ có một đợt ngừng (finding #3 của rev 1): unit `√ an empty run log is one ongoing outage, not zero outages (verify finding #3)`. probe-r2-report B: log rỗng, 20 phút bị từ chối → `Outages (>= 15 min without a healthy run): 1` / `NO RUN HAS EVER BEEN LOGGED — the check was never reached (rejected calls since 2026-09-29T02:40:00.000Z, 21 min): rejected x60`. probe C (log rỗng, không có gì) → `... never reached: not called`. |
| `EPIC-002-FIX-AC15` | Chỉ có URL + token **read-only** → report chạy xong, không ghi gì | untested | Report vẫn chỉ đọc: `lrange`, `scard`, `get`, `hgetall` (`scripts/price-alerts-report.js:74-80`). Rev 2 không thêm lệnh nào. Proof Redis thật vẫn bị skip. Thêm một điểm chưa biết: `@upstash/redis` trong `node_modules` có `enableAutoPipelining = opts?.enableAutoPipelining ?? true`, nên `Promise.all` ở `readAll` gửi qua endpoint `/pipeline`. Chưa ai xác nhận token read-only được phép dùng endpoint đó. Owner đã hoãn tới sau deploy. |
| `EPIC-002-FIX-AC16` | 24 giờ production: 0 tin giám sát; Upstash và Active CPU theo tháng nằm trong NFR04/NFR06 | untested | Chỉ quan sát được trên production. Owner hoãn tới sau deploy. Rev 2 không tốn thêm lệnh Upstash nào khi vận hành bình thường: `hasNoticeHold` (`EXISTS`) chỉ chạy khi có tin tới hạn (`price-alerts-monitor.service.ts:117,166`), còn `SET`/`DEL` của hold chỉ chạy khi có sự cố. |
| `EPIC-002-FIX-AC17` | Tắt job thật → tin ngừng ≤ 20 phút; bật lại → tin hồi phục ≤ 5 phút | untested | Cần production (`DEPLOYMENT.md` §8b bước 6). Owner hoãn tới sau deploy. |
| `EPIC-002-FIX-AC18` | Làm theo §8a từ đầu → chạy được report, thấy ≥ 3 lượt `healthy` mới trong 5 phút, không `vercel env pull` cho `KV_REST_API_*` | pass | `grep -n "env pull" docs/DEPLOYMENT.md` → dòng 56 (`POSTGRES_URL`, §3a) và dòng 216 (lời cảnh báo). Không có bước nào pull `KV_REST_API_*`. §8a.4 (`DEPLOYMENT.md:229-236`) giờ kiểm dòng "Last 5 min: healthy ≥ 3", và dặn không so tổng "By outcome". probe-r2-report A (log đầy 1.440 lượt, job chạy đúng) in `By outcome: healthy 1440` và `Last 5 min: healthy 5, no-price 0, failed 0, skipped 0, rejected 0`, tức dòng này vẫn đổi khi log đã đầy. unit `√ counts only the last 5 minutes for the deploy check, so it moves once the log is full (FIX-AC18)`, `√ shows nothing in the last 5 minutes when the job stopped`. Phần "chạy được report bằng token read-only" phụ thuộc vào AC15 (untested) và được theo dõi ở dòng đó. |
| `EPIC-002-FIX-AC19` | Toàn bộ test EPIC-002 vẫn pass; ghi nhận lỗi → lượt vẫn xử lý cảnh báo | untested | Phần 2 đạt: unit `√ still processes alerts and answers 200 when the run-log write fails (FIX-AC19)`. Phần 1 đạt một phần: 206 unit và 23 e2e mặc định đều xanh, nhưng 5 test integration Redis thật của EPIC-002 vẫn bị skip (cả suite giờ có 9 test skip, gồm test hold/TTL mới). Owner đã hoãn việc này. |
| `EPIC-002-FIX-AC20` | Gọi watch bằng secret digest / secret check / không secret → `401`, không gửi tin | pass | e2e `√ rejects the digest secret, the check secret and no secret, sending nothing (FIX-AC20)`, `√ runs the watcher for its own secret, as a header or bearer token, and answers 200`, `√ still answers 200 when Redis fails`. probe P6 (`secretEquals`): `{"same_ascii":true,"same_unicode":true,"diff_unicode_same_utf16_len":false,"diff_len":false,"latin1_vs_utf8":false,"number":false}`. Hai chuỗi khác độ dài hay có ký tự non-ASCII không làm `timingSafeEqual` throw, vì cả hai phía đều được hash SHA-256 trước (`secret-equals.ts:14-15`). |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| AC01–AC03, AC05–AC14, AC19 (phần 2), AC20: unit / e2e theo `plan.md` §5 | Có (verifier chạy lại trên `63a2af9`) | pass |
| AC04: guard spec 10.000 lần / phút | Có | pass (`15897 ms`) |
| AC04, AC15, round-trip state, hold/TTL: `test/price-alerts.redis.e2e-spec.ts` (4 test mới + 5 test cũ) | **Không**, vì Docker không chạy (owner hoãn) | skipped → untested |
| AC15: owner chạy report bằng token read-only | Không (cần production) | untested |
| AC16, AC17: quan sát và thử thật trên production | Không (chưa deploy) | untested |
| AC18: `grep -n "env pull" docs/DEPLOYMENT.md` + đọc tài liệu | Có, kèm probe `printReport` với log đầy | pass |
| Plan R2: đọc Upstash Usage thật trước bước 4, ghi amendment vào plan | **Không** (owner hoãn tới sau deploy). `plan.md` vẫn không có amendment | NFR04 chưa được chứng minh bằng số thật, theo dõi ở AC16 |
| §6 Feedback loop: lint, unit, e2e, build | Có | cả 4 exit 0 (§4) |
| §6 Chạy local `start:dev` + stub Zalo | Không (không có `.env`, không gọi production) | Không AC nào chỉ dựa vào proof này |

## 4. Regressions

```
$ npm run lint
> eslint "{src,apps,libs,test,api}/**/*.ts" --fix
LINT=0
(eslint --fix chỉ đổi line ending: `git diff --ignore-cr-at-eol --stat` rỗng; đã `git checkout -- .` trong worktree)

$ npx jest --verbose
Test Suites: 15 passed, 15 total
Tests:       206 passed, 206 total
UNIT=0
(có cảnh báo "A worker process has failed to exit gracefully", nhưng không có test nào hỏng)

$ npm run test:e2e -- --verbose
Test Suites: 1 skipped, 1 passed, 1 of 2 total
Tests:       9 skipped, 23 passed, 32 total
E2E=0

$ npm run build
> nest build
BUILD=0
```

Các con số này khớp với `implement.md` §4 mục 9 (unit 206, e2e 23 pass, 9 skip).

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Rev 2 chỉ đụng tới report, `DEPLOYMENT.md` §8a.4, hold của bên quan sát, cách so secret và mốc hồi phục. Việc `WebhookSecretGuard` chuyển sang dùng `secretEquals` là thay đổi ngoài phạm vi EPIC-002-FIX (plan §7 đã loại việc này), nhưng hành vi được giữ nguyên: sai hoặc thiếu secret vẫn `401`, và query lặp (mảng) giờ cũng `401` thay vì so sánh sai kiểu. Owner đã duyệt việc này ở rev 2 (`implement.md` §4 mục 9). Không có người nhận mới, không có lệnh mute/ack, không có dashboard. Logic cảnh báo giá của EPIC-002 không đổi.

## 6. Findings

Trạng thái các finding của rev 1:

| Rev 1 # | Trạng thái ở rev 2 | Bằng chứng |
|---|---|---|
| 1 (High, AC18) | **Đã sửa, có test.** | Dòng "Last 5 min" vẫn đổi khi log đầy (probe A); §8a.4 dựa vào dòng này. |
| 2 (Medium, NFR05) | **Đã sửa phần (a) và phần lớn (b), có test.** Còn lại: khi Redis hỏng hẳn, mỗi instance vẫn có bộ đếm riêng (probe P1: 36 tin/3 giờ). Bản sửa gây ra finding #1 mới. | Test flaky/instances ở service spec; probe P1, P1b. |
| 3 (Low, FR09b) | **Đã sửa, có test.** | probe B, C. |
| 4 (Low, FR06) | **Đã sửa, có test.** Còn một kẽ hở khi tin hồi phục bị giữ quá 30 phút (finding #1). | unit `dates the recovery at the FIRST healthy run...`. |
| 5 (Medium, NFR04) | **Chưa sửa, owner hoãn** tới sau deploy (AC16). | `implement.md` §6. |
| 6 (Low, NFR08) | **Đã sửa, có test.** Có thêm warn lúc boot khi secret watch bị dùng lại. | probe P6; `secret-equals.spec.ts`. |
| 7, 8 (Low/Info) | Không đổi. | — |

Finding mới và finding còn mở:

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Mới, do `6b94a63` gây ra: một lần Redis lỗi thoáng qua làm mọi tin giám sát bị giữ tới 1 giờ, kể cả tin "ngừng" và "hồi phục" thật.** Khi đọc state lỗi, tin "không đọc được trạng thái" giành hold chung `price-alerts:monitor-notice-hold` (TTL 1 giờ). Sau đó `notify()` coi hold này là lý do để không gửi **mọi** loại tin (`isHeld` → `hasNoticeHold`), dù Redis đã đọc và ghi bình thường trở lại. Ở rev 1, lần ghi state thành công kế tiếp gỡ hold, nên tin chỉ chậm thêm một lượt. Kịch bản lỗi (probe P2): lượt khoẻ cuối lúc T+0, Redis lỗi đúng một lần đọc lúc T+10 → owner nhận tin "không đọc được trạng thái" lúc T+10, rồi tin "ngừng canh giá" tới **T+70**, trong khi NFR01 đòi ≤ 20 phút. probe P3: tin ngừng lúc T+15, Redis lỗi thoáng qua lúc T+40, job chạy lại lúc T+42 → tin hồi phục tới **T+100**, trong khi NFR01 đòi ≤ R+5. Tin còn ghi sai giờ kết thúc (`11:11`, thật ra là `10:42`), vì lượt khoẻ đầu tiên đã trôi khỏi cửa sổ 30 lượt nên code lấy lượt mới nhất (`price-alert-monitor.ts:123`). Như spec đang viết, không AC nào hỏng, vì Given của AC05/AC08 không có sự cố Redis. Nhưng NFR01 bị vi phạm, và loại sự cố Upstash thoáng qua này rất dễ đi kèm đúng lúc việc canh giá gặp sự cố. Sửa: chỉ để hold chặn các tin cùng loại "không ghi lại được", ví dụ lưu `kind` trong giá trị của key, và bỏ qua hold khi đánh giá từ state đọc được; hoặc `DEL` hold ở lần `setMonitorState` thành công đầu tiên sau khi hold đã tồn tại ≥ 1 lượt. | Medium | `src/price-alerts/price-alerts-monitor.service.ts:116-118,138-145,162-167` |
| 2 | **Có từ trước, không phải do rev 2: tin "ngừng" đã gửi nhưng không lưu được state thì không bao giờ có tin hồi phục.** Lưu state lỗi sau khi gửi làm `outage.notifiedAt` vẫn là `null`, nên khi job chạy lại, đợt ngừng kết thúc "như chưa từng báo" (`price-alert-monitor.ts:119`). probe P4: tin ngừng lúc T+15 (lần lưu lỗi một lần duy nhất), job chạy lại lúc T+30 → `sends = [[15,"down"]]`, không có tin hồi phục. Owner sẽ tưởng việc canh giá vẫn đang ngừng. Nếu đợt ngừng kéo dài hơn 1 giờ thì owner nhận lại tin "ngừng" lần nữa (sau khi hold hết hạn) thay vì tin nhắc. | Low | `price-alerts-monitor.service.ts:81-91`, `price-alert-monitor.ts:119` |
| 3 | **Test service `a fresh instance on every run (cold starts) still sends at most one an hour` nói nhiều hơn những gì nó chứng minh.** Test chỉ làm lệnh đọc state lỗi, còn `claimNoticeHold` (mock) vẫn thành công. Khi Redis hỏng **hẳn**, cold start mỗi lượt vẫn gửi 36 tin trong 3 giờ (probe P1). `implement.md` §6 có ghi giới hạn này, nhưng §4 mục 9 viết "Mỗi lượt một instance mới (cold start), 3 giờ: trước sửa 36 tin, sau sửa 3 tin" mà không nêu điều kiện. Không có chỗ lưu chung nào khác, nên đây là giới hạn chấp nhận được, chỉ cần ghi cho đúng. | Low | `src/price-alerts/price-alerts-monitor.service.spec.ts:229-237`, `implement.md` §4 mục 9 |
| 4 | **Hold bị giữ khi gửi hỏng mà `DEL` cũng hỏng.** Giành hold thành công, gửi Zalo thất bại, rồi `releaseNoticeHold` lỗi → owner không nhận tin nào trong 1 giờ (probe P5: tin đầu tiên tới ở phút 60, dù Zalo đã chạy lại từ phút 5). `implement.md` §6 đã ghi và chấp nhận điều này. Tương tự nếu function bị kill giữa `SET NX` và lúc gửi. | Low | `price-alerts-monitor.service.ts:138-148` |
| 5 | **Dòng "Last 5 min" phụ thuộc đồng hồ của máy chạy report.** `recentActivity` lọc theo `now` của laptop owner (`Date.now()`, `price-alerts-report.js:222`). Nếu đồng hồ laptop chạy nhanh hơn server khoảng 2 phút trở lên thì dòng này báo thiếu lượt `healthy`, dù job vẫn chạy đúng. Nếu chạy chậm thì "Last healthy run" in thời gian âm (probe A2: `(-150.2s ago)`). Máy đồng bộ NTP thì không gặp. | Info | `scripts/price-alerts-report.lib.js:128-137` |
| 6 | **NFR04 vẫn chưa có số thật** (rev 1 #5). Rev 2 không tốn thêm lệnh nào khi vận hành bình thường: `EXISTS` chỉ chạy khi có tin tới hạn, còn `SET`/`DEL` chỉ chạy khi có sự cố (đọc code, xem AC16). Tổng ước tính ~295k / ~339k lệnh mỗi tháng không đổi. | Medium (owner hoãn) | `plan.md` §4 R2 |
| 7 | **Key và TTL: đạt.** Cả `claimNoticeHold` lẫn `setNoticeHold` đều đặt `px` (1 giờ). `setNoticeHold` ghi đè và kéo dài TTL. Không có đường nào tạo key mà không có TTL. Test Redis thật cho TTL đã viết nhưng bị skip. | Info | `src/price-alerts/price-alerts.service.ts:266-286` |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. **Đóng AC04, AC15 (phần Redis), AC19 trước khi merge:** bật Docker và chạy `redis:7-alpine` + `hiett/serverless-redis-http`, rồi chạy `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis`. Cả 9 test phải pass.
2. **Đóng AC15 (token read-only thật), AC17, AC16 sau deploy:** chạy report bằng read-only token (§8a.4); thử tắt job theo §8b bước 6; sau 24 giờ ghi lại 0 tin giám sát cùng số Upstash và Vercel Usage đã nhân lên tháng, và ghi số thật vào `plan.md` như R2 đã hứa.
3. **Nên sửa trước deploy (không bắt buộc để lật verdict, nhưng vi phạm NFR01):** finding #1. Tin "không đọc được trạng thái" không được giữ tin "ngừng" hay "hồi phục" thật khi Redis đã đọc và ghi lại được. Thêm test service cho kịch bản probe P2/P3.
