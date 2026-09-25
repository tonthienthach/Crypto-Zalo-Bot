# Implementation Plan — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Author:** Engineer
**Status:** Approved (Thach, 2026-09-25)
**Created:** 2026-09-25
**Traces to:** `spec.md`

---

## 1. Approach

Giao dịch được lưu ở **Postgres (Neon)**, cạnh bảng `subscribers`, qua đúng Neon HTTP driver (`neon()`) mà `SubscribersService` đang dùng. Lý do chọn: đây là dữ liệu tài chính lâu dài, cần ghi trọn vẹn và tuần tự theo chat (NFR07). Với Postgres, việc này làm được bằng một transaction ngắn. Tải lên Neon nằm trong trần miễn phí, vì spec (NFR04) chỉ cho đọc/ghi khi người dùng gửi lệnh và một lần mỗi ngày cho bản tin. Bản tin 9h vốn đã đánh thức Neon để đọc `subscribers`, nên phần danh mục chỉ thêm **1 truy vấn mỗi ngày**. Mỗi lệnh `/danhmuc` là **1 round-trip HTTP** (`sql.transaction([...])`). Ước tính: cứ mỗi lần Neon bị đánh thức riêng lẻ thì tốn khoảng 5 phút × 0,25 CU ≈ 0,02 CU-giờ. Giả sử có 30 lần dùng rải rác mỗi ngày thì ≈ 18 CU-giờ/tháng, so với trần 100 CU-giờ (`docs/ARCHITECTURE.md` "Persistence"). Số thật sẽ đo ở bước 9.

**Phương án bị loại: Upstash Redis** (store của EPIC-002). Redis không có transaction kiểu "kiểm tra số dư rồi mới ghi" nếu không viết Lua, không có kiểu số thập phân chính xác, và không ràng buộc được dữ liệu (`CHECK`). Muốn đảm bảo FR04/FR10/NFR07 thì phải tự dựng khoá và tự kiểm tra lại, trong khi Postgres có sẵn. Lý do EPIC-002 bỏ Postgres là truy vấn **mỗi phút** làm Neon luôn thức, và lý do đó không áp dụng ở đây. **Cũng bị loại:** tính lại danh mục trong SQL. Logic giá vốn trung bình (FR05) được viết thành **hàm thuần** `computePortfolio()` bằng TypeScript: test được không cần DB, và cùng một hàm dùng cho `/danhmuc`, cho bản tin, và cho lời xác nhận sau khi ghi.

**Toàn vẹn và đồng thời (NFR07, AC19):** mọi lệnh ghi và xoá chạy trong `sql.transaction([...])`. Câu lệnh đầu tiên là `SELECT pg_advisory_xact_lock(hashtext(chat_id))`, nên hai lệnh của cùng một chat chạy tuần tự, còn các chat khác nhau không chặn nhau. Các điều kiện (không bán quá số đang giữ, giới hạn 200 giao dịch / 20 coin, xoá không làm số dư âm) nằm trong `WHERE` của **cùng một** câu `INSERT … SELECT` hoặc `DELETE`, chạy sau khi đã có khoá. Nếu điều kiện sai thì câu lệnh không ghi dòng nào; nếu DB lỗi giữa chừng thì cả transaction rollback. Số lượng lưu dạng `NUMERIC(20,8)`, và được so sánh chính xác trong SQL. Trong `computePortfolio()`, số lượng được đổi sang `bigint` đơn vị 10⁻⁸, nên "bán hết về 0" là phép so sánh chính xác, không lệ thuộc sai số dấu phẩy động. Tiền USD dùng `number`: với ≤ 200 giao dịch, sai số dưới 10⁻⁶ USD, trong ngưỡng NFR01 (0,01 USD).

**Nhận biết chat nhóm (spec §8 Concern 4):** lệnh `/danhmuc` chỉ được xử lý khi `message.chat.chat_type` bằng `PRIVATE` (không phân biệt hoa thường). Mọi giá trị khác, kể cả khi trường này **không có**, đều bị từ chối kèm hướng dẫn nhắn riêng. Payload thật đã xác nhận có `"chat_type": "PRIVATE"` với chat riêng (`src/zalo/interfaces/zalo-webhook.interface.ts`, 2026-09-04, và `docs/API.md`). Khi từ chối, bot ghi log giá trị `chat_type` nhận được (không có số liệu tài chính), để nếu owner bị chặn nhầm thì nhìn log là thấy ngay. Bước 9 có kiểm tra trên production: owner gửi `/danhmuc` từ chat riêng thật. Bản tin không cần biết `chat_type`: giao dịch chỉ ghi được từ chat riêng, nên chat nhóm không bao giờ có danh mục, và bản tin gửi cho nhóm tự động không có phần danh mục (FR12).

