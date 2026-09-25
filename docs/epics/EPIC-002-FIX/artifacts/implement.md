# Implementation Summary — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Author:** Engineer
**Status:** Draft
**Created:** 2026-09-25
**Traces to:** `plan.md`

---

## 1. Branch and PR

| | |
|---|---|
| Branch | `feature/epic-002-fix-alert-monitoring`, tách từ `docs/epic-002-deployed` (`c9b7292`). Nhánh này đã có sẵn các commit docs chưa merge của EPIC-002 maintain và của intent/spec/plan cho EPIC-002-FIX, EPIC-003 |
| PR | Chưa mở, chưa push. Owner quyết định push và mở PR vào `master` |

## 2. What was built

| Plan step | Change | Files |
|---|---|---|
| 1 | Mỗi lượt đã qua guard đều ghi summary kèm `outcome`: `healthy`, `no-price` (có cảnh báo mà không lấy được giá nào), `failed` (lỗi chưa xử lý), `skipped` (lock đang bị giữ). Việc ghi là best-effort: ghi hỏng thì chỉ mất dòng log đó, lượt vẫn chạy và không bị ghi lại thành `failed` (`12deea3`) | `src/price-alerts/interfaces/price-alert.interface.ts`, `price-alerts.controller.ts` (+ spec) |
| 2 | `CronSecretGuard` có thêm hook `onRejected()` rỗng, nên digest giữ nguyên hành vi. `PriceAlertsCronSecretGuard` override hook này: đếm trong bộ nhớ, ghi xuống Redis tối đa 1 lần mỗi phút cho mỗi instance bằng **một** `EVAL` (`HINCRBY` vào hash theo ngày UTC, mỗi phút một field, cộng `EXPIRE` 3 ngày). Chỉ lưu con số (`fdcecd1`) | `src/common/guards/cron-secret.guard.ts`, `price-alerts-cron-secret.guard.ts` (+ spec mới), `price-alerts.constants.ts`, `price-alerts.service.ts` (+ spec), `test/webhook.e2e-spec.ts` |
| 3 | Hai hàm thuần `evaluateMonitor()` và `evaluateWatchdog()`, cùng `classifySignal()` và `latestHealthyAt()`. Mỗi quyết định trả về trạng thái cho cả hai trường hợp: tin đã tới (`onSent`) và chưa tới (`onNotSent`) (`2a9708f`) | `src/price-alerts/price-alert-monitor.ts` (+ spec), interface, constants |
| 4 | Endpoint `/cron/price-alerts-watch` với guard `PriceAlertsWatchSecretGuard` (`PRICE_ALERTS_WATCH_SECRET`). `PriceAlertsMonitorService` đọc trạng thái và 30 summary, chỉ đọc số lần bị từ chối khi sắp gửi tin, gửi Zalo tới `OWNER_CHAT_ID`, rồi lưu trạng thái đúng với việc tin có tới hay không. Redis lỗi thì giới hạn 1 tin/giờ bằng bộ nhớ instance. Hai env mới đều optional. Thêm formatter tin tiếng Việt (`1c66901`) | `src/config/*`, `src/common/guards/price-alerts-watch-secret.guard.ts`, `src/price-alerts/price-alerts-monitor.service.ts` (+ spec), `price-alerts-watch.controller.ts`, `price-alerts.module.ts`, `price-alerts.service.ts` (+ spec), `src/utils/format-message.util.ts` (+ spec), `test/webhook.e2e-spec.ts` |
| 5 | Ở phút chia hết cho 5 (làm tròn tới phút gần nhất), lượt check không bị `skipped` sẽ gọi `checkWatcher()` sau khi nhả lock. Việc này tốn 1 `MGET`, và state watchdog chỉ được ghi khi đổi (`5e87c4e`) | `price-alerts.controller.ts` (+ spec) |
| 6 | Report được viết lại: đếm theo loại, liệt kê các đợt ngừng ≥ 15 phút kèm những gì thấy trong đợt, lượt khoẻ cuối, nhịp bên quan sát, chat owner, các tin giám sát gần nhất. AC18/NFR02 chỉ tính trên lượt `healthy`. Phần tính toán tách sang lib để test (`5be306f`) | `scripts/price-alerts-report.js`, `scripts/price-alerts-report.lib.js` (mới), `src/price-alerts/report-lib.spec.ts` (mới), `test/price-alerts.redis.e2e-spec.ts` |
| 7 | `DEPLOYMENT.md`: §8a bước 4–6 được sửa (KV lấy từ Upstash Console bằng token read-only, xác nhận trong 5 phút, cách tắt hẳn); thêm §8b (QStash: env, deploy, schedule, thử báo động, dự phòng Cloudflare, rollback). Cập nhật `ARCHITECTURE.md`, `API.md`, `.env.example` (`f77b726`) | docs |
| (thêm) | Khi rà thứ tự lỗi: tin "bên giám sát im lặng" đã tới mà ghi state watchdog lỗi thì cứ 5 phút lại gửi lại. Đã áp cùng giới hạn 1 tin/giờ (`6434eef`) | `price-alerts-monitor.service.ts` (+ spec) |

