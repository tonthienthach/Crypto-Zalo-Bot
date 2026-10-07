# Implement — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Author:** Engineer
**Status:** Chờ duyệt (bấm "Mark step done" khi đã đọc)
**Created:** 2026-10-07
**Traces to:** `plan.md`, `spec.md`

---

## 1. Branch / PR

- **Nhánh:** `feature/epic-004-simple-signals`, tạo từ `master`, đã đẩy lên `origin`. 13 commit (1 commit tài liệu epic + 12 commit theo các bước của plan), 63 tệp, +5.847/−10 dòng (49 tệp trong `src/`, `test/`, `scripts/`).
- **PR: chưa mở.** Máy này không có `gh` (GitHub CLI). Mở PR bằng liên kết: `https://github.com/tonthienthach/Crypto-Zalo-Bot/pull/new/feature/epic-004-simple-signals`. Nội dung PR gợi ý: tóm tắt §2 dưới đây, liên kết `spec.md` và tệp này, và danh sách việc cần làm sau deploy ở §6.
- Chưa merge, chưa deploy, chưa đặt env var nào trên Vercel, chưa tạo job cron-job.org (đúng mục "Deliberately not doing" của plan).

## 2. What was built

| Bước plan | Commit | Kết quả |
|---|---|---|
| 1. Hàm thuần và ngưỡng | `feat(signals): swing and verdict rules` | `src/signals/signals.constants.ts`, `interfaces/signal.interface.ts`, `signal-evaluator.ts` (+spec). `evaluateSignal()` cho dao động mạnh (≥ 8%/24h hoặc ≥ 15%/72h, biên bằng ngưỡng tính là mạnh) và nhận định mua/bán/theo dõi theo vị trí trong khoảng 7 ngày (đúng 25% tính là mua). |
| 2. `market_chart` | `feat(coingecko): market chart for history backfill` | `CoingeckoService.getMarketChart(symbol, days)` + kiểu phản hồi. Đã đo trên API thật (§3). |
| 3. Backtest, chấm điểm, không báo lặp | `feat(signals): backtest, scoring and repeat rules` | `signal-backtest.ts` (`runBacktest`, `scoreRecords`), `signal-repeat.ts` (`selectCoinsToAlert`, `recordSent`). |
| 4. Redis | `feat(signals): redis history and state stores` | `signals-history.service.ts` (2 script Lua: ghi mẫu theo giờ/ngày, đọc nhiều coin trong một lệnh; lấp lịch sử), `signals-state.service.ts` (bản sao watchlist, tắt/bật, trạng thái đã gửi, bản ghi nhận định, coin theo dõi tạm, sự kiện sử dụng, khoá chạy, log lượt chạy), `test/signals.redis.e2e-spec.ts` (17 ca trên Redis thật). |
| 5. Parser và formatter | `feat(signals): /tinhieu parsing and messages` | `CommandType.SIGNAL_*`, `parseSignal()`, `src/utils/format-signals.util.ts` (tệp riêng vì `format-message.util.ts` đã 682 dòng), `formatHelpReply`, tham số `signalsSection` của `formatDailyDigestReply`. |
| 6. Lệnh trong webhook | `feat(signals): /tinhieu commands` | `SignalsService`, `SignalsSubscriptionsMirror`, `SignalsModule`, các `case SIGNAL_*`, gọi bản sao sau `/dangky` `/watchlist` `/huy`, ghi nhận định và sự kiện sau khi trả lời, cấu hình `signals.*` và env, `docs/API.md`. |
| 7. Endpoint kiểm tra định kỳ | `feat(signals): periodic signal check and proactive alerts` | `SignalsController` (`GET/POST /cron/signals`), `SignalsCronSecretGuard` (`SIGNALS_CRON_SECRET`), log `signals-run`. |
| 8a. Bản tin 9h | `feat(digest): signals section` | `DigestController` đồng bộ lại bản sao watchlist, tải tín hiệu một lần cho hợp mọi watchlist, phần "Tín hiệu" của từng chat trong `try/catch` riêng, ghi nhận định và sử dụng sau khi gửi được. |
| 8b. Giám sát | `feat(price-alerts): watch the signals check` | `SignalsMonitorService` + `evaluateSignalsMonitor()` (hàm thuần), gọi từ cùng nhịp QStash của `PriceAlertsWatchController`. |
| 9. Báo cáo và tài liệu | `feat(signals): usage report`, `docs(signals): ...` | `npm run signals:report`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` bước 8c, `docs/ROADMAP.md`, `CHANGELOG.md`, `.env.example`. |
| 10. Sau deploy | — | **Không thuộc code, chưa làm** (§6). |

## 3. Proofs executed

Mọi lệnh dưới đây đã chạy thật trong phiên này, kết quả là đầu ra thật của lệnh.

| Criterion | Lệnh | Kết quả |
|---|---|---|
| `AC01` `AC02` `AC03` `AC11` | `npx jest src/signals/signal-evaluator` | Tests: 14 passed (gồm biên đúng 15%, đúng 25%, +3%/+5% không có nhận định, lịch sử 5 ngày → `insufficientData`) |
| `AC03` | `npx jest src/signals/signal-evaluator src/signals/signals.controller` | Test Suites: 2 passed; Tests: 31 passed (mọi coin không mạnh → không gửi tin) |
| `AC04` `AC05` `AC06` `AC07` `AC15` `AC16` | `npx jest src/signals/signal-repeat src/signals/signals.controller` | Test Suites: 2 passed; Tests: 26 passed. Gồm: 10:00 gửi, 10:20 và 10:50 không gửi, 11:00 gửi ETH; chạy hai lần liền chỉ một tin; BTC/ETH/SOL một tin; −18% không báo, −21% báo, đổi chiều báo ngay; nguồn giá lỗi không gửi, một chat lỗi không chặn chat khác; 50 chat × 30 coin → `getPricesBySymbols` ≤ 2 lần |
| `AC08` `AC09` | `npx jest src/digest` | Tests: 20 passed (9 ca tín hiệu: có coin mạnh, một dòng khi không có, một lần tải cho mọi chat, lỗi tính tín hiệu vẫn gửi phần giá, chat khác không bị ảnh hưởng) |
| `AC10` `AC18` | `npx jest src/utils` | Tests: 70 passed (formatter, `/help` liệt kê `/tinhieu`) |
| `AC10` `AC11` `AC12` `AC13` `AC14` | `npx jest --config ./test/jest-e2e.json webhook` | Tests: 58 passed, gồm 14 ca `/tinhieu`, 2 ca `/cron/signals` (401 với bốn loại secret sai, 200 với secret đúng), 1 ca nhịp watcher |
| `AC12` | `npx jest src/signals/signal-backtest` | Tests: 9 passed. Chuỗi dựng tay cho đúng mua 6 lần (đúng 4), bán 5 lần (đúng 2); dưới 14 ngày bị từ chối |
| `AC13` `AC14` `AC05` | `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json signals.redis` | Test Suites: 1 passed; Tests: 17 passed (script Lua thật: ghi idempotent theo giờ, cắt điểm quá cũ, khoá chạy chỉ một chủ, cùng coin-nhận định-ngày ghi một lần, tắt/bật còn sau khi tạo lại service) |
| `AC17` | `npx jest scripts src/signals/report-lib`; `signals:report` trên Redis scratch | Tests: 10 passed (gồm kiểm tra `scoreAll` của script khớp `scoreRecords` của app). Chạy script thật in đúng chỉ số thành công, chấm điểm, lượt chạy gần nhất (đầu ra ở §3.2); log `signals-run` không chứa nhận định (test trong `signals.controller.spec.ts`) |
| `NFR07` | `npx jest src/signals/signals-monitor` và `npx jest src/price-alerts` | 16 passed; và 100 passed, 6 suites (toàn bộ spec cảnh báo giá cũ vẫn xanh, không sửa spec nào) |
| Toàn bộ | `npx jest` | Test Suites: 33 passed; Tests: 476 passed |
| Toàn bộ e2e | `REDIS_INT_URL=... npx jest --config ./test/jest-e2e.json --runInBand` | 3 passed, 1 skipped (Postgres); Tests: 84 passed, 18 skipped |
| Như CI | `npx jest --config ./test/jest-e2e.json` (không có URL Redis) | 1 passed, 3 skipped; Tests: 58 passed, 44 skipped |
| Chất lượng | `npx eslint` (các thư mục đã sửa), `npx tsc --noEmit`, `npm run build` | không lỗi |

`NFR01` (≤ 30 phút), `NFR02` (≤ 5 giây p95), ngân sách lệnh Upstash và `NFR04` (dung lượng) **không** chứng minh được bằng test; đo sau deploy (§6), đúng như plan §5.

### 3.1 Đo `market_chart` thật (plan bước 2)

- `GET /coins/bitcoin/market_chart?vs_currency=usd&days=90`, không key: HTTP 200, 2.161 điểm cách nhau 1 giờ, phủ đủ 90 ngày, khoảng 223 KB.
- 5 coin liên tiếp, không nghỉ (ethereum, solana, binancecoin, ripple, cardano): đều HTTP 200, mỗi lệnh khoảng 0,5 giây, 220–225 KB. Giới hạn tốc độ không chạm tới ở mức 5 coin/lượt, nên không thêm khoảng nghỉ; lỗi 429 vẫn được xử lý (bỏ qua coin, giữ 2 giờ, thử lại).

### 3.2 Chạy thật cả hệ thống (plan §6, "instance chạy tay")

Ứng dụng đã build (`node dist/main`), Redis scratch (Docker), CoinGecko thật, server Zalo giả ghi lại nội dung gửi. Ngưỡng hạ xuống 0,05%/0,1% để ép có tín hiệu.

- `GET /cron/signals` lần 1: `{"event":"signals-run",...,"outcome":"healthy","coins":2,"chatsAlerted":1,"failures":0,"deferred":0,"durationMs":1455}` (gồm lấp lịch sử 90 ngày cho 2 coin). Tin gửi tới chat có BTC và ETH trong **một** tin, nhận định, lý do bằng số, câu miễn trừ, "Tắt tin này: /tinhieu tat".
- Lần 2 ngay sau đó: `durationMs: 31`, **không gửi thêm** (giới hạn 1 giờ).
- `/tinhieu btc`, `/tinhieu backtest btc`, `/tinhieu thongke`, `/tinhieu tat`, `/tinhieu xyzabcdef` qua webhook: đều trả lời đúng; mã lạ dùng thông báo của `/gia`.
- Backtest chạy trong lần này dùng **ngưỡng đã hạ** (0,05%/0,1%), nên con số của nó (mua 9 lần đúng 6, bán 7 lần đúng 2) **không** mô tả quy tắc thật và không được dùng để đánh giá chất lượng; bản trước của tệp này đã trích nhầm con số đó (verify finding 2). Số đúng, ngưỡng mặc định 8%/15%, ở §5.
- `npm run signals:report` trên Redis đó in: 1 chat, đã dùng `/tinhieu` 1 ngày (chưa "quay lại"), 2 nhận định chờ chấm, lượt chạy gần nhất `healthy`.
- Lỗi thật bắt được trong lần chạy này và đã sửa: khoảng giá in tới 6 số lẻ (`$83,185.105519`); nay hiện 2 số lẻ khi giá ≥ $1 (có test).

## 4. Deviations from the plan

1. **Cấu hình `signals.*` thêm ở bước 6, không phải bước 7**, vì `SignalsService` cần ngưỡng.
2. **`SignalResult` không có chuỗi "lý do"** như plan §2 mô tả. Hàm thuần chỉ trả số; `formatSignalReason()` dựng câu từ các số đó. Cùng thông tin, giữ `evaluateSignal()` thuần số.
3. **Giám sát tách thành lớp riêng**, không mở rộng `PriceAlertsMonitorService`/`evaluateMonitor`: `SignalsMonitorService` + `evaluateSignalsMonitor()` với khoá Redis `signals:outage` riêng, gọi từ nhịp watcher hiện có. Plan §4 (rủi ro 3) cho phép đúng lối này nếu mở rộng lõi phức tạp. Kết quả: code cảnh báo giá chỉ đổi phần nối dây (khoảng 15 dòng trong `price-alerts-watch.controller.ts`, 1 dòng trong `price-alerts.module.ts`); không đổi luật fire/re-arm/cooldown hay luật giám sát cũ. Đổi lại, tín hiệu không dùng cơ chế "hold" nhiều tầng của EPIC-002-FIX; nó dùng `SET NX` trước khi gửi "down" và `GETDEL` trước khi gửi "recovered", trả lại khoá nếu gửi thất bại.
4. **Phần "Tín hiệu" trong bản tin bị bỏ hẳn khi lỗi**, không có dòng "tạm thời không có số liệu" như phần danh mục: spec §3.2 ghi "chỉ bỏ phần 'Tín hiệu'". Hàm `formatSignalDigestUnavailableSection` đã viết rồi xoá.
5. **Kết quả lượt chạy chỉ có `healthy` / `skipped` / `failed`** (không `degraded`); lỗi gửi của từng chat được đếm ở `failures` nhưng không làm lượt chạy "không khoẻ", nếu không một chat chặn bot sẽ làm owner nhận cảnh báo mãi.
6. **Thêm ngân sách gửi 20 giây mỗi lượt** (`SIGNALS_SEND_BUDGET_MS`, plan không nêu số). Chat chưa tới lượt giữ nguyên điều kiện, nhận tin ở lượt sau (`deferred`).
7. **Ước tính ngân sách Upstash sửa lại:** plan viết ~8.700 lệnh/tháng; đếm theo code là khoảng 14 lệnh/lượt × 1.440 = ~20k, cộng ~9k cho một lệnh `MGET` mỗi nhịp watcher: ~30k/tháng cộng lệnh người dùng, vẫn dưới mục tiêu 400k nhưng không phải số đo. Đã ghi vào `docs/ARCHITECTURE.md` và `docs/DEPLOYMENT.md`.
8. **Redis client không tự parse phản hồi** (`automaticDeserialization: false`) cho các dịch vụ tín hiệu. Lý do: mã chat toàn chữ số dài hơn 2^53 sẽ bị `JSON.parse` làm tròn. Test trên Redis thật bắt được hệ quả (HGETALL trả danh sách phẳng) và đã xử lý bằng `hashToRecord()`.
9. **`ROADMAP.md`**: plan nói cập nhật "khi ship"; tôi cập nhật mục Initiative 4 thành "In implementation" kèm việc còn lại sau deploy, chưa đánh dấu Shipped. `CHANGELOG.md` ghi dưới "Unreleased".

## 5. Discovered work

Những điều tìm thấy và **chưa** làm:

- **Tần suất và chất lượng nhận định (nên đọc trước khi bật rộng).** Backtest 90 ngày dữ liệu thật CoinGecko với **ngưỡng mặc định 8%/15%** (chạy 2026-10-07, `runBacktest` trên giá cuối ngày): BTC mua 0/0, bán 0/1; ETH mua 0/0, bán 0/1; SOL mua 0/0, bán 1/3; XRP mua 1/1, bán 2/3; DOGE mua 0/0, bán 2/3 (đúng/số lần chấm được). Kết luận: với coin lớn quy tắc gần như không nổ (BTC có biến động ngày lớn nhất 8,0% trong 90 ngày), nên tin chủ động sẽ rất thưa và tỉ lệ đúng ở cỡ mẫu 0–3 lần chưa nói được gì. Với coin nhỏ hơn có vài tín hiệu nhưng cũng chưa đủ mẫu. Việc cần quyết (owner): giữ ngưỡng, hay hạ (`SIGNAL_SWING_24H_PCT`/`SIGNAL_SWING_72H_PCT`) sau khi xem backtest vài coin. `DEPLOYMENT.md` bước 8c.2 đặt việc này thành bước bắt buộc trước khi báo người dùng.
- **Hai suite e2e Redis dẫm lên nhau.** `price-alerts.redis` và `signals.redis` đều `flushdb` cùng một database; chạy song song thì 4 test lỗi ngẫu nhiên (đã xác nhận: tuần tự thì 84/84). CI không bị ảnh hưởng (cả hai tự bỏ qua khi không có URL). Đã ghi vào header test; cách sửa gọn hơn (mỗi suite một số database, hoặc tiền tố khoá) để thành việc riêng.
- **`/tinhieu bat` trùng mã coin BAT.** Spec FR13 quy định `bat`/`tat` là công tắc; muốn xem coin BAT dùng `/gia bat`. Đã ghi ở comment parser và câu cú pháp sai; không đổi spec.
- **Coin chỉ CoinPaprika biết không có lịch sử.** Không lấp được, tích luỹ từ lượt đầu, hiện "chưa đủ dữ liệu" 7 ngày (đúng plan §1).
- **Nhận định của coin đã hết hạn theo dõi tạm (4 ngày) mà không nằm watchlist nào** không còn giá để chấm, nên nằm ở "chờ chấm" mãi. Spec không nói; hiếm vì chấm cần 3 ngày và theo dõi tạm giữ 4 ngày.
- **`gh` chưa cài** nên PR không mở được từ phiên này (§1).

## 6. Known gaps

Điều reviewer nên nhìn kỹ nhất, và việc sau deploy (plan bước 10, **chưa làm**, cần owner xác nhận riêng):

1. **Script Lua mới chạy trên Redis chuẩn 7 qua SRH, chưa chạy trên Upstash thật.** Cần kiểm lại ở bước 10 (lượt gọi tay `/cron/signals` đầu tiên, rồi `npm run signals:report`). Cũng chưa đo giới hạn kích thước phản hồi REST của Upstash cho 30–50 coin (plan §4, rủi ro "ít chắc nhất"); nếu vượt thì đọc theo lô 10 coin.
2. **Ngân sách lệnh Upstash** là số đếm theo code, không phải số đo; xem dashboard sau 48 giờ.
3. **Gửi được nhưng ghi trạng thái lỗi** (Redis hỏng đúng lúc sau khi Zalo nhận tin): chat sẽ được báo lại ở lượt 30 phút sau thay vì chờ 1 giờ. Chấp nhận, hiếm, đã ghi log.
4. **`NFR01`/`NFR02`** chỉ quan sát được sau deploy qua log `signals-run` và thời gian lệnh.
5. **Chỉ số thành công** cần ≥ 1 chat ngoài owner dùng `/tinhieu` ở hai ngày khác nhau trong 30 ngày (`npm run signals:report`); chưa ai dùng.
6. **Bản tin 9h gọi giá thêm một lần** (tải tín hiệu cho hợp watchlist). Một lượt, không theo từng chat (đúng plan), nhưng thêm một cuộc gọi CoinGecko mỗi ngày.
7. **Cách đếm tín hiệu liên tiếp trong backtest** (các ngày liên tiếp cùng nhận định tính một lần) là lựa chọn của kế hoạch, spec chưa nói; bước verify nên kiểm lại và nếu owner muốn cách khác thì chỉ đổi một hàm (`runBacktest`).
8. Backtest tính cả ngày hiện tại (chưa đủ ngày) là một điểm cuối; không ảnh hưởng tín hiệu đã chấm vì cần đủ 3 ngày sau.

## 7. Rework after verify (revision 2)

Báo cáo verify rev 1 (`verify.md`): fail, 16/18 pass, AC10 fail, AC04 untested. Đã sửa trong vòng này:

| Finding | Việc đã làm | Kiểm bằng |
|---|---|---|
| 1 (AC10) | `/tinhieu <coin>` cho coin không mạnh in thêm "ở N% khoảng 7 ngày ($thấp–$cao)" | `format-signals.util.spec.ts` |
| 2 | Sửa §3.2 và §5 của tệp này bằng backtest ngưỡng mặc định (bảng ở §5) | chạy `runBacktest` trên dữ liệu thật, 5 coin |
| 6 | Giá hiện tại ≤ 0 hoặc không hữu hạn → `insufficientData`, không còn "mua −100%" | `signal-evaluator.spec.ts` (4 giá xấu) |
| 7 | `getMarketChart` phân biệt 404 (`CoingeckoCoinNotFoundError`: CoinGecko không biết coin) với 429/lỗi khác; chỉ 404 mới ra "chưa đủ lịch sử", 429 ra thông báo "tạm thời không lấy được giá" | `coingecko.service.spec.ts`, `signals.service.spec.ts` |
| 9 | Phần bản tin khi không coin nào mạnh luôn **một dòng** (coin thiếu dữ liệu nằm trong ngoặc); chat không có coin nào có giá thì không có phần "Tín hiệu" thay vì nói "không có coin nào dao động mạnh" | `format-signals.util.spec.ts`, `digest.controller.spec.ts` |
| 10 | Bản ghi nhận định dùng `HSETNX` trên hash theo chat (field `coin:nhận-định:ngày`), không phải `ZADD NX` như plan §2; hành vi tương đương, test Redis thật xác nhận | `signals.redis.e2e-spec.ts` |

**Không sửa, có chủ đích:** #3 (vòng phản hồi không phủ AC04 ≤ 30 phút, NFR01/02/04, ngân sách Upstash, Lua trên Upstash thật: chỉ kiểm được sau deploy), #4 và #5 (lấp lịch sử thêm lệnh `market_chart` và tin đầu tiên của chat nhiều coin mới chưa gộp đủ: plan §1 đã chấp nhận), #8 (chat chặn bot bị thử lại mỗi lượt: quy mô nhỏ, nên cân nhắc đánh dấu sau N lần từ chối nếu có nhiều chat), #11 (`/tinhieu tatt` gõ nhầm bị hiểu là coin).

Sau vòng sửa: `npx jest` 33 suite, 485 test pass; `tsc`, `eslint` (thư mục đã sửa) không lỗi.

## 8. Next step

Bấm **"Mark step done"** cho `implement` để chuyển sang `verify`. Trước đó, nếu muốn: mở PR bằng liên kết ở §1.