**Bản tin 9h (spec §8 Concern 8, NFR03):** trước vòng lặp, `DigestController` tải giao dịch của mọi subscriber đang active bằng **1 truy vấn** (`listTradesForChats`). Mỗi subscriber vẫn chỉ gọi `getPricesBySymbols` **một lần** như hiện nay, nhưng với **hợp** của watchlist và các coin đang giữ. Kết quả được tách ra: phần watchlist hiển thị y như cũ, phần danh mục dùng giá của các coin đang giữ. Việc tính và định dạng phần danh mục nằm trong `try/catch` riêng: lỗi ở đó chỉ bỏ phần danh mục (hoặc ghi "tạm thời không có số liệu"), phần watchlist vẫn được gửi (NFR08). Cuối lượt có một dòng log JSON `daily-digest-run` (NFR09).

## 2. Files

| Path | Change | Why |
|---|---|---|
| `db/migrations/0002_create_portfolio.sql` | **Mới.** Bảng `portfolio_trades` (`id BIGSERIAL PK`, `chat_id TEXT` ≤ 64, `seq INTEGER`, `side TEXT CHECK IN ('buy','sell')`, `symbol TEXT` ≤ 20, `quantity NUMERIC(20,8) CHECK > 0`, `price_usd NUMERIC(21,8) CHECK > 0`, `created_at TIMESTAMPTZ`, `UNIQUE (chat_id, seq)`). Bảng `portfolio_usage` (`chat_id`, `day DATE`, `views INT`, `writes INT`, `first_seen_at`, `PRIMARY KEY (chat_id, day)`). Chỉ dùng `CREATE … IF NOT EXISTS`, không có dấu `;` trong literal, không có khối `DO $$` | FR01, FR09, FR13, NFR05, NFR07. `scripts/db-migrate.js` tách file theo `;` và chạy lại mọi file mỗi lần, nên migration phải idempotent (bài học EPIC-001) |
| `src/portfolio/interfaces/portfolio.interface.ts` | **Mới.** `PortfolioTrade`, `Holding`, `PortfolioSnapshot` (holdings, tổng giá trị, lãi/lỗ chưa chốt/đã chốt, biến động 24h, danh sách coin bị loại vì thiếu giá) | |
| `src/portfolio/portfolio.constants.ts` | **Mới.** `MAX_TRADES_PER_CHAT = 200`, `MAX_HELD_COINS = 20`, `MAX_QUANTITY = 1e12`, `MAX_QUANTITY_DECIMALS = 8`, `HISTORY_PAGE_SIZE = 20`, `QUANTITY_SCALE = 10n ** 8n` | Mỗi con số trong spec chỉ khai báo ở một chỗ |
| `src/portfolio/portfolio-calculator.ts` (+ `.spec.ts`) | **Mới, hàm thuần.** `computeHoldings(trades)` (giá vốn trung bình gia quyền, reset khi về 0, lãi/lỗ đã chốt) và `computePortfolio(holdings, prices)` (giá trị, lãi/lỗ chưa chốt, biến động 24h theo `price / (1 + pct/100)`, loại coin thiếu giá hoặc thiếu %) | FR05, FR06, FR07, NFR01; AC02, AC03, AC13 |
| `src/portfolio/portfolio.service.ts` (+ `.spec.ts`) | **Mới.** Neon HTTP driver, dùng chung `db.connectionString`. Gồm: `recordTrade` (khoá advisory → `INSERT … SELECT … WHERE` số dư/giới hạn; `seq = MAX(seq)+1` của chat; ghi usage), `listTrades(chatId)` (ghi usage `views`), `listTradesPage`, `deleteTrade` (khoá → `DELETE … WHERE NOT EXISTS` số dư chạy âm, tính bằng window `SUM() OVER (PARTITION BY symbol ORDER BY seq)`), `clearTrades`, `listTradesForChats(chatIds)`. Các lỗi: `PortfolioOversellError`, `PortfolioLimitError`, `PortfolioTradeNotFoundError`, `PortfolioDeleteWouldOversellError`. Lỗi DB được bọc thành `PortfolioUnavailableError` với message đã làm sạch | FR01, FR04, FR09, FR10, FR13, FR14, NFR05–NFR07 |
| `src/portfolio/portfolio.module.ts` | **Mới.** Imports `ConfigModule`; exports `PortfolioService` | Hình dạng module theo `docs/RULES.md` |
| `src/command-parser/interfaces/parsed-command.interface.ts` | Thêm `PORTFOLIO_VIEW`, `PORTFOLIO_TRADE`, `PORTFOLIO_HISTORY`, `PORTFOLIO_DELETE`, `PORTFOLIO_CLEAR`, `PORTFOLIO_INVALID` vào `CommandType`; trường tuỳ chọn `portfolio?: PortfolioCommandArgs` (`side`, `quantity` dạng chuỗi chuẩn hoá, `priceUsd`, `page`, `index`, `confirmed`) | FR01, FR09, FR10, FR14 |
| `src/command-parser/command-parser.service.ts` (+ `.spec.ts`) | Parse `/danhmuc` (`/danhmục`, `/portfolio`) với `mua`/`buy`, `ban`/`bán`/`sell`, `lichsu`/`history [trang]`, `xoa`/`delete <n>`, `xoahet [xacnhan]`. Tách `parseThreshold` thành `parsePositiveNumber(raw, maxDecimals, max)` để dùng chung cho giá `/canhbao`, giá và số lượng `/danhmuc`. Hành vi `/canhbao` không đổi | FR01, FR02, NFR05; AC05 |
| `src/utils/format-message.util.ts` (+ `.spec.ts`) | Thêm `formatPortfolioReply`, `formatPortfolioEmptyReply`, `formatPortfolioTradeRecordedReply`, `formatPortfolioHistoryReply`, `formatPortfolioDeletedReply`, `formatPortfolioNotFoundReply`, `formatPortfolioOversellReply`, `formatPortfolioDeleteRefusedReply`, `formatPortfolioLimitReply`, `formatPortfolioInvalidReply`, `formatPortfolioGroupRefusedReply`, `formatPortfolioClearConfirmReply`, `formatPortfolioClearedReply`, `formatPortfolioUnavailableReply`, `formatPortfolioDigestSection`. `formatDailyDigestReply` nhận thêm tham số tuỳ chọn `portfolioSection?: string`, đặt trước dòng cron tracking. Cập nhật `formatHelpReply` | FR06, FR08, FR09, FR11, FR15; formatter thuần theo `docs/RULES.md` |
| `src/webhook/webhook.controller.ts` | Truyền `chat.chat_type` vào `replyToMessage`. Thêm các nhánh `case PORTFOLIO_*`: từ chối nếu không phải `PRIVATE`; khi ghi giao dịch thì validate coin bằng `getPricesBySymbols([symbol])` (FR03) trước khi ghi; khi xem thì tải giao dịch rồi gọi **một** `getPricesBySymbols` cho các coin đang giữ. Map các lỗi portfolio trong `handleReplyError`. Mỗi lần xem ghi log JSON `{ event: 'portfolio-view', chatId, coins, durationMs }`, không có số tiền | FR01–FR12, NFR02, NFR06; AC17 đo từ log |
| `src/webhook/webhook.module.ts` | Import `PortfolioModule` | |
| `src/digest/digest.controller.ts` (+ `.spec.ts`) | Tải giao dịch của các subscriber bằng 1 truy vấn (lỗi thì bỏ phần danh mục cho cả lượt, watchlist vẫn gửi). Mỗi subscriber gọi `getPricesBySymbols(watchlist ∪ held)` một lần, tách kết quả, tính phần danh mục trong `try/catch` riêng. Cuối lượt log `daily-digest-run` với `subscribers`, `portfolioSections`, `portfolioFailures`, `durationMs` | FR11, NFR03, NFR08, NFR09; AC10, AC11 |
| `src/digest/digest.module.ts` | Import `PortfolioModule` | |
| `test/webhook.e2e-spec.ts` | Override `PortfolioService`; thêm các case `/danhmuc` (ghi, xem, lịch sử, xoá, nhóm bị từ chối, nguồn giá lỗi, `xoahet`), và case `/huy` không chạm `PortfolioService` | `docs/RULES.md`: e2e khi thêm dependency mới |
| `test/portfolio.postgres.e2e-spec.ts` | **Mới, opt-in.** Chạy `PortfolioService` thật với `@neondatabase/serverless` thật trên Postgres scratch (xem §6). Tự `describe.skip` nếu không có `PORTFOLIO_INT_DATABASE_URL`. Bao gồm cả chạy `scripts/db-migrate.js` hai lần liên tiếp | Bài học EPIC-001: bug migration chỉ lộ ra với driver thật |
| `scripts/portfolio-usage-report.js` + `package.json` (`portfolio:report`) | **Mới, chỉ đọc.** Liệt kê mỗi chat: ngày dùng đầu tiên, số ngày có dùng, và có dùng sau ngày đầu hay không. Đọc `POSTGRES_URL` từ shell hoặc `.env` | FR13, AC16; tiêu chí thành công intent §5 |
| `docs/API.md` | Thêm các lệnh `/danhmuc` vào bảng lệnh; ghi chú lệnh chỉ dùng trong chat riêng | FR15 |
| `docs/ARCHITECTURE.md` | Mục "Portfolio": vì sao dùng Postgres (so với Redis), khoá advisory, hàm tính thuần, cách bản tin gộp giá; cập nhật bảng module | |
| `docs/DEPLOYMENT.md` | Bước migration `0002` **trước khi** deploy code; lệnh rollback (`DROP TABLE portfolio_usage, portfolio_trades`) nếu cần gỡ hẳn; lệnh `portfolio:report` | Thứ tự deploy theo `docs/RULES.md` |
| `docs/ROADMAP.md`, `CHANGELOG.md` | Cập nhật khi ship | |

