# Implementation Plan — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Author:** Engineer
**Status:** Draft (chờ Thach duyệt)
**Created:** 2026-09-30
**Traces to:** `spec.md`

---

## 1. Approach

Toàn bộ dữ liệu của epic này nằm ở **Upstash Redis**, không ở Postgres (Neon): lịch sử giá, bản sao watchlist, trạng thái báo, nhận định đã đưa ra, trạng thái bật/tắt. Lý do là NFR05: lượt kiểm tra chạy mỗi 30 phút (48 lượt/ngày), nếu mỗi lượt đọc Postgres thì Neon không bao giờ ngủ, đúng bài học EPIC-002 (`docs/ARCHITECTURE.md` "Price alerts"). Redis còn phù hợp với dữ liệu ở đây, vì đều là chuỗi thời gian ngắn hạn, cần dọn theo tuổi, và không cần ràng buộc quan hệ. Ngân sách lệnh Upstash dự kiến rất nhỏ nhờ gộp thao tác bằng Lua (`EVAL` tính là một lệnh, như `RECORD_REJECTIONS_SCRIPT` đã dùng): mỗi lượt kiểm tra khoảng 6 lệnh, tức khoảng 8.700 lệnh/tháng, cộng lệnh người dùng. Đây là ước tính từ số lệnh mỗi lượt, không phải số đo; bước 10 đo lại trên dashboard Upstash (đang dùng ~295k–339k/500k cho cảnh báo giá).

**Phương án bị loại: lưu lịch sử giá và nhận định trong Postgres**, cạnh `subscribers`/`portfolio_*`. Postgres chắc chắn hơn cho truy vấn, nhưng mỗi lượt kiểm tra sẽ đánh thức Neon (xem trên). **Cũng bị loại: tự chấm điểm nhận định bằng cron riêng.** Thay vào đó bảng điểm (`/tinhieu thongke`) và backtest được tính **khi đọc** từ lịch sử giá đã lưu, nên không có việc ghi định kỳ nào chỉ để chấm điểm.

**Luồng chính.** Một endpoint máy gọi mới `GET /cron/signals`, do cron-job.org gọi mỗi 30 phút (job thứ hai, cùng tài khoản, secret riêng `SIGNALS_CRON_SECRET`). Mỗi lượt, dưới khoá chạy giống của `/cron/price-alerts`: (1) đọc bản sao watchlist từ Redis, (2) gọi nguồn giá **một lần** cho hợp các coin, (3) ghi điểm giá theo giờ và theo ngày bằng một `EVAL`, (4) đọc lại cửa sổ 7 ngày của các coin bằng một `EVAL`, (5) đánh giá bằng hàm thuần `evaluateSignal()`, (6) với từng chat, áp giới hạn 1 tin/giờ và không báo lặp (FR05, FR06), gộp thành một tin, gửi, rồi mới ghi trạng thái nếu Zalo nhận (giống cảnh báo giá: chỉ đánh dấu đã báo khi gửi được). Bản tin 9h và `/tinhieu` dùng **cùng** `evaluateSignal()` và cùng dữ liệu, nên không có hai định nghĩa "dao động mạnh".

**Watchlist nằm ở Postgres nhưng lượt kiểm tra cần nó trong Redis.** `SubscribersService` giữ watchlist. Để không truy vấn Postgres mỗi lượt, `SignalsSubscriptionsMirror` giữ một bản sao trong một hash Redis (`chatId → watchlist`). Bản sao được cập nhật ngay khi `/dangky`, `/watchlist`, `/huy` chạy (lỗi ghi bản sao chỉ được log, không làm hỏng lệnh), và được **đồng bộ lại toàn bộ mỗi ngày** trong lượt bản tin 9h (đã đọc sẵn `listActive()`, nên không thêm truy vấn). Cách này tự sửa nếu một lần cập nhật bị lỡ. Đánh đổi chấp nhận: một chat vừa đổi watchlist mà lần ghi bản sao lỗi thì tối đa chậm 1 ngày.

