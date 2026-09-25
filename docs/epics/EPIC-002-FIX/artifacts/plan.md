# Implementation Plan — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Author:** Engineer
**Status:** Approved (Thach, 2026-09-25)
**Created:** 2026-09-25
**Traces to:** `spec.md`

---

## 1. Approach

Thay đổi gồm ba phần, tất cả nằm trong module `src/price-alerts/` hiện có và dùng Upstash Redis của EPIC-002. Không thêm store mới, không đụng Postgres.

1. **Ghi đủ mọi lượt gọi (FR01, FR02).** `AlertRunSummary` có thêm trường `outcome: 'healthy' | 'no-price' | 'failed' | 'skipped'`. Controller tự phân loại (`no-price` khi có cảnh báo mà `loadPrices` trả map rỗng) và ghi summary cả ở nhánh bỏ qua vì lock lẫn nhánh `catch`, thay vì chỉ ghi lượt thành công như hiện nay (`price-alerts.controller.ts:40-50`). Việc ghi luôn best-effort, có try/catch riêng, nên không bao giờ làm hỏng lượt kiểm tra (NFR09). Lượt `rejected` bị chặn ở guard trước khi vào handler, nên được ghi từ bên trong `PriceAlertsCronSecretGuard`: đếm trong bộ nhớ của instance và ghi xuống Redis tối đa một lần mỗi phút, bằng **một** lệnh `EVAL` (`HINCRBY` + `EXPIRE` vào hash theo ngày). Không lưu secret hay header (NFR03).
2. **Bên quan sát (FR03–FR06, FR08).** Thêm endpoint mới `GET /cron/price-alerts-watch`, guard bằng secret riêng `PRICE_ALERTS_WATCH_SECRET` (NFR08). Endpoint được **Upstash QStash Schedules** gọi mỗi 5 phút. QStash là một nhà lập lịch khác cron-job.org (owner đã chọn phương án B). Mỗi lượt, bên quan sát đọc 30 summary mới nhất cùng trạng thái giám sát, suy ra lượt khoẻ gần nhất, rồi chạy một hàm thuần `evaluateMonitor(state, runs, now)`. Hàm này quyết định gửi gì: `down`, `reminder`, `recovered`, hoặc không gửi. Tin được gửi tới `OWNER_CHAT_ID` (cấu hình mới, không bắt buộc; FR08). Chỉ khi Zalo nhận tin thì mới lưu trạng thái "đã báo" (AC10).
3. **Quan sát ngược (FR07).** Ở những lượt kiểm tra giá rơi vào phút chia hết cho 5, controller đọc nhịp của bên quan sát, được bên quan sát ghi trong trạng thái của nó mỗi lượt. Quá 30 phút không thấy nhịp thì controller báo owner, với trạng thái chống spam riêng. Nếu làm ở mọi lượt thì tốn 43k lệnh/tháng. Làm mỗi 5 phút chỉ tốn khoảng 8,6k, mà vẫn đạt AC13 (W+35 phút).

Report `scripts/price-alerts-report.js` được viết lại để đọc các loại ghi nhận mới, liệt kê các đợt ngừng và chỉ tính AC18 trên lượt `healthy` (FR09). `docs/DEPLOYMENT.md` §8a và `docs/ARCHITECTURE.md` được sửa theo FR10, FR11.