Không có env var mới. `configuration.ts` và `env.validation.ts` **không** đổi.

## 3. Order

Nhánh `feature/epic-003-portfolio-tracking`, tạo từ `master`. Mỗi bước là một commit Conventional Commits.

1. **Migration và vòng kiểm tra DB** (`feat(portfolio): add portfolio tables migration`). Thêm `0002_create_portfolio.sql`, dựng Postgres scratch (§6), chạy `npm run db:migrate` hai lần. *Sau bước này:* bảng tồn tại, migration idempotent được chứng minh với driver thật; app chưa đổi hành vi.
2. **Hàm tính thuần** (`feat(portfolio): weighted-average cost calculator`). Thêm interfaces, constants, `portfolio-calculator.ts` và spec. *Sau bước này:* các con số của AC02/AC03/AC13 được chứng minh bằng unit test, chưa có I/O.
3. **Parser** (`feat(command-parser): parse /danhmuc`). Thêm `CommandType`, `parsePositiveNumber`, parse `/danhmuc` và spec. Spec `/canhbao` cũ vẫn xanh. *Sau bước này:* mọi cú pháp của AC05 được parse đúng; bot chưa trả lời gì mới.
4. **Store** (`feat(portfolio): postgres-backed trade store`). `PortfolioService`, unit spec với `neon()` được mock, và integration spec opt-in. *Sau bước này:* ghi/xoá/giới hạn/khoá/đồng thời chạy đúng trên driver thật (AC04, AC09, AC14, AC15, AC19).
5. **Formatter và webhook** (`feat(portfolio): /danhmuc commands`). Thêm formatter, các nhánh `case`, chặn chat nhóm, map lỗi, cập nhật `/help`, và e2e. *Sau bước này:* người dùng ghi, xem, xem lịch sử và xoá danh mục trong chat riêng.
6. **Bản tin** (`feat(digest): portfolio section in daily digest`). Sửa `DigestController` và spec, gồm các case của AC10/AC11. *Sau bước này:* bản tin 9h có phần danh mục; lỗi danh mục không làm mất phần watchlist.
7. **Báo cáo sử dụng** (`feat(portfolio): usage report script`). Thêm `portfolio-usage-report.js` và script npm. *Sau bước này:* owner đếm được tiêu chí thành công.
8. **Docs và cổng CI** (`docs(portfolio): …`). Cập nhật `API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`. Chạy đủ `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` và integration opt-in. Mở PR vào `master`.
9. **Deploy (owner làm, có mình hướng dẫn).** Chạy `npm run db:migrate` với `POSTGRES_URL` production **trước**, sau đó `npx vercel deploy --prod` (project không nối git, `epic-memory` EPIC-002). Smoke test: owner gửi `/danhmuc` từ chat riêng thật (kiểm chứng `chat_type`), ghi 1 mua và 1 bán thử, xoá hết. Sau 7 ngày: đọc log `portfolio-view` để có p95 (AC17), xem Neon → Usage (CU-giờ), và owner đối chiếu với app sàn (AC20).