**Lấp lịch sử (concern 5 trong spec).** Coin mới xuất hiện trong bản sao được lấp lịch sử **một lần** bằng CoinGecko `market_chart` (`days=90`, nguồn tự trả theo giờ cho 2–90 ngày): giữ điểm theo giờ của 7 ngày gần nhất và điểm cuối ngày của 90 ngày. Mỗi lượt lấp tối đa 5 coin để giữ trong giới hạn tốc độ của gói miễn phí và thời gian chạy. Coin chỉ có ở CoinPaprika (bản miễn phí không có lịch sử) thì không lấp được: lịch sử tích luỹ dần theo lượt kiểm tra và hiện "chưa đủ dữ liệu" đến khi đủ 7 ngày. Nếu `market_chart` lỗi hoặc bị giới hạn tốc độ thì bỏ qua coin đó lượt này và thử lại lượt sau; cờ "đã lấp" chỉ đặt khi lấp thành công. **Đã kiểm chứng 2026-10-07** trên API thật, không cần key: `coins/bitcoin/market_chart?vs_currency=usd&days=90` trả HTTP 200, 2161 điểm cách nhau 1 giờ, phủ đủ 90 ngày, phản hồi khoảng 223 KB mỗi coin (xem §4). Giới hạn tốc độ chưa đo; bước 2 vẫn xử lý 429 như đã nêu.

**Coin ngoài watchlist mà người dùng hỏi.** Spec cho `/tinhieu <coin>` hoạt động với coin hợp lệ bất kỳ và mọi nhận định đã gửi phải chấm điểm được (FR11). Vì bảng điểm chấm bằng lịch sử đã lưu, coin được hỏi mà chưa có lịch sử thì được đưa vào một tập "theo dõi tạm" (sorted set, hết hạn sau 4 ngày, tối đa 50 coin). Coin trong tập này được lấp và ghi điểm như coin watchlist, nên nhận định 3 ngày sau vẫn chấm được. Quá 50 coin thì `/tinhieu <coin>` vẫn trả tín hiệu (tính từ `market_chart` gọi tại chỗ) nhưng không ghi nhận định vào bảng điểm và nói rõ. Đây là quyết định kỹ thuật để thoả FR11, không đổi spec.

**Backtest và bảng điểm dùng cùng một cách chấm.** Backtest chạy `evaluateSignal()` lên giá cuối ngày; bảng điểm chấm nhận định đã ghi bằng giá đầu tiên sau mốc +72 giờ. Spec (FR06, FR10) chưa nói cách đếm khi cùng một biến động kéo dài nhiều ngày liên tiếp; kế hoạch chọn: **các ngày liên tiếp có cùng nhận định mua (hoặc bán) chỉ tính một tín hiệu, ở ngày đầu**, khớp tinh thần FR06. Bước verify cần kiểm lại lựa chọn này (§4).

**Giám sát (NFR07).** Không xây cơ chế mới. Lượt kiểm tra ghi một dòng tóm tắt vào danh sách Redis có giới hạn (`signals:runs`) như `price-alerts:runs`, và bộ theo dõi hiện có (`PriceAlertsMonitorService.runWatcher`, QStash mỗi 5 phút) được mở rộng để thêm điều kiện thứ hai: nếu 90 phút không có lượt `healthy` nào của tín hiệu thì báo owner qua đúng kênh và các "hold" hiện có, với một loại thông điệp riêng. Đây là phần chạm vào code đã ship của EPIC-002-FIX nhiều nhất, nên nó có bước riêng (bước 8) và test riêng.

## 2. Files