## 3. Proofs executed

Số test: unit **132 → 185** (14 suite), e2e **20 → 23 pass**, số skipped (opt-in Redis thật) **5 → 8**. `npm run lint` và `npm run build` xanh ở mỗi bước.

```
$ npm test
Test Suites: 14 passed, 14 total
Tests:       185 passed, 185 total
$ npm run test:e2e
Tests:       8 skipped, 23 passed, 31 total
```

### `EPIC-002-FIX-AC01`

```
$ npx jest --verbose src/price-alerts
  run outcome (EPIC-002-FIX)
    √ logs a priced run as healthy (FIX-AC01)
```

### `EPIC-002-FIX-AC02`

```
    √ logs a run whose price lookup failed as no-price (FIX-AC02)
    √ logs a run with no alerts as healthy without pricing anything (FIX-AC02)
  latestHealthyAt / classifySignal
    √ treats runs logged before EPIC-002-FIX (no outcome) as healthy
```

`evaluateMonitor` chỉ lấy lượt `healthy` làm mốc (`latestHealthyAt`), nên lượt `no-price` không làm "lượt khoẻ gần nhất" thay đổi. Test "does not flap around the threshold" chứng minh điều này.

### `EPIC-002-FIX-AC03`

```
    √ logs a lock-skipped call as skipped and still answers 200 (FIX-AC03)
    √ logs a run ended by an unhandled error as failed and still answers 200 (FIX-AC03)
  PriceAlertsCronSecretGuard
    √ rejects a wrong or missing secret with 401 and records it, without the secret (FIX-AC03)
$ npm run test:e2e   (GET /cron/price-alerts: 401 ×3; recordRejections ≤ 1 lần, không chứa 'wrong-secret'; lượt lock-skip → outcome 'skipped')
```

### `EPIC-002-FIX-AC04`

```
    √ writes at most once per minute under 10,000 rejected calls, keeping the count (FIX-AC04)
    √ adds the count to its UTC minute in the day hash with one EVAL, storing nothing else (FIX-AC04)
```

10.000 lần gọi sai secret trong 50 giây chỉ tạo đúng 1 lần `recordRejections` (count = 1). Lần gọi đầu tiên sau đó, qua mốc 1 phút, mang count = 10.000. Không có tin Zalo nào được gửi, vì guard không có đường nào tới Zalo. Phần kiểm chứng với Redis thật có trong `test/price-alerts.redis.e2e-spec.ts` nhưng **chưa chạy** (xem §6).

### `EPIC-002-FIX-AC05`

```
    √ stays quiet at T+14 and sends one full "down" message in [T+15, T+20] (FIX-AC05)
    √ carries every field FR04 asks for, in Vietnam time (FIX-AC05)
    √ messages the owner once the check has been down 15 minutes, with alert count and signal
```

### `EPIC-002-FIX-AC06`

```
    √ alerts with "never" when there was no healthy run since the watcher started (FIX-AC06)
    √ says "never" when there was no healthy run (FIX-AC06)
```

### `EPIC-002-FIX-AC07`

```
    √ sends nothing more for 6h after a delivered message, then one reminder (FIX-AC07)
```

### `EPIC-002-FIX-AC08`

```
    √ sends one "recovered" message after a notified outage, then nothing (FIX-AC08)
    √ sends nothing for a 10-minute gap that recovers, or for an unnotified outage (FIX-AC08)
    √ sends one recovery message after a notified outage (FIX-AC08)          (service)
```

### `EPIC-002-FIX-AC09`

```
    √ names what was seen after the last healthy run, with counts (FIX-AC09)
    √ reports rejected calls since the outage began (FIX-AC09)
    √ names the signal seen during an outage (FIX-AC09)                      (formatter)
```

### `EPIC-002-FIX-AC10`

```
    √ keeps retrying the "down" message until it is delivered (FIX-AC10)
    √ does not mark a failed send as notified and retries on the next run (FIX-AC10)
```

Việc gửi tin cho owner nằm ở một endpoint khác, không nằm trong lượt canh giá, nên không ảnh hưởng tin cảnh báo của người dùng.

### `EPIC-002-FIX-AC11`