## 4. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **NFR02 (≤ 5 giây p95) khi cả Vercel lẫn Neon cùng cold start**: Nest cold start + Neon thức dậy (thường vài trăm ms) + CoinGecko (có thể chậm, rồi thêm CoinPaprika dự phòng) | Trung bình, **ít chắc chắn nhất** | Mỗi lệnh chỉ 1 round-trip Neon + 1 `getPricesBySymbols`, thực hiện tuần tự vì phải biết coin đang giữ trước. Log `portfolio-view.durationMs` cho số liệu thật ở bước 9. Nếu p95 > 5 giây thì quay lại originator; lựa chọn khi đó là chạy song song truy vấn DB với giá của các coin đoán trước, chứ không nới AC. |
| **`chat_type` không có hoặc khác `PRIVATE` với chat riêng thật**, làm owner bị chặn | Thấp | Payload thật (2026-09-04) có `PRIVATE`. Log giá trị `chat_type` khi từ chối; smoke test ở bước 9. Sửa là đổi một điều kiện trong controller, không đụng dữ liệu. |
| **Chat nhóm gửi `chat_type` khác `GROUP`** (ví dụ `GROUP_CHAT`) | Thấp | Luật là "chỉ `PRIVATE` mới được phép", nên mọi giá trị lạ đều bị từ chối. Đây là hướng an toàn cho quyền riêng tư (NFR06). |
| **Neon HTTP driver xử lý khác psql** (bài học EPIC-001: migration nhiều câu lệnh) với `sql.transaction`, advisory lock, `NUMERIC` trả về dạng chuỗi | Trung bình | Integration spec chạy driver thật (§6). `NUMERIC` luôn được parse từ chuỗi sang `bigint`/`number` tại một chỗ duy nhất trong service. |
| **Bản tin bị sửa**: blast radius là `digest.controller.ts` (`sendToSubscriber`) và mock trong `digest.controller.spec.ts`; `formatDailyDigestReply` thêm tham số tuỳ chọn | Trung bình | Các test bản tin hiện có phải vẫn xanh mà không sửa kỳ vọng. Chat không có giao dịch nhận **y hệt** tin cũ (AC10 chat B, có test so chuỗi). Nếu tải giao dịch lỗi thì cả lượt chạy như trước epic. |
| **Gộp coin đang giữ vào lần gọi giá của watchlist làm hỏng watchlist**: trước đây `getPricesBySymbols` chỉ throw khi *mọi* symbol không tìm thấy; giờ thêm symbol thì ngưỡng đó khó chạm hơn, nên một watchlist toàn coin sai vẫn có thể "thành công" nhờ coin đang giữ | Thấp | Nếu phần watchlist sau khi tách không có coin nào thì hành xử như `UnknownCoinSymbolsError` trước đây (log, không gửi phần watchlist rỗng). Có test riêng. |
| **Symbol dùng chung id CoinGecko** (`matic`/`pol`, xem `8699422`): kết quả giá chỉ mang một trong hai symbol | Chắc chắn gặp nếu người dùng giữ cả hai | Tra giá theo symbol trước, rồi theo `resolveSymbolToId`, giống `PriceAlertsController.loadPrices`. Hai symbol được coi là hai coin riêng trong danh mục; ghi chú trong `ARCHITECTURE.md`. |
| **Số thứ tự bị dùng lại**: `seq = MAX(seq)+1` nên nếu xoá giao dịch mới nhất thì số đó được cấp lại | Thấp | Vẫn đúng FR09 (số của giao dịch *còn lại* không đổi khi thêm mới). Chấp nhận; ghi rõ trong code. Không thêm bảng đếm riêng. |
| **Log lộ số liệu tài chính** (NFR06): lỗi Postgres không mong muốn bị log nguyên stack ở `handleReplyError` | Thấp | `PortfolioService` bọc mọi lỗi DB thành `PortfolioUnavailableError` với message cố định; câu lệnh luôn dùng tham số, không ghép chuỗi. `LoggingInterceptor` chỉ log method/path/thời gian, `ZaloService` chỉ log chat id (đã đọc code). AC16 có test quét log. |
| **Khó đảo ngược** | Thấp | Migration chỉ *thêm* bảng. Rollback code bằng `vercel rollback` là an toàn vì bản cũ không đọc bảng mới. Gỡ hẳn thì `DROP TABLE` (ghi trong `DEPLOYMENT.md`), nhưng sẽ mất giao dịch người dùng đã ghi, nên chỉ làm khi owner quyết. |
| **Vượt trần Neon** (100 CU-giờ/tháng) nếu nhiều chat dùng rải rác | Thấp | ≈ 0,02 CU-giờ mỗi lần đánh thức riêng lẻ (§1). Theo dõi ở bước 9. Không có truy vấn định kỳ nào mới (NFR04). |