| Path | Change | Why |
|---|---|---|
| `src/signals/signals.constants.ts` | **Mới.** Ngưỡng mặc định (`SWING_24H_PCT = 8`, `SWING_72H_PCT = 15`, `BAND_PCT = 25`), `RANGE_DAYS = 7`, `MIN_HISTORY_DAYS = 7`, `SEND_COOLDOWN_MS = 60 phút`, `REPEAT_WINDOW_MS = 24 giờ`, `REPEAT_EXTRA_PP = 5`, `HORIZON_MS = 72 giờ`, `BACKTEST_DAYS = 90`, `BACKTEST_MIN_DAYS = 14`, `MAX_BACKFILL_PER_RUN = 5`, `MAX_EXTRA_TRACKED = 50`, `EXTRA_TRACK_TTL_MS = 4 ngày`, `MAX_RECORDS_PER_CHAT = 1000`, `RECORD_TTL_DAYS = 90`, `REDIS_KEYS` | Mỗi con số của spec chỉ khai báo ở một chỗ (FR01, FR02, FR05, FR06, NFR04, NFR09) |
| `src/signals/interfaces/signal.interface.ts` | **Mới.** `PricePoint`, `Verdict` (`buy` \| `sell` \| `watch`), `SignalResult` (dao động mạnh, thay đổi 24h/72h, vị trí trong khoảng 7 ngày, nhận định, lý do, `insufficientData`), `SignalRecord`, `BacktestResult`, `Scorecard` | Kiểu dùng chung cho hàm thuần và formatter |
| `src/signals/signal-evaluator.ts` (+ `.spec.ts`) | **Mới, hàm thuần.** `evaluateSignal(points, nowPrice, now, thresholds)`: đọc giá 24h/72h trước từ điểm theo giờ (chấp nhận lệch tối đa 90 phút), khoảng 7 ngày, dao động mạnh, nhận định và lý do. Cạnh biên bằng ngưỡng tính là mạnh; đúng 25% tính là vùng thấp. Trả `insufficientData` nếu lịch sử chưa phủ 7 ngày | FR01, FR02, NFR08; AC01, AC02, AC03, AC11 |
| `src/signals/signal-repeat.ts` (+ `.spec.ts`) | **Mới, hàm thuần.** `selectCoinsToAlert(signals, chatState, now)`: áp cooldown 1 giờ theo chat, không báo lặp 24 giờ cùng chiều trừ khi thêm ≥ 5 điểm phần trăm, đổi chiều thì báo ngay; trả danh sách coin cần báo và trạng thái mới nếu gửi được | FR05, FR06, NFR06; AC05, AC06, AC07 |
| `src/signals/signal-backtest.ts` (+ `.spec.ts`) | **Mới, hàm thuần.** `runBacktest(dailyPoints, now)` và `scoreRecords(records, history, now)`: cùng quy tắc `evaluateSignal` trên giá cuối ngày, gộp các ngày liên tiếp cùng nhận định, chấm đúng/sai bằng giá sau 72 giờ, bỏ tín hiệu chưa đủ 72 giờ; từ chối khi dưới 14 ngày | FR10, FR11; AC12, AC13 |
| `src/signals/signals-history.service.ts` (+ `.spec.ts`) | **Mới.** Redis (Upstash) như `PriceAlertsService`. `snapshotAndLoad(prices, now)`: một `EVAL` ghi điểm giờ/ngày (idempotent theo giờ, cắt điểm quá 7 ngày/90 ngày) và một `EVAL` đọc lại; `backfill(symbol)` (gọi `CoingeckoService.getMarketChart`, ghi điểm, đặt cờ đã lấp); `loadHistory(symbols)` cho `/tinhieu` và backtest | FR09, NFR03–NFR05 |
| `src/signals/signals-state.service.ts` (+ `.spec.ts`) | **Mới.** Redis: bản sao watchlist (`replaceAll`, `set`, `remove`), tập theo dõi tạm, tắt/bật tin chủ động, trạng thái đã gửi theo chat (`sent`), nhận định đã ghi (`recordVerdicts` dùng `ZADD NX` với khoá `coin:verdict:ngày` nên cùng nhận định trong ngày chỉ ghi một lần; cắt theo 1.000 bản ghi và 90 ngày), sự kiện sử dụng theo ngày, khoá chạy, log lượt chạy có giới hạn | FR04, FR06, FR11–FR13, NFR06, NFR09 |
| `src/signals/signals.controller.ts` (+ `.spec.ts`) | **Mới.** `@All('signals')` dưới `/cron`, `SignalsCronSecretGuard`, `200` với lỗi nghiệp vụ. Thực hiện luồng chính ở §1; từng chat trong `try/catch` riêng; gửi tuần tự; sau khi Zalo nhận mới ghi trạng thái và nhận định; cuối lượt log JSON `signals-run` (số coin, số chat được báo, số lỗi, `durationMs`, `outcome`) và đẩy vào `signals:runs` | FR04–FR06, NFR01, NFR03, NFR05–NFR07; AC04–AC07, AC15, AC16 |
| `src/signals/signals.service.ts` (+ `.spec.ts`) | **Mới.** Dùng chung cho controller, webhook và digest: `getSignalsForSymbols(symbols)` (lịch sử + một lần gọi giá + `evaluateSignal`), `getSignalFor(symbol)` cho coin ngoài watchlist (thêm vào tập theo dõi tạm, lấp lịch sử), `backtest(symbol)`, `scorecard(chatId)` | FR03, FR08, FR10, FR11 |
| `src/signals/signals.module.ts` | **Mới.** Imports `ConfigModule`, `CoingeckoModule`, `ZaloModule`; exports `SignalsService`, `SignalsSubscriptionsMirror` | `docs/RULES.md` (hình dạng module) |
| `src/signals/signals-subscriptions-mirror.ts` (+ `.spec.ts`) | **Mới.** Lớp mỏng bọc `SignalsStateService` cho webhook/digest: `onSubscribed`, `onWatchlistChanged`, `onUnsubscribed`, `syncAll(subscribers)`; mọi lỗi được nuốt và log, không ném ra lệnh gọi | Bản sao watchlist |
| `src/coingecko/coingecko.service.ts` (+ `.spec.ts`) | Thêm `getMarketChart(symbol, days)` gọi `/coins/{id}/market_chart` qua cùng `HttpService`, base URL và API key hiện có; lỗi ném `CoingeckoUnavailableError`; không dùng CoinPaprika. Không đổi hành vi các hàm có sẵn | FR09 (lấp lịch sử) |
| `src/coingecko/interfaces/coingecko-response.interface.ts` | Thêm kiểu phản hồi `market_chart` (`prices: [ms, usd][]`) | |
| `src/common/guards/signals-cron-secret.guard.ts` (+ `.spec.ts`) | **Mới.** Mở rộng `CronSecretGuard` với `signals.cronSecretToken`, cùng cách xử lý header và từ chối 401 khi thiếu env, y như `PriceAlertsCronSecretGuard` (không đếm lượt bị từ chối) | Secret riêng cho scheduler bên thứ ba |
| `src/config/configuration.ts`, `src/config/env.validation.ts` | Thêm `signals.cronSecretToken` (`SIGNALS_CRON_SECRET`), các ngưỡng tuỳ chọn (`SIGNAL_SWING_24H_PCT`, `SIGNAL_SWING_72H_PCT`, `SIGNAL_BAND_PCT`) với mặc định của spec. Chỉ đọc qua `ConfigService` | FR01 (ngưỡng chỉnh được), `docs/RULES.md` |
| `src/command-parser/interfaces/parsed-command.interface.ts` | Thêm `SIGNAL_VIEW`, `SIGNAL_BACKTEST`, `SIGNAL_STATS`, `SIGNAL_TOGGLE`, `SIGNAL_INVALID` vào `CommandType`; trường tuỳ chọn `signal?: { enabled?: boolean }` | FR08, FR10, FR11, FR13 |
| `src/command-parser/command-parser.service.ts` (+ `.spec.ts`) | Parse `/tinhieu` (`/tínhiệu`, `/signal`) với `[coin]`, `backtest <coin>`, `thongke`, `tat`, `bat`. Ký hiệu coin đi qua cùng bộ chuẩn hoá `/gia` dùng | FR08; `docs/RULES.md` |
| `src/utils/format-message.util.ts` (+ `.spec.ts`; hoặc tệp mới `format-signals.util.ts` nếu vượt ~800 dòng, như `format-portfolio.util.ts`) | Thêm `formatSignalReply`, `formatSignalAlertMessage`, `formatSignalDigestSection`, `formatBacktestReply`, `formatScorecardReply`, `formatSignalToggleReply`, `formatSignalInsufficientReply`, `formatSignalUnavailableReply`, kèm hằng câu miễn trừ dùng chung. Thêm tham số tuỳ chọn `signalsSection?: string` vào `formatDailyDigestReply`, đặt sau phần giá. Cập nhật `formatHelpReply` | FR03, FR07, FR08, FR10, FR11, FR14; AC08, AC10, AC12, AC18 |
| `src/webhook/webhook.controller.ts`, `webhook.module.ts` | Thêm các nhánh `case SIGNAL_*`; gọi `SignalsSubscriptionsMirror` sau `SUBSCRIBE`/`UNSUBSCRIBE`/`WATCHLIST`; ghi sự kiện sử dụng; map lỗi mới trong `handleReplyError`; import `SignalsModule` | FR08, FR12, FR13 |
| `src/digest/digest.controller.ts` (+ `.spec.ts`), `digest.module.ts` | Trước vòng lặp: `syncAll(subscribers)` (lỗi chỉ log). Một lần tải tín hiệu cho hợp watchlist mọi chat (không thêm lượt gọi giá riêng cho từng chat); phần "Tín hiệu" của từng chat nằm trong `try/catch` riêng như phần danh mục; ghi nhận định đã gửi trong bản tin; log `daily-digest-run` thêm `signalSections`, `signalFailures` | FR03, NFR07; AC08, AC09 |
| `src/price-alerts/price-alerts-monitor.service.ts`, `price-alert-monitor.ts` (+ `.spec.ts`), `interfaces/price-alert.interface.ts`, `price-alerts.constants.ts`, `src/utils/format-message.util.ts` | Mở rộng bộ theo dõi: thêm điều kiện "90 phút không có lượt tín hiệu `healthy`" và loại thông điệp mới (down + recovered), có hold riêng theo cùng quy tắc EPIC-002-FIX-NFR05. Không đổi hành vi cho cảnh báo giá | NFR07 |
| `test/webhook.e2e-spec.ts` | Override `SignalsService`/`SignalsSubscriptionsMirror`; thêm case `/tinhieu`, `/tinhieu backtest`, `/tinhieu thongke`, `/tinhieu tat`/`bat`, coin không tồn tại, nguồn giá lỗi | `docs/RULES.md` (e2e khi chạm dependency mới) |
| `test/signals.redis.e2e-spec.ts` | **Mới, opt-in** (như `price-alerts.redis.e2e-spec.ts`): chạy hai script Lua thật và các key thật trên Redis scratch, tự `describe.skip` nếu không có URL. Kiểm: ghi idempotent theo giờ, cắt điểm quá cũ, đọc lại đúng cửa sổ, khoá chạy, `ZADD NX` | Lua chỉ chạy thật trên Redis thật (bài học EPIC-001/002) |
| `scripts/signals-report.js` + `package.json` (`signals:report`) | **Mới, chỉ đọc.** Với mỗi chat: ngày dùng đầu, số ngày có dùng, có dùng sau ngày đầu hay không; tỉ lệ đúng tổng của bảng điểm. Đọc các hash sự kiện theo ngày trong 45 ngày. Có bản `*-lib.js` + spec như `alerts:report` | FR12, AC17 (tiêu chí thành công) |
| `docs/API.md` | Thêm các lệnh `/tinhieu` và mô tả 3 nơi hiển thị | FR14 |
| `docs/ARCHITECTURE.md` | Mục "Signals": vì sao Redis, bản sao watchlist, cách lấp lịch sử, chấm điểm khi đọc, cập nhật bảng module và mục giám sát | |
| `docs/DEPLOYMENT.md` | Thêm env var mới, job cron-job.org thứ hai (mỗi 30 phút, header `X-Cron-Secret-Token`), cách xác nhận lượt đầu, lệnh rollback (xoá job; dữ liệu Redis tự hết hạn) | |
| `docs/ROADMAP.md`, `CHANGELOG.md` | Cập nhật khi ship | |