```
    √ sends nothing without an owner chat, but keeps watching and records that (FIX-AC11)
$ npm run test:e2e   (app boot với OWNER_CHAT_ID bị xoá khỏi env; watcher → setMonitorState({ ownerChatConfigured: false }), Zalo không được gọi)
```

### `EPIC-002-FIX-AC12`

```
    √ sends at most 3 messages over 3 hours when Redis is unreachable (FIX-AC12)
    √ holds repeats to one an hour when a delivered message cannot be saved (FIX-NFR05)
```

### `EPIC-002-FIX-AC13`

```
    √ alerts once the watcher is silent 30 minutes, and by W+35 at the latest (FIX-AC13)
    √ sends one "recovered" message when the watcher runs again (FIX-AC13)
    √ checks the watcher on minutes divisible by 5, after releasing the lock (FIX-AC13)
    √ messages the owner once the watcher has been silent 30 minutes (FIX-AC13)
```

### `EPIC-002-FIX-AC14`

```
  price-alerts report lib (EPIC-002-FIX-FR09)
    √ finds one 52-minute outage made of "not called" then "rejected" (FIX-AC14)
    √ computes AC18 gaps over healthy runs only, reading pre-FIX runs as healthy
```

Chạy thử `printReport` offline với dữ liệu giả:

```
Outages (>= 15 min without a healthy run): 1
  2026-09-25T03:00:00.000Z -> ongoing (30 min): not called, rejected x4
Monitoring:
  Watcher last ran: never (not set up yet?)
```

### `EPIC-002-FIX-AC15`

Report chỉ dùng `lrange`, `scard`, `get`, `hgetall`. Test Redis thật (`runs the report with read commands only and writes nothing`) bọc client bằng một proxy chỉ cho phép lệnh đọc, và so sánh tập key trước và sau. Test này đã viết nhưng **chưa chạy được** vì Docker daemon không chạy trên máy lúc implement (§6). Trên production, owner chạy bằng token read-only.

### `EPIC-002-FIX-AC16`

Chưa làm được: cần quan sát production 24 giờ sau deploy (owner).

### `EPIC-002-FIX-AC17`

Chưa làm được: cần thử thật sau deploy, theo `DEPLOYMENT.md` §8b bước 6 (owner).

### `EPIC-002-FIX-AC18`

```
$ grep -n "env pull" docs/DEPLOYMENT.md
56:   vercel env pull .env
216:   **Sensitive** on Vercel, so `vercel env pull` can't fetch them (it writes
```

Dòng 56 là `POSTGRES_URL` của EPIC-001, không liên quan tới `KV_REST_API_*`. Dòng 216 chính là lời cảnh báo mới. Bước "≥ 3 lượt healthy mới trong 5 phút" nằm ở §8a bước 4.

### `EPIC-002-FIX-AC19`

```
    √ still processes alerts and answers 200 when the run-log write fails (FIX-AC19)
$ npm test → 185 passed (toàn bộ 132 test cũ vẫn pass); npm run test:e2e → 23 passed
```

### `EPIC-002-FIX-AC20`

```
  GET /cron/price-alerts-watch (EPIC-002-FIX)
    √ rejects the digest secret, the check secret and no secret, sending nothing (FIX-AC20)
    √ runs the watcher for its own secret, as a header or bearer token, and answers 200
    √ still answers 200 when Redis fails
```

## 4. Deviations from the plan

1. **Không lấy baseline Upstash thật trước bước 4** (R2). Owner quyết định bỏ qua ngày 2026-09-25 và dùng ước tính của plan: khoảng 295k lệnh/tháng khi bình thường, khoảng 339k khi xấu nhất. Phải kiểm lại sau deploy (§6).
2. **Hash rejected dùng field theo từng phút**, thay vì một hash theo ngày chỉ có tổng như plan mô tả. Chỉ có tổng thì report không đặt được các lượt bị từ chối vào đúng đợt ngừng (AC14), và bên quan sát không đếm được "từ lúc ngừng". Cách lưu này vẫn tốn 1 `EVAL` mỗi lần ghi.
3. **Tên `recordRejections(count, at)`** thay cho `recordRejection(count)`, vì cần biết thời điểm để chọn đúng field phút.
4. **Một formatter `formatMonitorMessage(action, activeAlerts)`** thay cho 5 hàm riêng như plan liệt kê, cộng `formatMonitorStateUnreadableMessage()`. Nội dung tin giống plan, chỉ gom lại cho gọn.
5. **Số lần bị từ chối đọc theo hai pha**: đánh giá lần đầu với số 0, nếu có tin sắp gửi thì đọc Redis rồi đánh giá lại. Cách này giữ `evaluateMonitor` là hàm đồng bộ, và chỉ tốn lệnh đọc khi thật sự sắp gửi, đúng như ngân sách của plan.
6. **`countAlerts()` (`SCARD`) chỉ gọi khi gửi tin down/reminder**, để lấy số "cảnh báo đang không được canh" (FR04). Plan không liệt kê lệnh này; nó chỉ chạy khi đang có sự cố nên không đáng kể về ngân sách.
7. **Không verify chữ ký QStash**, như plan §7.
8. **Commit thêm `6434eef`** ngoài 7 bước. Đây là lỗi tìm ra khi rà thứ tự lỗi (§6), nằm trong phạm vi NFR05, không mở rộng phạm vi.