## 5. Proofs

| Criterion | Proof | How it is run |
|---|---|---|
| `EPIC-003-AC01` | e2e: `/danhmuc mua btc 0.5 60000` trong chat `PRIVATE` → `recordTrade` được gọi với `buy`, `btc`, `0.5`, `60000`; câu trả lời có số thứ tự, 0,5 BTC, giá vốn 60.000. Integration: dòng được ghi, `seq = 1` | `npm run test:e2e`, integration |
| `EPIC-003-AC02` | Unit calculator: mua 0,5@60k, mua 0,5@70k → 1 BTC, giá vốn 65.000; bán 0,4@80k → 0,6 BTC, giá vốn 65.000, đã chốt +6.000 | `npm test` |
| `EPIC-003-AC03` | Unit calculator với đúng số liệu của AC: tổng 67.000; chưa chốt +8.000 (+13,56%); đã chốt +6.000; 24h −492,26 (sai số ≤ 0,01). Unit formatter: mọi số tiền có `~…₫` | `npm test` |
| `EPIC-003-AC04` | Integration: giữ 0,6 BTC, bán 2 → `PortfolioOversellError` kèm số đang giữ, số dòng không đổi. e2e: nội dung trả lời | integration, `npm run test:e2e` |
| `EPIC-003-AC05` | Unit parser: 5 input sai → `PORTFOLIO_INVALID`; `60,000.5` → 60000.5. e2e: một input sai → trả lời có ví dụ cú pháp, `recordTrade` không được gọi | `npm test`, `npm run test:e2e` |
| `EPIC-003-AC06` | e2e: `getPricesBySymbols` throw `UnknownCoinSymbolsError` → cùng câu trả lời với `/gia`, `recordTrade` không được gọi | `npm run test:e2e` |
| `EPIC-003-AC07` | e2e: `listTrades` trả `[]` → trả lời trống kèm `/danhmuc mua btc 0.5 60000`, không gọi nguồn giá | `npm run test:e2e` |
| `EPIC-003-AC08` | Integration: 3 giao dịch → trang 1 có 3 dòng, mới nhất trước; ghi thêm giao dịch thứ 4 → `seq` 1–3 không đổi. Unit formatter: đủ cột, ngày theo giờ Việt Nam | integration, `npm test` |
| `EPIC-003-AC09` | Integration: chat A (#1 mua 1, #2 bán 0,5) và chat B. Xoá #1 → `PortfolioDeleteWouldOversellError`; xoá #2 → thành công, A giữ 1 BTC, số dòng của B không đổi; xoá 99 → `PortfolioTradeNotFoundError` | integration |
| `EPIC-003-AC10` | Unit digest: 3 subscriber như AC (A có BTC, B trống; C không có trong `listActive`) → A nhận tin có phần danh mục; tin của B **bằng đúng chuỗi** `formatDailyDigestReply` cũ; C không được gửi. Mỗi subscriber gọi `getPricesBySymbols` đúng 1 lần | `npm test` |
| `EPIC-003-AC11` | Unit digest: tính danh mục của A throw → A vẫn nhận phần watchlist, B nhận đủ, log `daily-digest-run` có `portfolioFailures: 1`. Thêm case: `listTradesForChats` throw → mọi subscriber nhận tin như cũ | `npm test` |
| `EPIC-003-AC12` | e2e: `chat_type: 'GROUP'` và trường hợp không có `chat_type` → trả lời từ chối, `PortfolioService` không được gọi. Unit formatter: nội dung hướng dẫn nhắn riêng | `npm run test:e2e` |
| `EPIC-003-AC13` | e2e: nguồn giá throw `CoingeckoUnavailableError` khi xem → "tạm thời không lấy được giá", HTTP 200. Unit calculator + formatter: chỉ BTC có giá → dòng ETH "không có giá lúc này", tổng chỉ gồm BTC, có ghi chú loại trừ | `npm run test:e2e`, `npm test` |
| `EPIC-003-AC14` | Integration: 200 giao dịch → giao dịch thứ 201 bị `PortfolioLimitError`; đang giữ 20 coin → mua coin thứ 21 bị từ chối, còn mua thêm một coin đang giữ thì vẫn được | integration |
| `EPIC-003-AC15` | Unit parser: `xoahet` → `confirmed: false`, `xoahet xacnhan` → `confirmed: true`. e2e: không xác nhận thì `clearTrades` không được gọi. Integration: sau khi xoá hết, `listTrades` trả `[]` | `npm test`, `npm run test:e2e`, integration |
| `EPIC-003-AC16` | e2e: bắt mọi output của `Logger` trong lúc chạy các lệnh ghi/xem/xoá, rồi kiểm tra không có chuỗi nào chứa số lượng hay giá đã gửi (`0.5`, `60000`, `60,000`). Integration: `portfolio_usage` có dòng cho chat; `npm run portfolio:report` in được "đã dùng sau ngày đầu" với dữ liệu 2 ngày giả lập | `npm run test:e2e`, integration |
| `EPIC-003-AC17` | Unit controller: xem danh mục 20 coin → `getPricesBySymbols` được gọi đúng 1 lần (tối đa 1 request CoinGecko + 1 CoinPaprika, theo `coingecko.service.ts:67`). Thời gian: p95 của `portfolio-view.durationMs` trong log production sau 7 ngày (hoặc 20 lần gọi thử nếu ít dữ liệu) | `npm test`; owner ở bước 9 |
| `EPIC-003-AC18` | e2e: `/huy` không gọi hàm nào của `PortfolioService`; `/danhmuc` sau đó vẫn gọi `listTrades` bình thường. Unit digest: chat không có trong `listActive` thì không nhận tin | `npm run test:e2e`, `npm test` |
| `EPIC-003-AC19` | Integration: gửi đồng thời 2 lần `recordTrade(buy btc 1 60000)` bằng `Promise.all` → đúng 2 dòng, `seq` 1 và 2, giữ 2 BTC. Thêm case đồng thời 2 lần bán 0,6 khi đang giữ 1 → một lần thành công, một lần `PortfolioOversellError`. Lỗi giữa chừng: câu thứ hai trong `transaction` vi phạm `CHECK` → không có dòng nào, service throw `PortfolioUnavailableError`; e2e: trả lời lỗi thân thiện | integration, `npm run test:e2e` |
| `EPIC-003-AC20` | Thủ công: owner so `/danhmuc` với tổng tự cộng từ các app sàn/ví tại cùng thời điểm, rồi ghi kết quả vào `verify.md` | Owner, bước 9 |

## 6. Feedback loop

- **Logic thuần** (calculator, parser, formatter): `npm test -- --watch`.
- **Controller và service**: unit test với `neon()`, `CoingeckoService` và `ZaloService` được mock, theo pattern của `digest.controller.spec.ts` và `subscribers.service.spec.ts`.
- **Driver thật (bài học EPIC-001)**: Postgres scratch bằng Docker, cộng với proxy giả lập HTTP API của Neon, để `@neondatabase/serverless` thật chạy `sql.transaction`, `pg_advisory_xact_lock` và `NUMERIC`:

  ```
  docker run -d --name pf-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine
  docker run -d --name pf-neon-proxy -p 4444:4444 \
    -e PG_CONNECTION_STRING=postgres://postgres:postgres@host.docker.internal:5432/postgres \
    ghcr.io/timowilhelm/local-neon-http-proxy:main
  PORTFOLIO_INT_DATABASE_URL=postgres://postgres:postgres@db.localtest.me:4444/postgres \
    npm run test:e2e -- portfolio.postgres
  ```

  Integration spec đặt `neonConfig.fetchEndpoint` trỏ vào proxy. Nếu proxy không chạy được trên máy này, dùng phương án dự phòng: một **Neon branch** miễn phí tách từ production (owner tạo trên dashboard Neon, xoá sau khi test). Không test bằng `psql` thay cho driver.
- **Đầu cuối cục bộ**: `npm run start:dev` với `.env` trỏ vào DB scratch, rồi gửi `POST /webhook` bằng client UTF-8 (`node` fetch; Git Bash curl làm hỏng `/danhmục` có dấu, xem `epic-memory` EPIC-002), kèm `chat_type` `PRIVATE`/`GROUP`. Gọi `/cron/daily-digest` có secret để xem tin bản tin.
- **Trước khi coi là xong**: chạy đủ `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` và integration opt-in.

## 7. Deliberately not doing

- **Không thêm env var hay cấu hình mới.** Dùng lại `POSTGRES_URL` và `USD_TO_VND_RATE`.
- **Không lưu `chat_type` vào `subscribers`** và không đổi bảng `subscribers`: chỉ chat riêng mới có danh mục, nên bản tin không cần biết loại chat.
- **Không lưu lịch sử giá trị danh mục** hay snapshot hằng ngày: biến động 24h dùng % 24h của nguồn giá (spec FR07, Concern 5).
- **Không cache danh mục đã tính**: dữ liệu nhỏ (≤ 200 dòng), tính lại mỗi lần thì đơn giản và luôn đúng.
- **Không refactor `PriceAlertsController.loadPrices`** thành helper dùng chung, dù cách tra giá theo symbol/id giống nhau. Việc đó chạm vào code EPIC-002 đang được EPIC-002-FIX sửa song song; để lại cho một lần dọn dẹp sau khi cả hai merge.
- **Không dùng WebSocket `Pool` hay transaction tương tác của Neon**: `sql.transaction([...])` cộng với khoá advisory và `WHERE` có điều kiện là đủ, và không phải quản lý kết nối trên serverless.
- **Không đổi cache hay TTL của `CoingeckoService`.**

## Coordination with EPIC-002-FIX

EPIC-002-FIX đang lên plan song song. Theo `spec.md` của epic đó, nó thêm cấu hình chat của owner và sửa `/cron/price-alerts`, `scripts/price-alerts-report.js`, `docs/DEPLOYMENT.md` §8a. Các chỗ hai nhánh có thể đụng nhau:

| File | EPIC-003 | EPIC-002-FIX (dự kiến) | Cách xử lý |
|---|---|---|---|
| `src/config/env.validation.ts`, `src/config/configuration.ts` | Không đổi | Thêm env chat owner | Không xung đột |
| `src/zalo/` | Không đổi | Có thể dùng `sendTextMessage` để báo owner | Không xung đột, trừ khi FIX đổi chữ ký hàm; nếu đổi thì rebase |
| `src/utils/format-message.util.ts` (+ spec) | Thêm formatter danh mục, sửa `formatHelpReply` và `formatDailyDigestReply` | Có thể thêm formatter tin báo owner | Cả hai chỉ thêm hàm mới: có thể xung đột dòng khi thêm vào cuối file. Đặt formatter danh mục thành một khối riêng sau nhóm `formatAlert*` |
| `test/webhook.e2e-spec.ts` | Thêm override `PortfolioService` và các case | Có thể thêm env giả và case `/cron/price-alerts` | Xung đột dòng ở phần khai báo đầu file; nhánh merge sau rebase lại |
| `src/app.module.ts` | Không đổi (`PortfolioModule` được import qua `WebhookModule`/`DigestModule`) | Có thể thêm module bên quan sát | Không xung đột |
| `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `CHANGELOG.md`, `docs/ROADMAP.md` | Thêm mục Portfolio | Sửa §8a, thêm mục bên quan sát | Xung đột văn bản ở phần đầu hoặc cuối; nhánh merge sau rebase lại |

Nguyên tắc: nhánh nào merge vào `master` trước thì nhánh kia rebase và chạy lại toàn bộ CI trước khi merge.