Không có bảng Postgres hay migration mới. `vercel.json` **không** đổi (lịch chạy nằm ở cron-job.org, vì Vercel Hobby chỉ cron hằng ngày).

## 3. Order

Nhánh `feature/epic-004-simple-signals`, tạo từ `master`. Mỗi bước là một commit Conventional Commits, và `npm test` xanh sau mỗi bước.

1. **Hàm thuần và ngưỡng** (`feat(signals): swing and verdict rules`). `signals.constants.ts`, `signal.interface.ts`, `signal-evaluator.ts` và spec. *Sau bước này:* các con số của AC01–AC03 và AC11 được chứng minh bằng unit test, chưa có I/O.
2. **Kiểm chứng `market_chart` trên API thật** (`feat(coingecko): market chart for history backfill`). Thêm `getMarketChart` và spec với HTTP giả; độ phân giải theo giờ và kích thước phản hồi đã được xác nhận ở giai đoạn plan (§1); bước này chỉ cần **đo giới hạn tốc độ** khi lấp 5 coin liên tiếp, và chọn khoảng nghỉ giữa các lệnh gọi theo kết quả. *Sau bước này:* biết khoảng nghỉ an toàn; nếu 5 coin/lượt vẫn bị 429 thì giảm số coin mỗi lượt thay vì đổi phương án.
3. **Backtest, chấm điểm, và không báo lặp** (`feat(signals): backtest, scoring and repeat rules`). `signal-backtest.ts`, `signal-repeat.ts` và spec. *Sau bước này:* AC05–AC07, AC12, AC13 được chứng minh bằng unit test trên dữ liệu dựng tay.
4. **Redis: lịch sử và trạng thái** (`feat(signals): redis history and state stores`). `signals-history.service.ts`, `signals-state.service.ts`, các script Lua, spec với client giả, và `test/signals.redis.e2e-spec.ts` chạy thật trên Redis scratch (§6). *Sau bước này:* ghi/đọc/cắt/khoá chạy đúng trên Redis thật; app chưa đổi hành vi.
5. **Parser và formatter** (`feat(signals): /tinhieu parsing and messages`). `CommandType`, parser, formatter, câu miễn trừ, `/help`, và spec. *Sau bước này:* mọi cú pháp và mọi tin nhắn được kiểm bằng unit test; bot chưa trả lời gì mới.
6. **Lệnh trong webhook** (`feat(signals): /tinhieu commands`). `SignalsService`, `SignalsSubscriptionsMirror`, nhánh `case`, ghi sự kiện sử dụng, cập nhật `docs/API.md`, và e2e. *Sau bước này:* người dùng dùng được `/tinhieu`, `backtest`, `thongke`, `tat`/`bat` (AC10–AC14, AC17, AC18).
7. **Endpoint kiểm tra định kỳ** (`feat(signals): periodic signal check and proactive alerts`). Guard, `SignalsController`, cấu hình, spec. *Sau bước này:* gọi `/cron/signals` gửi tin chủ động đúng quy tắc (AC04–AC07, AC15, AC16); chưa có scheduler nên chưa chạy tự động.
8. **Bản tin 9h và giám sát** (`feat(digest): signals section` rồi `feat(price-alerts): watch the signals check`). Phần "Tín hiệu" và đồng bộ bản sao watchlist trong `DigestController`; rồi mở rộng bộ theo dõi. *Sau bước này:* AC08, AC09 đúng; owner được báo nếu lượt tín hiệu ngừng chạy (NFR07); test cảnh báo giá cũ vẫn xanh.
9. **Báo cáo sử dụng và tài liệu** (`feat(signals): usage report` và `docs(signals): ...`). `signals:report`, `docs/*`. *Sau bước này:* owner đếm được tiêu chí thành công.
10. **Sau deploy (không thuộc code):** thêm job cron-job.org, xác nhận lượt đầu, đọc số lệnh Upstash trên dashboard, chạy thử AC04 trên chat thật. Việc deploy cần owner xác nhận riêng (theo `docs/ROADMAP.md`, EPIC-002-FIX và EPIC-003 cũng đang chờ deploy).

