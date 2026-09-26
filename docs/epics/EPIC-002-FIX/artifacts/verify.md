# Verification Report — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Verifier:** Verifier (independent)
**Status:** Draft
**Created:** `2026-09-26`
**Verified against:** `spec.md`, `plan.md`

---

> Kiểm trên nhánh `feature/epic-002-fix-alert-monitoring`, HEAD `66c2a2d` (các commit `12deea3..66c2a2d`, diff so với `c9b7292`). Verifier lập checklist từ `spec.md` §6 và `plan.md` §5 trước, rồi mới đọc `implement.md` để đối chiếu. Mọi lệnh bên dưới do verifier tự chạy trong một git worktree riêng, sau `npm ci`, ngày 2026-09-26. Không gọi endpoint production nào. Docker không chạy trên máy, nên các test Redis thật (opt-in) bị skip.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 14/20 pass, 1 fail (`EPIC-002-FIX-AC18`), 5 untested (`AC04`, `AC15`, `AC16`, `AC17`, `AC19`).

Chỉ có một lỗi thật trong build: AC18 fail. Bước xác nhận "≥ 3 lượt `healthy` mới trong 5 phút" ở `DEPLOYMENT.md` §8a.4 không làm được trên production hiện tại, vì run log đã đầy 1.440 bản ghi (finding #1). Ba dòng untested AC04, AC15, AC19 sẽ đóng được trước deploy, chỉ cần chạy bộ test Redis thật. Hai dòng AC16, AC17 chỉ đóng được sau deploy.

## 2. Acceptance criteria

Ký hiệu dùng trong bảng:
- `unit` = `npx jest --verbose`: 14 suite, **185/185 pass**, exit 0.
- `e2e` = `npm run test:e2e -- --verbose`: **23 pass, 8 skip** (cả suite `test/price-alerts.redis.e2e-spec.ts` bị skip vì không có `REDIS_INT_URL`), exit 0.
- `probe` = script tạm của verifier trong scratchpad (`probe.ts` chạy bằng `npx ts-node --transpile-only`, `probe2.js` chạy bằng `node`). Script import thẳng code của nhánh, không sửa file nào trong repo.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-002-FIX-AC01` | 2 cảnh báo, giá bình thường → lượt ghi `healthy`, lượt khoẻ gần nhất được cập nhật | pass | unit `√ logs a priced run as healthy (FIX-AC01)`. Lượt khoẻ gần nhất được suy ra từ run log (`latestHealthyAt`, `price-alert-monitor.ts:29-38`) và được bên quan sát lưu vào `MonitorState.lastHealthyAt` (`:82`). |
| `EPIC-002-FIX-AC02` | Nguồn giá lỗi → `no-price`, lượt khoẻ không đổi; không có cảnh báo → `healthy` | pass | unit `√ logs a run whose price lookup failed as no-price (FIX-AC02)`, `√ logs a run with no alerts as healthy without pricing anything (FIX-AC02)`, `√ does not flap around the threshold: one outage ends only on a healthy run`. Code: `price-alerts.controller.ts:110-115`. `isHealthyRun` chỉ nhận `healthy` (`price-alert-monitor.ts:24-26`). |
| `EPIC-002-FIX-AC03` | Sai / thiếu secret / lock bị giữ / lỗi → `rejected`/`rejected`/`skipped`/`failed`, `401`/`401`/`200`/`200`, không lưu secret | pass | unit `√ rejects a wrong or missing secret with 401 and records it, without the secret (FIX-AC03)` (guard spec kiểm `JSON.stringify(args)` không chứa `wrong-secret`, `price-alerts-cron-secret.guard.spec.ts:46`); `√ logs a lock-skipped call as skipped and still answers 200 (FIX-AC03)`; `√ logs a run ended by an unhandled error as failed and still answers 200 (FIX-AC03)`; e2e `√ rejects a call with no secret or a wrong secret, evaluating nothing (AC16)`. Hash `rejected` chỉ chứa `HH:MM → count` (`price-alerts.service.ts` `recordRejections`). |
| `EPIC-002-FIX-AC04` | 10.000 request sai secret / 1 phút → ≤ 1 lệnh ghi, không có tin, report vẫn thấy ≥ 1 | untested | Phần logic đạt ở unit: `√ writes at most once per minute under 10,000 rejected calls, keeping the count (FIX-AC04)` (1 lần `recordRejections`, count ≥ 1) và `√ adds the count to its UTC minute in the day hash with one EVAL, storing nothing else (FIX-AC04)`. Nhưng proof đã hứa trên Redis thật (`adds rejected counts into one minute field with a TTL, and sums them since a time (FIX-AC04)`) bị **skip**, vì Docker không chạy. Nên chưa có bằng chứng rằng script Lua `HINCRBY`+`EXPIRE` chạy được trên Redis thật và report đọc lại được số đó. Cách đóng: `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis` với `redis:7-alpine` + `hiett/serverless-redis-http`. |
| `EPIC-002-FIX-AC05` | T+14 không gửi; một lần chạy bất kỳ trong [T+15, T+20] → đúng 1 tin đủ trường FR04 | pass | unit `√ stays quiet at T+14 and sends one full "down" message in [T+15, T+20] (FIX-AC05)` (thử cả T+15 lẫn T+20; ngưỡng là `<`, nên đúng T+15 thì gửi, `price-alert-monitor.ts:122`); `√ carries every field FR04 asks for, in Vietnam time (FIX-AC05)`; service `√ messages the owner once the check has been down 15 minutes, with alert count and signal` (gửi 1 lần ở T+16, lần chạy T+21 không gửi thêm). Dòng gợi ý chỗ kiểm tra: `format-message.util.ts:325`. |
| `EPIC-002-FIX-AC06` | Chưa từng có lượt khoẻ, bên quan sát bắt đầu lúc S → tới S+20 đã có tin, ghi "chưa từng" | pass | unit `√ alerts with "never" when there was no healthy run since the watcher started (FIX-AC06)`, `√ says "never" when there was no healthy run (FIX-AC06)`. |
| `EPIC-002-FIX-AC07` | N+1h…N+5h59 không gửi; N+6h (±5 phút) → 1 tin nhắc | pass | unit `√ sends nothing more for 6h after a delivered message, then one reminder (FIX-AC07)`. Điều kiện ở `price-alert-monitor.ts:130` là `>= OUTAGE_REMINDER_MS`. |
| `EPIC-002-FIX-AC08` | Đợt đã báo, có lượt khoẻ R → ≤ R+5 phút đúng 1 tin hồi phục; đợt 10 phút → không gửi | pass | unit `√ sends one "recovered" message after a notified outage, then nothing (FIX-AC08)`, `√ sends nothing for a 10-minute gap that recovers, or for an unnotified outage (FIX-AC08)`; service `√ sends one recovery message after a notified outage (FIX-AC08)`. Thời điểm kết thúc ghi trong tin bị lệch tới ~5 phút (finding #4), nhưng không làm criterion hỏng. |
| `EPIC-002-FIX-AC09` | Toàn `rejected` → "bị từ chối" kèm số lần; toàn `no-price` → "không lấy được giá"; không có gì → "không có lượt gọi nào" | pass | unit `√ names what was seen after the last healthy run, with counts (FIX-AC09)`, `√ reports rejected calls since the outage began (FIX-AC09)`, `√ names the signal seen during an outage (FIX-AC09)`. Chuỗi ở `format-message.util.ts:295,305`. |
| `EPIC-002-FIX-AC10` | Gửi thất bại → không đánh dấu đã gửi, thử lại ở lần chạy sau; tin cảnh báo giá không bị ảnh hưởng | pass | unit `√ keeps retrying the "down" message until it is delivered (FIX-AC10)`; service `√ does not mark a failed send as notified and retries on the next run (FIX-AC10)`. Tin gửi owner chạy ở endpoint watch riêng. Trong lượt check, `checkWatcherSafely` chỉ chạy **sau** khi đã xử lý cảnh báo và nhả lock (`price-alerts.controller.ts:67-71`), có try/catch riêng. |
| `EPIC-002-FIX-AC11` | Thiếu chat owner → boot bình thường, không gửi, vẫn ghi nhận, report hiện "chưa cấu hình" | pass | e2e boot với `OWNER_CHAT_ID` bị `delete` (`test/webhook.e2e-spec.ts:22`), 23 test pass; service `√ sends nothing without an owner chat, but keeps watching and records that (FIX-AC11)` (`ownerChatConfigured: false`). probe P3: `envValidationSchema` thiếu cả `OWNER_CHAT_ID` lẫn `PRICE_ALERTS_WATCH_SECRET` → `error = none`. Report in `NOT configured (OWNER_CHAT_ID)` (`scripts/price-alerts-report.js:146-154`). Nếu bên quan sát chưa chạy lần nào thì report in `unknown`. |
| `EPIC-002-FIX-AC12` | Kho trạng thái hỏng 3 giờ → ≤ 3 tin | pass | service `√ sends at most 3 messages over 3 hours when Redis is unreachable (FIX-AC12)`, `√ holds repeats to one an hour when a delivered message cannot be saved (FIX-NFR05)`. Đạt với **một** instance. probe cho thấy giới hạn không giữ được ngoài giả định đó (finding #2): P2 (2 instance xen kẽ, 3 giờ) → `sends = 6`; P2b (instance mới mỗi lần) → `sends = 36`; P1 (Redis chập chờn, 1 giờ) → `sends = 6`. |
| `EPIC-002-FIX-AC13` | Bên quan sát ngừng từ W → tới W+35 đã có 1 tin; chạy lại → 1 tin hồi phục | pass | unit `√ alerts once the watcher is silent 30 minutes, and by W+35 at the latest (FIX-AC13)`, `√ sends one "recovered" message when the watcher runs again (FIX-AC13)`, `√ checks the watcher on minutes divisible by 5, after releasing the lock (FIX-AC13)`; service `√ messages the owner once the watcher has been silent 30 minutes (FIX-AC13)`. |
| `EPIC-002-FIX-AC14` | Log 32 phút trống + 20 phút `rejected` + `healthy` → 1 đợt 52 phút, có "không được gọi" và "bị từ chối", p95 chỉ trên `healthy` | pass | unit `√ finds one 52-minute outage made of "not called" then "rejected" (FIX-AC14)`, `√ computes AC18 gaps over healthy runs only, reading pre-FIX runs as healthy`. Có một điểm mù khi log không có lượt nào (finding #3). |
| `EPIC-002-FIX-AC15` | Chỉ có URL + token **read-only** → report chạy xong, không ghi gì | untested | Đọc code: report chỉ gọi `lrange`, `scard`, `get`, `hgetall` (`scripts/price-alerts-report.js:69-83`), không có lệnh ghi. Proof đã hứa `runs the report with read commands only and writes nothing (FIX-AC15)` bị **skip** (không có Docker). Cũng chưa ai chạy với một token read-only thật của Upstash. `@upstash/redis` 1.39.0 có thể gửi request qua endpoint pipeline, và chưa ai xác nhận token read-only được phép dùng endpoint đó. Cách đóng: chạy test Redis thật như AC04, rồi sau deploy owner chạy `npm run alerts:report` bằng read-only token ở Upstash Console. |
| `EPIC-002-FIX-AC16` | 24 giờ production: 0 tin giám sát; Upstash và Active CPU theo tháng nằm trong NFR04/NFR06 | untested | Chỉ quan sát được trên production. Plan R2 hứa lấy số Upstash thật trước bước 4, nhưng việc này **không** được làm (`implement.md` §4 mục 1), nên con số 295k/339k vẫn là ước tính. Cách đóng: sau `DEPLOYMENT.md` §8b bước 7, chạy report (0 notice trong 24 giờ), đọc Upstash → Usage (Commands) và Vercel → Usage (Active CPU), nhân lên 30 ngày, so với 400k lệnh và 24 phút CPU. |
| `EPIC-002-FIX-AC17` | Tắt job thật → tin ngừng ≤ 20 phút; bật lại → tin hồi phục ≤ 5 phút | untested | Cần production. Cách đóng: `DEPLOYMENT.md` §8b bước 6. Tắt job cron-job.org khoảng 20 phút, ghi giờ tắt và giờ nhận tin "Ngừng canh giá". Bật lại, ghi giờ nhận tin "Canh giá đã chạy lại". Dán dòng `Last monitoring messages` của report làm bằng chứng. |
| `EPIC-002-FIX-AC18` | Làm theo §8a từ đầu → chạy được report, thấy ≥ 3 lượt `healthy` mới trong 5 phút, không `vercel env pull` cho `KV_REST_API_*` | **fail** | Phần "không env pull" đạt: `grep -n "env pull" docs/DEPLOYMENT.md` → dòng 56 (`POSTGRES_URL`, §3a) và dòng 216 (lời cảnh báo mới). Phần "thấy ≥ 3 lượt mới" hỏng: §8a.4 (`DEPLOYMENT.md:229-230`) bảo xác nhận bằng "By outcome: healthy must have grown by at least 3". Số đó đếm trên cả run log, mà run log bị cắt ở 1.440 bản ghi (`MAX_RUN_LOG_ENTRIES`). Production chạy mỗi phút từ 2026-09-24T15:25Z nên log đã đầy: mỗi lượt mới đẩy một lượt cũ (bản ghi cũ không có `outcome`, được tính là `healthy`) ra khỏi log. probe2: `full log: healthy before=1440 after 5 new healthy runs=1440 growth=0`. Report không in danh sách lượt gần đây, nên người làm theo tài liệu không có cách nào thấy "≥ 3 lượt mới". Làm đúng như hướng dẫn thì bước này **luôn** báo thất bại (finding #1). |
| `EPIC-002-FIX-AC19` | Toàn bộ test EPIC-002 vẫn pass; ghi nhận lỗi → lượt vẫn xử lý cảnh báo | untested | Phần 2 đạt: unit `√ still processes alerts and answers 200 when the run-log write fails (FIX-AC19)`. Phần 1 mới đạt một phần: toàn bộ unit (185) và e2e mặc định (23) đều xanh, nhưng 5 test integration Redis thật của EPIC-002 (`creates, lists and deletes per chat…`, `rejects the 11th alert…`, `never resurrects an alert…`, `lets only one run hold the lock…`, `keeps delivery and run logs readable and capped`) bị **skip**, nên "toàn bộ test của EPIC-002" chưa chạy hết. Cách đóng: chạy test Redis thật như AC04. |
| `EPIC-002-FIX-AC20` | Gọi watch bằng secret digest / secret check / không secret → `401`, không gửi tin | pass | e2e `√ rejects the digest secret, the check secret and no secret, sending nothing (FIX-AC20)`, `√ runs the watcher for its own secret, as a header or bearer token, and answers 200`, `√ still answers 200 when Redis fails`. probe P3: guard watch khi **thiếu** `PRICE_ALERTS_WATCH_SECRET` trả `401` cho `{}`, cho `x-cron-secret-token: anything` và cho `Bearer ` rỗng, không crash (`cron-secret.guard.ts:37`). |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| AC01–AC03, AC05–AC14, AC19 (phần 2), AC20: unit / e2e theo `plan.md` §5 | Có (verifier chạy lại trên `66c2a2d`) | pass |
| AC04: guard spec 10.000 lần / phút | Có | pass (`11377 ms`) |
| AC04, AC15, round-trip state: `test/price-alerts.redis.e2e-spec.ts` (3 test mới + 5 test cũ) | **Không**, vì Docker không chạy (cả implement lẫn verify) | skipped → untested |
| AC15: owner chạy report bằng token read-only | Không (cần production) | untested |
| AC16, AC17: quan sát và thử thật trên production | Không (chưa deploy) | untested |
| AC18: `grep -n "env pull" docs/DEPLOYMENT.md` + đọc tài liệu | Có | grep đạt; đọc tài liệu và chạy probe2 thì thấy bước 5 phút hỏng → fail |
| Plan R2: đọc Upstash Usage thật trước bước 4 và ghi amendment vào plan | **Không** (`implement.md` §4 mục 1: owner quyết định bỏ qua). `plan.md` không có amendment | Không đạt yêu cầu của NFR04 ("plan.md phải lấy số thực tế … làm gốc") |
| §6 Feedback loop: lint, unit, e2e, build | Có | cả 4 exit 0 (§4) |
| §6 Chạy local `start:dev` + stub Zalo | Không (không có `.env`, không gọi production) | Không AC nào chỉ dựa vào proof này |

## 4. Regressions

```
$ npm run lint
> eslint "{src,apps,libs,test,api}/**/*.ts" --fix
LINT_EXIT=0
(eslint --fix chỉ đổi line ending của ~65 file: `git diff --ignore-cr-at-eol --stat` rỗng; đã `git checkout -- .` trong worktree)

$ npx jest --verbose
Test Suites: 14 passed, 14 total
Tests:       185 passed, 185 total
UNIT_EXIT=0

$ npm run test:e2e -- --verbose
Test Suites: 1 skipped, 1 passed, 1 of 2 total
Tests:       8 skipped, 23 passed, 31 total
E2E_EXIT=0

$ npm run build
> nest build
BUILD_EXIT=0
```

Các con số này khớp với `implement.md` §3 (185 unit, 23 e2e pass, 8 skip).

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Tin chỉ gửi tới `OWNER_CHAT_ID`, không gửi tới các chat có cảnh báo. Không giám sát bản tin 9h hay webhook. Không có lệnh mute/ack, không tự sửa job, không có dashboard web. Hành vi cảnh báo của EPIC-002 giữ nguyên: `processAlert`, `loadPrices` và evaluator không đổi logic. Diff controller chỉ thêm phân loại `outcome`, ghi log ở mọi nhánh và gọi watchdog sau khi nhả lock. Ngoài ra không có env nào khác bị động tới. `DIGEST_CHAT_ID` không được đọc lúc runtime.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Bước xác nhận 5 phút không làm được trên log đã đầy (AC18, FR10b).** Hướng dẫn bảo xem "By outcome: healthy" tăng ≥ 3. Nhưng run log bị cắt ở 1.440 bản ghi, và production đã chạy mỗi phút hơn 24 giờ, nên con số này đứng yên ở 1.440 dù job chạy đúng (probe2: `growth=0`). Kịch bản lỗi: owner sửa URL job, làm đúng §8a.4, thấy số không tăng, kết luận job vẫn hỏng. Hoặc ngược lại, owner quen với việc số không tăng và bỏ qua bước này, đúng loại sự cố epic này muốn chặn. Sửa: report in thêm "healthy runs in the last 5 min: N" (đếm lượt có `startedAt` ≥ now − 5 phút), rồi sửa §8a.4 để dựa vào dòng đó. | High | `docs/DEPLOYMENT.md:229-230`, `scripts/price-alerts-report.js:96-100`, `MAX_RUN_LOG_ENTRIES` |
| 2 | **Giới hạn 1 tin/giờ khi mất trạng thái chỉ nằm trong bộ nhớ instance (NFR05).** (a) Cứ mỗi lần đọc và ghi trạng thái thành công, `lastUnrecordedSendAt` lại bị đặt về `null` (`:267`). Nên khi Redis chập chờn (lúc được, lúc không), mỗi lần đọc lỗi lại gửi một tin "không đọc được trạng thái": probe P1 cho thấy **6 tin/giờ**. (b) Nếu các lượt watcher rơi vào nhiều instance hoặc gặp cold start thì mỗi instance có bộ đếm riêng: P2 cho 6 tin/3 giờ, P2b cho 36 tin/3 giờ. AC12 như spec viết (1 instance, hỏng liên tục) vẫn đạt, nhưng NFR05 ("kể cả khi không đọc hay ghi được, ≤ 1 tin mỗi giờ") không được bảo đảm. `implement.md` §6 đã tự ghi phần (b), còn phần (a) chưa ai ghi. | Medium | `src/price-alerts/price-alerts-monitor.service.ts:238-245,265-271` |
| 3 | **Report không thấy đợt ngừng khi run log rỗng.** `windowStart` là lượt đầu tiên trong log. Nếu job sai secret hoặc sai URL ngay từ đầu, log không có lượt nào, nên `buildOutages([], …, now, now)` trả về 0 đợt (probe P5: 60 phút toàn `rejected` → `outages = 0`). Report vẫn in "Runs logged: 0" và số lần bị từ chối, nên owner vẫn đoán được, nhưng FR09b không liệt kê đợt ngừng. Đây đúng là kịch bản sự cố của EPIC-002. | Low | `scripts/price-alerts-report.js:89,126` |
| 4 | **Tin "đã hồi phục" ghi thời điểm kết thúc là lượt khoẻ *mới nhất*, không phải lượt khoẻ *đầu tiên*.** `recoveredAt: lastHealthyAt` lấy lượt khoẻ mới nhất trong 30 bản ghi. Vì vậy thời điểm kết thúc và thời lượng bị lệch tới gần 5 phút (probe P4: lượt khoẻ đầu lúc 03:31, tin ghi 03:34, thời lượng 34 phút thay vì 31). FR06 muốn "thời điểm kết thúc" là lúc có lại lượt khoẻ. | Low | `src/price-alerts/price-alert-monitor.ts:105-109` |
| 5 | **NFR04 chưa được chứng minh bằng số thật.** Plan R2 hứa amendment dựa trên số Upstash Usage trước bước 4, nhưng việc này bị bỏ qua. Cũng chưa ai biết Upstash tính một `EVAL` (2 lệnh bên trong) và `LPUSH`+`LTRIM` là mấy lệnh. Mọi kết luận về ngân sách chờ AC16. | Medium | `plan.md` §4 R2, `implement.md` §4 mục 1 |
| 6 | **So sánh secret không dùng thời gian cố định** (`providedSecret !== expectedSecret`), và giờ áp dụng cho cả endpoint watch mới. Lỗi có từ trước, plan §7 đã loại khỏi phạm vi. Rủi ro thực tế thấp qua mạng, nhưng `crypto.timingSafeEqual` rất rẻ. Code cũng không kiểm rằng `PRICE_ALERTS_WATCH_SECRET` khác hai secret kia; việc tách secret (NFR08) chỉ dựa vào tài liệu. Thiếu secret thì trả `401` và boot bình thường (đã xác nhận). | Low | `src/common/guards/cron-secret.guard.ts:37` |
| 7 | **Thứ tự ghi ở bên quan sát: đã rà, không thấy lỗi gửi lặp.** Thứ tự là gửi Zalo, rồi `recordMonitorNotice`, rồi `setMonitorState`. Nếu bước cuối lỗi thì `lastUnrecordedSendAt` chặn gửi lại trong 1 giờ; watchdog cũng vậy (`6434eef`). Chỉ còn trường hợp flapping ở #2(a). Hai lượt watcher chạy chồng nhau (QStash giao trùng) có thể gửi trùng một tin "down", vì endpoint không có lock riêng. `implement.md` §6 đã ghi, rủi ro thấp. | Low | `price-alerts-monitor.service.ts:260-271,281-293` |
| 8 | **Ranh giới thời gian: đạt.** 15 phút dùng `<` nên đúng T+15 thì báo. 6 giờ và 30 phút dùng `>=`. `isWatchdogMinute` làm tròn tới phút gần nhất, nên lượt check trễ vài giây vẫn trúng mốc 5 phút. Nếu cron-job.org trễ khoảng 30 giây thì có thể lỡ một mốc, làm AC13 chậm tới W+40. Tình huống này hiếm. Nếu mất key `price-alerts:monitor` giữa lúc ngừng, `watcherStartedAt` bị đặt lại và việc báo bị chậm thêm 15 phút (probe P6). | Info | `price-alerts.controller.ts:268-270`, `price-alert-monitor.ts:81` |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. **Sửa AC18 (finding #1):** report in số lượt `healthy` có `startedAt` trong 5 phút gần nhất, kèm test lib, rồi sửa `DEPLOYMENT.md` §8a.4 để dựa vào dòng này thay vì "By outcome: healthy tăng ≥ 3".
2. **Đóng AC04, AC15, AC19 trước deploy:** bật Docker và chạy `redis:7-alpine` + `hiett/serverless-redis-http`, rồi chạy `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis`. Cả 8 test phải pass.
3. **Đóng AC15 phần token thật, AC17, AC16 sau deploy:** chạy report bằng read-only token (§8a.4); thử tắt job theo §8b bước 6; sau 24 giờ ghi 0 tin giám sát cùng số Upstash và Vercel Usage đã nhân lên tháng, và ghi số thật vào plan như R2 đã hứa.
4. Nên làm, nhưng không bắt buộc để lật verdict: finding #2(a), bỏ việc reset `lastUnrecordedSendAt` khi có một lần đọc hoặc ghi thành công, hoặc lưu thời điểm tin "không đọc được" gần nhất xuống Redis mỗi khi ghi được.