## 5. Discovered work

| Item | Where it went |
|---|---|
| `npm run lint` (`eslint --fix`) chuyển các file CRLF (do `core.autocrlf=true` trên Windows) sang LF, làm hàng chục file không liên quan hiện là "modified", dù nội dung không đổi. Tôi chỉ commit các file của epic này | Ghi ở đây. Nên thêm `.gitattributes` (`* text=auto eol=lf`) bằng một PR chore riêng; cần owner quyết |
| Guard so sánh secret bằng `!==` (không phải thời gian cố định) | Có từ trước, plan §7 đã loại. Ghi lại cho reviewer |
| `DEPLOYMENT.md` §3a vẫn dùng `vercel env pull .env` cho `POSTGRES_URL`. Cách này có thể gặp cùng vấn đề nếu biến bị đánh dấu Sensitive | Ngoài phạm vi (spec chỉ nói về `KV_REST_API_*`). Ghi cho owner |

## 6. Known gaps

- **Ngân sách Upstash chưa được đo** (R2, NFR04). Các con số khoảng 295k/339k lệnh/tháng là ước tính, chưa đối chiếu dashboard. Ngoài ra chưa rõ Upstash tính một `EVAL` (có 2 lệnh bên trong) và một `MULTI` là mấy lệnh. Sau deploy owner phải mở Upstash → Usage. Nếu số thật trên 320k thì giãn watchdog sang 10 phút và giảm `MONITOR_RUNS_WINDOW` xuống 20.
- **Chưa chạy test Redis thật** (`test/price-alerts.redis.e2e-spec.ts`, 3 test mới cho AC04, AC15 và round-trip state, cùng 5 test cũ). Docker Desktop không chạy trên máy lúc implement. Chạy trước khi merge: `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis` (setup ở đầu file).
- **Giới hạn chống spam theo instance.** "≤ 1 ghi/phút" cho lượt bị từ chối (R3), và "≤ 1 tin/giờ khi Redis lỗi" (NFR05, AC12), đều dựa vào bộ nhớ của một instance warm. Nếu Vercel mở nhiều instance cùng lúc thì mỗi instance có giới hạn riêng. Trong thực tế watcher (5 phút/lần) và check (mỗi phút) gần như luôn trúng cùng một instance, nhưng đây là điều reviewer nên soi.
- **Đuôi đếm rejected có thể mất.** Các lần bị từ chối trong phút sau lần ghi chỉ được cộng vào lần ghi kế tiếp. Nếu không có lần gọi nào nữa thì phần đuôi đó mất, nên số đếm là cận dưới. Spec cho phép điều này (AC04: "không nhỏ hơn 1").
- **"Không được gọi" trong report** được suy ra khi có một khoảng ≥ 3 phút trong đợt ngừng không có ghi nhận nào. Ngưỡng này do tôi đặt, vì lượt rejected chỉ được ghi khoảng 1 lần/phút.
- **Hai lượt watcher chạy chồng nhau** (QStash giao trùng) có thể gửi trùng tin "down". Endpoint luôn trả 200 nên QStash không retry; rủi ro thấp và không có lock riêng.
- **Phụ thuộc chung nhà cung cấp** (R1): QStash và Redis cùng là Upstash. Owner nên chấp nhận bằng văn bản ở review.
- **Việc owner phải làm khi deploy**, theo `DEPLOYMENT.md` §8b:
  1. Thêm `PRICE_ALERTS_WATCH_SECRET` (đánh dấu Sensitive) và `OWNER_CHAT_ID` trên Vercel Production.
  2. `npx vercel deploy --prod`.
  3. `curl` endpoint watch với secret phải nhận 200, không có secret phải nhận 401.
  4. Tạo QStash schedule `*/5 * * * *` với header `Upstash-Forward-X-Cron-Secret-Token`.
  5. Trong 5 phút, report phải thấy watcher chạy và "Owner chat: configured".
  6. Tắt cron-job.org khoảng 20 phút để thử AC17.
  7. Sau 24 giờ: không có tin giám sát nào (AC16), rồi xem Upstash Usage và Vercel Usage.