## 4. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **Giới hạn tốc độ của `market_chart` trên gói miễn phí khi lấp nhiều coin liên tiếp.** Độ phân giải theo giờ, không cần key và kích thước phản hồi (~223 KB/coin) đã kiểm chứng ngày 2026-10-07; chỉ giới hạn tốc độ chưa đo. | Thấp | Bước 2 đo và chọn khoảng nghỉ; lỗi 429 bỏ qua coin đó, thử lại lượt sau. Nếu vẫn không đủ: giảm số coin mỗi lượt, hoặc tích luỹ từ lúc bật (tín hiệu cần chờ 7 ngày) và báo owner vì đổi trải nghiệm ngày đầu. |
| **Ngân sách lệnh Upstash.** Cảnh báo giá đã dùng ~295k (tối đa ~339k)/500k mỗi tháng. Thêm ~9k cho lượt kiểm tra cộng lệnh người dùng, nhưng con số này là ước tính. Nếu `EVAL` bị tính theo số lệnh bên trong thì cao hơn. | Thấp–trung bình | Đo trên dashboard sau deploy (bước 10) và ghi vào `docs/DEPLOYMENT.md`. Gộp thao tác bằng Lua; chu kỳ 30 phút có thể giãn ra 60 phút bằng cách chỉnh job, không đổi code (NFR01 sẽ yếu đi, cần owner đồng ý). |
| **Chạm code đã ship của EPIC-002-FIX** (bộ theo dõi) — `blast-radius`: `PriceAlertsMonitorService`, `evaluateMonitor` và test của chúng. | Trung bình | Chỉ *thêm* điều kiện và loại thông điệp mới, không đổi đường đi cũ; chạy nguyên bộ spec `price-alerts` sau bước 8. Nếu phức tạp hơn dự kiến, tách bộ theo dõi tín hiệu thành lớp riêng dùng lại hàm thuần, thay vì sửa lõi. |
| **Chạm luồng lệnh và bản tin đã ship.** `webhook.controller.ts`, `digest.controller.ts`, `formatDailyDigestReply`, `formatHelpReply`. | Trung bình | Chỉ thêm nhánh `case` và tham số tuỳ chọn; phần "Tín hiệu" trong bản tin có `try/catch` riêng; chạy lại spec digest và e2e hiện có. |
| **Cách đếm tín hiệu liên tiếp trong backtest** (gộp các ngày liên tiếp cùng nhận định) là lựa chọn của tôi, spec chưa nói rõ. Nó ảnh hưởng con số tỉ lệ đúng mà owner sẽ đọc. | Trung bình | Ghi rõ trong kết quả backtest; bước verify kiểm lại và nếu owner muốn cách khác thì chỉ đổi một hàm. |
| **Bản sao watchlist lệch** so với Postgres (lệnh cập nhật bản sao lỗi). | Thấp | Đồng bộ lại toàn bộ hằng ngày trong lượt bản tin; tối đa lệch 1 ngày; log mỗi lần lỗi. |
| **Khó đảo ngược:** tin chủ động đã gửi cho người dùng không thu hồi được; mặc định bật cho chat đã đăng ký (spec concern 4). | Thấp | Job cron-job.org được thêm **sau** khi đã kiểm tay bằng `/cron/signals`, nên có thể tắt job bất kỳ lúc nào; dữ liệu Redis tự hết hạn, không cần dọn. Không có migration để hoàn tác. |
| **Chất lượng nhận định** (quy tắc đảo chiều đơn giản có thể sai nhiều). | Trung bình | Ngoài phạm vi kỹ thuật: spec concern 2 đã chấp nhận, backtest/bảng điểm công khai. Bước verify chạy backtest thật trên BTC/ETH để owner thấy con số trước khi bật tin chủ động rộng. |
| **Ít chắc nhất:** `EVAL` đọc lịch sử nhiều coin trả phản hồi lớn (ước tính ~80 KB cho 30 coin), và Upstash REST giới hạn kích thước một phản hồi/yêu cầu. | Thấp | Đo ở bước 4 trên Redis thật với 30–50 coin; nếu vượt thì đọc theo lô 10 coin (thêm vài lệnh mỗi lượt). |