**Chọn QStash thay vì Cloudflare Workers Cron Triggers.** Cả hai đều miễn phí, chạy được ≤ 5 phút và độc lập với cron-job.org. QStash free có 1.000 message/ngày và 10 schedule ([pricing](https://upstash.com/pricing/qstash)). Mỗi 5 phút là 288 message/ngày, chiếm 29% hạn mức. QStash cho đặt header tuỳ chỉnh qua `Upstash-Forward-*`, và owner đã có tài khoản Upstash, nên không phải mở tài khoản mới hay deploy thêm code nào ngoài repo. Cloudflare Workers free có 5 cron trigger và 100k request/ngày ([limits](https://developers.cloudflare.com/workers/platform/limits/)), khác nhà cung cấp hẳn với Redis. Đổi lại, nó cần một tài khoản mới và một worker nhỏ deploy bằng `wrangler`, tức là thêm một thứ phải bảo trì ngoài Vercel. Đánh đổi của QStash là dùng chung nhà cung cấp với Redis (xem §4 rủi ro R1). Cloudflare được ghi trong `DEPLOYMENT.md` làm phương án dự phòng; endpoint không cần sửa vì chỉ phụ thuộc header secret.

**Phương án bị loại: ghi `lastHealthyAt` thành một key riêng ở mỗi lượt khoẻ.** Cách này đơn giản hơn cho bên quan sát, nhưng tốn thêm một lệnh ghi mỗi phút (+43k/tháng) chỉ để lặp lại thông tin đã có trong run log. Bên quan sát suy ra lượt khoẻ gần nhất từ `LRANGE runs 0 29` và lưu mốc đó vào trạng thái của chính nó, nên không cần lệnh ghi thêm nào ở đường chạy mỗi phút.

## 2. Files

| Path | Change | Why |
|---|---|---|
| `src/price-alerts/interfaces/price-alert.interface.ts` | Thêm `RunOutcome`; `AlertRunSummary.outcome` (optional để đọc được bản ghi cũ); thêm `MonitorState`, `WatchdogState`, `MonitorNotice` | FR01, FR02, FR05–FR07 |
| `src/price-alerts/price-alerts.constants.ts` | Thêm key `monitor`, `watchdog`, `monitorNotices`, `rejected(day)`; hằng `OUTAGE_THRESHOLD_MS = 15m`, `OUTAGE_REMINDER_MS = 6h`, `WATCHER_SILENCE_MS = 30m`, `STATE_UNREADABLE_NOTICE_MS = 1h`, `MONITOR_RUNS_WINDOW = 30`, `MAX_MONITOR_NOTICES = 500` | Một nơi cho các ngưỡng của spec |
| `src/price-alerts/price-alerts.controller.ts` | Phân loại `outcome`; ghi summary ở nhánh `skipped` và `catch` (best-effort); ở phút chia hết cho 5 thì gọi `monitorService.checkWatcher()` sau khi nhả lock | FR01, FR02, FR07, NFR09 |
| `src/price-alerts/price-alerts.service.ts` | `recordRejection(count)` (một `EVAL`), `listRecentRuns(n)`, get/set cho monitor/watchdog, `recordMonitorNotice` | FR02, FR03, NFR03, NFR10 |
| `src/price-alerts/price-alert-monitor.ts` **(mới)** | Hàm thuần `evaluateMonitor(state, runs, now)` và `evaluateWatchdog(state, now)` trả về hành động và trạng thái mới; `classifySignal(runs, rejectedCount)` | FR03–FR07, test không cần mock |
| `src/price-alerts/price-alerts-monitor.service.ts` **(mới)** | Điều phối một lượt quan sát: đọc Redis, gọi hàm thuần, gửi Zalo tới owner, lưu trạng thái chỉ khi gửi xong; nhánh Redis lỗi thì throttle theo bộ nhớ (NFR05) | FR03–FR08, AC10, AC12 |
| `src/price-alerts/price-alerts-watch.controller.ts` **(mới)** | `@All('price-alerts-watch')` dưới `@Controller('cron')`, guard `PriceAlertsWatchSecretGuard`, luôn trả `200` | FR03, NFR08 |
| `src/price-alerts/price-alerts.module.ts` | Đăng ký controller và service mới | |
| `src/common/guards/price-alerts-cron-secret.guard.ts` | Override hook `onRejected()`: đếm trong bộ nhớ và flush ≤ 1 lần/phút qua `PriceAlertsService.recordRejection` (fire-and-forget có `.catch`, không làm chậm `401`) | FR02, NFR03, AC04 |
| `src/common/guards/cron-secret.guard.ts` | Thêm hook `protected onRejected(): void {}` (mặc định không làm gì), gọi ngay trước `throw` | Để guard con ghi nhận mà không đổi hành vi của `/cron/daily-digest` |
| `src/common/guards/price-alerts-watch-secret.guard.ts` **(mới)** | `secretConfigKey = 'priceAlerts.watchSecretToken'` | NFR08, AC20 |
| `src/config/env.validation.ts` | `PRICE_ALERTS_WATCH_SECRET: Joi.string().min(16).max(256).optional()`, `OWNER_CHAT_ID: Joi.string().max(64).optional()` | FR08, NFR08; không có thì bot vẫn boot |
| `src/config/configuration.ts` | `priceAlerts.watchSecretToken`, `monitoring.ownerChatId` | RULES.md: env chỉ đọc qua config |
| `src/utils/format-message.util.ts` | `formatMonitorDownMessage`, `formatMonitorReminderMessage`, `formatMonitorRecoveredMessage`, `formatWatcherDownMessage`, `formatWatcherRecoveredMessage`, `formatMonitorStateUnreadableMessage`; giờ ICT dùng lại `ICT_OFFSET_MS` | FR04–FR07 |
| `scripts/price-alerts-report.js` | Đếm theo loại; dựng các đợt ngừng ≥ 15 phút từ run log và hash rejected; lượt khoẻ gần nhất, nhịp bên quan sát, `ownerChatConfigured`, tin giám sát gần nhất; AC18/NFR02 chỉ tính trên `healthy` (bản ghi cũ không có `outcome` coi là `healthy`); chỉ dùng lệnh đọc | FR09, NFR11 |
| `scripts/price-alerts-report.lib.js` **(mới)** | Tách phần tính toán thuần (`buildOutages`, `countOutcomes`, `percentile`) ra khỏi I/O để unit test được | AC14 |
| `src/price-alerts/price-alert-monitor.spec.ts` **(mới)** | Unit test hàm thuần: ngưỡng, nhắc 6h, hồi phục, chưa từng khoẻ, dao động, chữ ký dấu hiệu | AC05–AC09, AC13 |
| `src/price-alerts/price-alerts-monitor.service.spec.ts` **(mới)** | Mock Redis/Zalo: gửi thất bại thì không lưu, thiếu owner chat, Redis lỗi 3h | AC10–AC12 |
| `src/price-alerts/price-alerts.controller.spec.ts` | Thêm case phân loại outcome, ghi ở nhánh skipped/failed, ghi hỏng thì lượt vẫn chạy | AC01–AC03, AC19 |
| `src/common/guards/price-alerts-cron-secret.guard.spec.ts` **(mới)** | 10.000 lần từ chối/phút thì ≤ 1 lệnh ghi; không có secret trong payload | AC03, AC04 |
| `src/price-alerts/report-lib.spec.ts` **(mới)** | Import `scripts/price-alerts-report.lib.js`; đặt dưới `src/` để khớp `testRegex` của `npm test` | AC14 |
| `test/webhook.e2e-spec.ts` | `describe('GET /cron/price-alerts-watch')`: 401 với digest secret / check secret / không secret; 200 với watch secret; check endpoint trả response như cũ | AC03, AC20, AC19 |
| `test/price-alerts.redis.e2e-spec.ts` | Opt-in, Redis thật: `recordRejection` đúng một lệnh, TTL hash; round-trip trạng thái monitor; report lib chạy trên dữ liệu thật với client chỉ cho phép lệnh đọc | AC04, AC15 |
| `.env.example` | `PRICE_ALERTS_WATCH_SECRET=`, `OWNER_CHAT_ID=` | |
| `docs/DEPLOYMENT.md` §8a | Sửa bước 4 (KV từ Upstash Console, token read-only); thêm bước xác nhận ≥ 3 lượt `healthy` trong 5 phút; mục 8b: tạo QStash schedule (`*/5 * * * *`, header `Upstash-Forward-X-Cron-Secret-Token`), `OWNER_CHAT_ID`, cách thử báo động (tắt job 20 phút), tắt hẳn = tắt cả hai; phương án dự phòng Cloudflare | FR10, AC17, AC18 |
| `docs/ARCHITECTURE.md` §"Price alerts" | Bên quan sát, sáu loại ghi nhận, ngân sách mới | FR11 |
| `docs/API.md` | Endpoint `/cron/price-alerts-watch` | |

## 3. Order

Nhánh: `feature/epic-002-fix-alert-monitoring` từ `master`, một PR, mỗi bước một commit Conventional Commits.

1. **`feat(price-alerts): classify every check run outcome`**: interface, constants, controller ghi `outcome` và ghi cả `skipped`/`failed`, cùng test controller. *Sau bước này:* run log phân biệt được `healthy`/`no-price`/`failed`/`skipped`; hành vi cảnh báo và response giữ nguyên (toàn bộ test EPIC-002 vẫn xanh).
2. **`feat(price-alerts): count rejected check calls with a per-minute write cap`**: hook `onRejected` ở `CronSecretGuard`, override ở guard price-alerts, `recordRejection` bằng một `EVAL`, cùng unit test AC04. *Sau bước này:* lượt `rejected` có dấu vết, và kẻ gọi bừa không đốt được quota.
3. **`feat(price-alerts): pure outage/watchdog evaluator`**: `price-alert-monitor.ts` và spec. *Sau bước này:* toàn bộ quy tắc 15 phút / 6 giờ / hồi phục / 30 phút được chứng minh bằng unit test, chưa nối vào đâu.
4. **`feat(price-alerts): owner notifications and watch endpoint`**: config và env validation, guard watch, `PriceAlertsMonitorService`, `PriceAlertsWatchController`, formatter, unit test service, e2e 401/200. *Sau bước này:* gọi `/cron/price-alerts-watch` là có báo động. Bot boot được khi thiếu cả hai env mới.
5. **`feat(price-alerts): check run watches the watcher`**: controller gọi `checkWatcher()` ở phút chia hết cho 5, cùng test. *Sau bước này:* FR07 hoạt động.
6. **`feat(scripts): outage-aware alerts report`**: tách lib, viết lại report, unit test AC14, e2e AC15 (opt-in). *Sau bước này:* owner xem được các đợt ngừng và nguyên nhân quan sát được.
7. **`docs(price-alerts): monitoring setup and fixed measurement steps`**: `DEPLOYMENT.md`, `ARCHITECTURE.md`, `API.md`, `.env.example`. *Sau bước này:* AC18 kiểm được bằng cách đọc tài liệu.

**Thứ tự deploy** (ghi trong `DEPLOYMENT.md` §8b):
- (a) Thêm `PRICE_ALERTS_WATCH_SECRET` và `OWNER_CHAT_ID` trên Vercel, Production, đánh dấu Sensitive cho secret.
- (b) `npx vercel deploy --prod` (owner chạy; project không nối git).
- (c) `curl` endpoint watch với secret, phải nhận `200`, rồi kiểm tra không secret phải nhận `401`.
- (d) Tạo QStash schedule. Chỉ bật **sau** khi deploy, để QStash không gọi vào 404.
- (e) Trong 5 phút, report phải thấy "bên quan sát chạy lần cuối" < 5 phút và ≥ 3 lượt `healthy` mới.
- (f) Thử thật AC17: tắt job cron-job.org khoảng 20 phút, phải nhận tin ngừng; bật lại, phải nhận tin hồi phục.

## 4. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **R1. QStash và Redis cùng là Upstash.** Nếu Upstash sập toàn bộ thì cả bên quan sát lẫn trạng thái cùng mất, và không ai báo | Thấp | Chấp nhận ở quy mô hiện tại. Nếu chỉ Redis sập mà QStash còn, bên quan sát vẫn báo "không đọc được trạng thái" (NFR05). Phương án Cloudflare được ghi sẵn trong `DEPLOYMENT.md`; đổi sang chỉ cần tạo cron trigger, không sửa code. Ghi vào review để owner chấp nhận bằng văn bản |
| **R2. Ngân sách Upstash (ít chắc chắn nhất).** Baseline ~260k/tháng mới là **ước tính** (khoảng 6 lệnh/lượt: `SET` lock, `SMEMBERS`, `MGET`, `LPUSH`+`LTRIM`, `EVAL` release); chưa rõ Upstash tính một multi-exec là bao nhiêu lệnh | Trung bình | Phép tính ở dưới. **Trước khi code bước 4**, owner mở Upstash Console → database → Usage và đọc số *Commands* của ngày 2026-09-25, ngày đầu chạy đủ 24 giờ mỗi phút. Engineer nhân lên 30 ngày, cộng phần tăng thêm, và ghi kết quả thành amendment vào plan này. Nếu baseline thực > 320k: chuyển kiểm tra watchdog sang mỗi 10 phút và giảm cửa sổ `LRANGE` xuống 20 |
| **R3. Đếm `rejected` theo instance.** Giới hạn "≤ 1 ghi/phút" là theo từng instance warm. Tấn công đồng thời có thể làm Vercel mở N instance, thành N ghi/phút | Thấp | Số instance đồng thời của Hobby có trần. Kẻ tấn công ở mức đó tốn quota invocation của Vercel trước khi tốn Upstash. Ghi rõ trong review (`risk-security-reviewer` §"abuse vectors"). AC04 được chứng minh trên một instance, đúng như spec cho phép số đếm xấp xỉ |
| **R4. Hỏng hành vi hiện có của check** (blast radius: `PriceAlertsController.checkPriceAlerts`, được cron-job.org gọi; `CronSecretGuard` còn guard `/cron/daily-digest`) | Thấp | Hook `onRejected` mặc định rỗng, nên digest không đổi. Mọi lệnh ghi mới trong check nằm trong try/catch riêng (NFR09). Chạy lại toàn bộ unit và e2e của EPIC-002 ở mỗi bước (AC19). `checkWatcher()` chạy sau khi nhả lock, nên không kéo dài thời gian giữ lock |
| **R5. Báo động giả khi deploy** (khoảng hở giữa deploy và bật QStash, hoặc cron-job.org trễ) | Trung bình | Mốc của FR03 là "lúc bên quan sát bắt đầu" (`watcherStartedAt` ghi ở lượt quan sát đầu), nên trước khi QStash chạy thì không có báo động nào. Ngưỡng 15 phút lớn gấp khoảng 10 lần p95 đo được (81s). NFR02 được quan sát 24 giờ sau deploy (AC16) |
| **R6. QStash không forward header như tài liệu nói** | Thấp | Kiểm tra ở bước deploy (c)–(e). Dự phòng: guard watch nhận thêm `Authorization: Bearer` (đã có sẵn trong `CronSecretGuard.extractProvidedSecret`), và QStash forward được cả header này |
| **R7. Khó đảo ngược** | Thấp | Không có migration. Key Redis mới đều tách riêng. Rollback: tắt QStash schedule, rồi `vercel rollback`. Bản cũ bỏ qua trường `outcome` và các key mới |
| **R8. CPU Vercel** | Thấp | Xem phép tính. Endpoint watch chạy chung function `api/index.ts` với check (chạy mỗi phút), nên gần như luôn trúng instance warm và không tốn thêm cold start |

**Phép tính ngân sách (ước tính, sẽ thay bằng số dashboard, R2):**

| Nguồn | Lệnh/lượt | Lượt/tháng | Lệnh/tháng |
|---|---|---|---|
| Check hiện tại (baseline, *ước tính*) | ~6 | 43.200 | ~259k |
| Check: đọc watchdog ở phút chia hết cho 5 (`MGET` monitor+watchdog) | 1 | 8.640 | ~8,6k |
| Check: ghi `skipped`/`failed` (hiếm) | 2 | ≤ 500 | ≤ 1k |
| Bên quan sát: `MGET` trạng thái + `LRANGE runs 0 29` + `SET` trạng thái | 3 | 8.640 | ~26k |
| Bên quan sát: `HGET` rejected hôm nay (chỉ khi đang ngừng) và ghi notice | ≤ 2 | hiếm | < 1k |
| Rejected: một `EVAL`/phút, trường hợp xấu nhất là bị gọi bừa liên tục | 1 | ≤ 43.200 | ≤ 43,2k |
| **Tổng bình thường / xấu nhất** | | | **~295k / ~339k**, ≤ 400k (NFR04) |

QStash: 288 message/ngày trên hạn mức 1.000. **CPU:** giả sử ~50 ms Active CPU mỗi lượt quan sát (I/O chiếm phần lớn, không tính vào CPU), 8.640 × 50 ms ≈ 7,2 phút/tháng. Đọc watchdog trong check < 1 phút/tháng. Tổng < 10 phút, đạt ≤ 24 phút (NFR06). **Neon:** không có truy vấn Postgres nào ở cả hai endpoint, vì module price-alerts không import `SubscribersModule`. Số liệu thực của CPU và Upstash được kiểm theo AC16.

## 5. Proofs

| Criterion | Proof | How it is run |
|---|---|---|
| `EPIC-002-FIX-AC01` | Controller spec: 2 cảnh báo, giá có, nên summary `outcome: 'healthy'` | `npm test -- price-alerts.controller` |
| `EPIC-002-FIX-AC02` | Controller spec: `getPricesBySymbols` throw nên `no-price`; `listAll` rỗng nên `healthy`, không gọi CoinGecko. Monitor spec: `no-price` không làm lượt khoẻ gần nhất thay đổi | `npm test -- price-alerts` |
| `EPIC-002-FIX-AC03` | Guard spec (sai / thiếu secret thì `onRejected`, payload không chứa secret); controller spec (lock bị giữ thì `skipped` và `200`; `runCheck` throw thì `failed` và `200`); e2e 401/200 | `npm test`, `npm run test:e2e` |
| `EPIC-002-FIX-AC04` | Guard spec: 10.000 lần `canActivate` sai secret với fake timers trong 1 phút, `recordRejection` được gọi đúng 1 lần, count ≥ 1; không gửi Zalo. Redis e2e: `recordRejection` = 1 lệnh (đếm bằng mock `eval`) | `npm test -- guard`; `npm run test:e2e -- price-alerts.redis` |
| `EPIC-002-FIX-AC05` | Monitor spec: T+14 thì `none`; T+15 và T+20 thì `down` với đủ trường FR04 | `npm test -- price-alert-monitor` |
| `EPIC-002-FIX-AC06` | Monitor spec: không có lượt khoẻ, `watcherStartedAt = S`, S+20 thì `down` với "chưa từng" | như trên |
| `EPIC-002-FIX-AC07` | Monitor spec: đã báo lúc N, từ N+1h tới N+5h59 thì `none`, N+6h thì `reminder` | như trên |
| `EPIC-002-FIX-AC08` | Monitor spec: đợt đã báo, có lượt khoẻ R thì `recovered` đúng một lần; đợt 10 phút chưa báo thì không có gì | như trên |
| `EPIC-002-FIX-AC09` | Monitor spec `classifySignal`: toàn `rejected` / toàn `no-price` / rỗng thì ra đúng chuỗi dấu hiệu | như trên |
| `EPIC-002-FIX-AC10` | Monitor service spec: Zalo trả `false` thì không `set` trạng thái "đã báo"; lượt kế tiếp gửi lại | `npm test -- price-alerts-monitor.service` |
| `EPIC-002-FIX-AC11` | Service spec: `ownerChatId` undefined thì không gọi Zalo, vẫn ghi `ownerChatConfigured: false`; e2e: app boot khi thiếu `OWNER_CHAT_ID`/`PRICE_ALERTS_WATCH_SECRET` | `npm test`, `npm run test:e2e` |
| `EPIC-002-FIX-AC12` | Service spec: Redis throw ở mọi lượt, mô phỏng 36 lượt × 5 phút (3h) thì Zalo được gọi ≤ 3 lần | `npm test -- price-alerts-monitor.service` |
| `EPIC-002-FIX-AC13` | Monitor spec `evaluateWatchdog`: nhịp cuối W, W+35 thì `watcher-down`; có nhịp mới thì `watcher-recovered`. Controller spec: chỉ gọi `checkWatcher` ở phút chia hết cho 5 | `npm test -- price-alert` |
| `EPIC-002-FIX-AC14` | Report lib spec: dựng log 32 phút trống, rồi 20 phút `rejected`, rồi `healthy`, nên có 1 đợt 52 phút gồm "không được gọi" và "bị từ chối"; p95 chỉ tính trên `healthy` | `npm test -- report-lib` |
| `EPIC-002-FIX-AC15` | Redis e2e: report lib chạy với một client bọc chỉ cho phép `lrange/hgetall/mget/get/scard/smembers` (lệnh ghi thì throw). Production: owner chạy report với token read-only của Upstash | `npm run test:e2e -- price-alerts.redis`; thủ công |
| `EPIC-002-FIX-AC16` | Quan sát production 24 giờ: 0 tin giám sát; owner đọc Upstash Usage và Vercel Usage, nhân lên tháng rồi so với NFR04/NFR06 | Owner, sau deploy (bước (e) + 24h) |
| `EPIC-002-FIX-AC17` | Thử thật: tắt job cron-job.org, ≤ 20 phút có tin ngừng; bật lại, ≤ 5 phút có tin hồi phục | Owner, bước deploy (f) |
| `EPIC-002-FIX-AC18` | Review tài liệu: đi theo §8a/§8b từ đầu mà không dùng `vercel env pull` cho `KV_REST_API_*`; bước 5 phút có trong tài liệu | Verifier đọc `DEPLOYMENT.md`; `grep -n "env pull" docs/DEPLOYMENT.md` |
| `EPIC-002-FIX-AC19` | Toàn bộ unit và e2e hiện có vẫn xanh; controller spec: `recordRun` throw mà cảnh báo vẫn được gửi | `npm test && npm run test:e2e` |
| `EPIC-002-FIX-AC20` | e2e: `/cron/price-alerts-watch` với `CRON_SECRET_TOKEN`, với `PRICE_ALERTS_CRON_SECRET`, và không secret, cả ba trả `401`; Zalo mock không được gọi | `npm run test:e2e` |

## 6. Feedback loop

- Unit test (`npm test`) cho hàm thuần và service có mock. Đây là vòng chính, vì mọi quy tắc thời gian đều nằm trong `price-alert-monitor.ts` và chạy được với `now` giả.
- e2e (`npm run test:e2e`) cho guard và route.
- Redis thật khi cần: `redis:7-alpine` + `hiett/serverless-redis-http`, như EPIC-002 (epic-memory 2026-09-23).
- Chạy local `npm run start:dev`, rồi gọi hai endpoint bằng `node` fetch (không dùng `curl` của Git Bash, vì nó làm hỏng UTF-8), kèm `ZALO_API_BASE_URL` trỏ vào một stub để đọc được tin gửi cho owner.
- Sau deploy: `npm run alerts:report` bằng token read-only.

## 7. Deliberately not doing

- Không verify chữ ký `Upstash-Signature` của QStash. Header secret riêng đủ theo NFR08 và đồng nhất với hai endpoint máy gọi hiện có. Verify chữ ký sẽ cần thêm `QSTASH_CURRENT_SIGNING_KEY`/`NEXT` và một dependency.
- Không báo các chat có cảnh báo, không giám sát bản tin 9h (spec §7, Concern 3–4, owner chốt 2026-09-25).
- Không lệnh mute/ack qua chat, không tự sửa job.
- Không ghi `lastHealthyAt` riêng ở mỗi lượt (xem §1, phương án bị loại).
- Không so sánh secret trong thời gian cố định. Lỗi có từ trước (review EPIC-002), nằm ngoài phạm vi; ghi lại cho reviewer.
- Không đổi cadence mỗi phút hay hành vi cảnh báo của EPIC-002 (NFR09).