## 5. Proofs

| Criterion | Proof | How it is run |
|---|---|---|
| `EPIC-004-AC01` | Unit test `evaluateSignal`: 3 trường hợp, gồm biên đúng 15% | `npx jest src/signals/signal-evaluator` |
| `EPIC-004-AC02` | Unit test: khoảng 80.000–120.000 với giá 84.000, 116.000, 100.000 và đúng 90.000 | `npx jest src/signals/signal-evaluator` |
| `EPIC-004-AC03` | Unit test: ETH +3%/24h, +5%/72h không có nhận định; kèm test controller không gửi tin | `npx jest src/signals/signal-evaluator src/signals/signals.controller` |
| `EPIC-004-AC04` | Test controller với Redis/Zalo giả: một tin có đủ coin, nhận định, lý do, câu miễn trừ. Cộng kiểm tay trên production sau deploy: lượt kiểm tra đầu với chat của owner | `npx jest src/signals/signals.controller`; bước 10 |
| `EPIC-004-AC05` | Test `signal-repeat` với đồng hồ giả (10:00 gửi; 10:20, 10:50 không gửi; 11:00 gửi ETH); test controller chạy hai lần trong cùng phút, cộng test Redis thật cho khoá chạy | `npx jest src/signals/signal-repeat src/signals/signals.controller`; `test/signals.redis.e2e-spec.ts` |
| `EPIC-004-AC06` | Test controller: BTC, ETH, SOL cùng mạnh → một lần gọi `sendTextMessage` | `npx jest src/signals/signals.controller` |
| `EPIC-004-AC07` | Test `signal-repeat` theo từng mốc trong tiêu chí (18% không báo, 21% báo, đổi chiều báo ngay, sau 24 giờ báo lại) | `npx jest src/signals/signal-repeat` |
| `EPIC-004-AC08` | Test `DigestController`: chat có coin mạnh, chat không có coin mạnh (một dòng), chat chưa đăng ký (không gửi) | `npx jest src/digest` |
| `EPIC-004-AC09` | Test `DigestController`: tính tín hiệu của một chat ném lỗi → phần giá vẫn gửi, chat khác không bị ảnh hưởng, có log lỗi | `npx jest src/digest` |
| `EPIC-004-AC10` | Test formatter và e2e webhook: `/tinhieu eth` có đủ thông tin; `/tinhieu xyzabc` dùng thông báo của `/gia`; nguồn giá lỗi → thông báo không có số | `npx jest src/utils`; `npm run test:e2e` |
| `EPIC-004-AC11` | Unit test `evaluateSignal` với lịch sử 5 ngày → `insufficientData`; e2e hiện "chưa đủ dữ liệu" | `npx jest src/signals/signal-evaluator`; `npm run test:e2e` |
| `EPIC-004-AC12` | Unit test `runBacktest` với chuỗi dựng tay cho đúng 6 mua (4 đúng) và 5 bán (2 đúng); test dưới 14 ngày bị từ chối. Cộng chạy thật trên BTC/ETH ở bước verify | `npx jest src/signals/signal-backtest`; bước verify |
| `EPIC-004-AC13` | Unit test `scoreRecords`: đúng, sai, chờ chấm; `ZADD NX` không ghi trùng cùng ngày (test Redis thật) | `npx jest src/signals/signal-backtest`; `test/signals.redis.e2e-spec.ts` |
| `EPIC-004-AC14` | E2E webhook: `tat` → xác nhận, controller bỏ qua chat, bản tin vẫn có phần tín hiệu; `bat` bật lại; trạng thái còn sau khi tạo lại service (Redis thật) | `npm run test:e2e`; `test/signals.redis.e2e-spec.ts` |
| `EPIC-004-AC15` | Test controller: nguồn giá lỗi → không gửi, có log lượt lỗi; một chat gửi lỗi → chat khác vẫn nhận | `npx jest src/signals/signals.controller` |
| `EPIC-004-AC16` | Test controller với 50 chat và 30 coin: `getPricesBySymbols` gọi ≤ 2 lần; dùng client giả cho Postgres và khẳng định không bị gọi | `npx jest src/signals/signals.controller` |
| `EPIC-004-AC17` | Test hàm thư viện của `signals:report` (như `report-lib.spec.ts`); test log không chứa nhận định của chat | `npx jest scripts src/signals`; chạy `npm run signals:report` trên Redis scratch |
| `EPIC-004-AC18` | Test `formatHelpReply` liệt kê lệnh; kiểm `docs/API.md` có các lệnh mới | `npx jest src/utils`; xem lại diff |
| `EPIC-004-NFR01` (độ trễ ≤ 30 phút) | Không kiểm tự động được: quan sát log `signals-run` sau deploy | Bước 10 |
| `EPIC-004-NFR02` (≤ 5 giây p95) | Đo thời gian lệnh trong log sau deploy; unit test không đo được | Bước 10 |
| `EPIC-004-NFR07` (giám sát) | Test `PriceAlertsMonitorService` và `evaluateMonitor` cho điều kiện mới, gồm hold và phục hồi; toàn bộ spec cảnh báo giá cũ vẫn xanh | `npx jest src/price-alerts` |

Các NFR còn lại (NFR03, NFR04, NFR05, NFR06, NFR08, NFR09, NFR10, NFR11) được phủ qua các bằng chứng ở trên (AC05, AC16, AC17) và bước 10; kế hoạch **không** cam kết chứng minh NFR04 (dung lượng Redis) và ngân sách lệnh bằng test, mà bằng số đo sau deploy.

## 6. Feedback loop

- **Vòng ngắn:** `npx jest src/signals` (hàm thuần, chạy trong vài giây) trong bước 1, 3, 5.
- **Redis thật:** một Redis scratch chạy bằng Docker (`redis` chuẩn, đủ cho Lua) cho `test/signals.redis.e2e-spec.ts`, như cách EPIC-001/003 dùng Postgres scratch. Hai script Lua và `ZADD NX` chỉ được coi là đúng khi chạy trên Redis thật, không phải client giả. Nếu Upstash có bản khác biệt đáng kể với Redis chuẩn ở phần này, bước 10 kiểm lại trên Upstash thật.
- **Instance chạy tay:** `npm run start:dev` với `.env` trỏ Redis scratch, gọi `curl -H "X-Cron-Secret-Token: …" localhost:3000/cron/signals` và gửi webhook giả bằng `curl` để xem tin gửi tới Zalo giả (hoặc log). Đây là cách kiểm luồng tin chủ động trước khi có scheduler.
- **Backtest trên dữ liệu thật:** sau bước 2 và 4, chạy `/tinhieu backtest` cho BTC/ETH/SOL trên lịch sử thật để xem quy tắc cho ra tỉ lệ bao nhiêu trước khi cho người dùng thấy.
- Trước mỗi commit: `npm run lint` và `npm test`; trước PR: `npm run test:e2e` và `npm run build`.

## 7. Deliberately not doing

- **Không dùng Postgres** cho epic này và không thêm migration, để giữ Neon ngủ (NFR05).
- **Không cá nhân hoá ngưỡng theo chat**, không thêm chỉ báo kỹ thuật (RSI, MACD), không mô phỏng lợi nhuận; đúng phần "Out of scope" của spec.
- **Không sửa lõi của bộ theo dõi cảnh báo giá** ngoài việc thêm điều kiện mới; không đổi luật fire/re-arm/cooldown của `/canhbao`.
- **Không dọn/di chuyển lịch sử đã có** của cảnh báo giá hay danh mục; hai tính năng này vẫn độc lập với tín hiệu (không có liên kết "bạn đang giữ coin này").
- **Không chạy cron chấm điểm riêng**; chấm khi đọc.
- **Không tự deploy**, không tự thêm job cron-job.org hay đặt env var trên Vercel; đó là việc của owner (bước 10).
- **Không dùng CoinPaprika để lấp lịch sử**: bản miễn phí không có lịch sử đủ dài; coin chỉ có ở CoinPaprika tích luỹ dần.
