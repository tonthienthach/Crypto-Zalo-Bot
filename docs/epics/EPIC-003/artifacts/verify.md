# Verification Report — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Verifier:** Verifier (independent)
**Status:** Draft
**Created:** `2026-09-26`
**Verified against:** `spec.md`, `plan.md`

---

> Kiểm trên HEAD `14bac07` của `feature/epic-003-portfolio-tracking`. Các commit của EPIC-003 là `eefa8c3..90755b9`, trong đó có rev 2 `90755b9` (chống ghi trùng theo `message_id`, FR16/AC21).
> Checklist được lập từ `spec.md` §6 và `plan.md` §5 trước khi đọc `implement.md`. `implement.md` chỉ được đọc sau cùng, để đối chiếu.
> Máy Windows, không có Docker, không có Neon branch. Verifier không gọi production.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 18/21 pass, 0 fail, 3 untested (`EPIC-003-AC17`, `EPIC-003-AC19`, `EPIC-003-AC20`).

Không AC nào fail. Verdict là fail theo luật của skill, vì còn ba AC chưa kiểm được trên máy này:
- AC17: phải đo p95 trên production.
- AC19: phải có tranh chấp khoá thật trên Postgres/Neon thật.
- AC20: owner phải đối chiếu tay với app sàn.

Ngoài ra có một defect mức Medium ở parser: `0,123` bị hiểu thành 123 (§6 #1). Nó không làm AC nào fail, nhưng nên sửa trước khi ship vì là dữ liệu tiền.

## 2. Acceptance criteria

Mọi lệnh bên dưới do verifier tự chạy trên HEAD `14bac07`, ngày 2026-09-26:
- `unit` = `npx jest --verbose`: 19/19 suite, **276/276 pass**.
- `e2e` = `npm run test:e2e -- --verbose`: **40 pass**, 24 skip (2 suite opt-in: Postgres và Redis).
- `pglite` = harness riêng của verifier, không commit, đặt ở scratchpad `ver003/pglite.e2e-spec.ts`. Nó chạy **`PortfolioService` thật trên HEAD** và **`applyMigrations` thật của `scripts/db-migrate.js`** (áp 2 lần) trên PGlite, tức Postgres 16 bản WASM. Mock `neon()` bằng một adapter đổi mọi tham số sang chuỗi như driver Neon. Lệnh chạy là `node --experimental-vm-modules node_modules/jest/bin/jest.js --config <scratch>/ver003/jest.config.js --verbose`, kết quả **26/26 pass**. Trong đó có đủ 16 kịch bản của `test/support/portfolio-store.scenarios.ts` (kể cả kịch bản redelivery của rev 2) và 10 phép thử thêm của verifier.
  **Giới hạn của `pglite`:** nó không đi qua HTTP driver Neon, và chỉ có một kết nối, nên hai transaction "đồng thời" thực chất chạy tuần tự.
- `probe` = `npx ts-node` gọi thẳng calculator, formatter và parser của HEAD, rồi in output thật.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-003-AC01` | Chat riêng trống, `/danhmuc mua btc 0.5 60000` → ghi, xác nhận số thứ tự, 0,5 BTC, giá 60.000, đang giữ 0,5, giá vốn TB 60.000 | pass | e2e `√ AC01: records a buy after checking the coin, and confirms it`. Unit: `√ AC01: parses "/danhmuc mua btc 0.5 60000" as a buy trade`, `√ AC01: a recorded buy shows its number, the coin, quantity, price, holding and average cost`, `√ AC01: one buy holds that quantity at that price`. pglite: `√ AC01/AC02: records buys and a sell with stable numbers…` (`seq` = 1, 2, 3). |
| `EPIC-003-AC02` | Mua thêm 0,5@70k → 1 BTC, giá vốn 65.000; bán 0,4@80k → 0,6 BTC, giá vốn 65.000, đã chốt +6.000 | pass | Unit `√ AC02: buys average the cost; a sell keeps the average and realizes the gain`. pglite `√ AC01/AC02` (`quantity '0.6'`, avg ≈ 65000, realized ≈ 6000 qua NUMERIC thật). probe bán từng phần (mua 3@10, 1@20, bán 1,5@30, bán 2,5@5) ra `realizedPnlUsd: 7.5`, khớp tính tay 26,25 − 18,75. |
| `EPIC-003-AC03` | 0,6 BTC / 10 ETH: tổng 67.000; chưa chốt +8.000 (+13,56%); đã chốt +6.000; 24h −492,26; mọi số tiền có ~VND | pass | Unit `√ AC03: value, unrealized and realized PnL, and the 24h change match the hand calculation`, `√ AC03: "/danhmuc" shows each coin and every total in USD with ~VND`; e2e `√ AC03: "/danhmuc" prices every held coin in one lookup`. probe in ra `💰 Tổng giá trị: $67,000.00 (~1.701.800.000₫)`, `📈 Lãi/lỗ chưa chốt: 🔺 +$8,000.00 (~+203.200.000₫) (+13.56%)`, `✅ Lãi/lỗ đã chốt: +$6,000.00 (~+152.400.000₫)`, `📅 Biến động 24h: 🔻 −$492.260062 (~−12.503.406₫) (−0.73%)`. Giá trị đúng trong 0,01 USD (NFR01). Số được in tới 6 chữ số lẻ, xem §6 #2. |
| `EPIC-003-AC04` | Giữ 0,6, bán 2 → từ chối, nêu 0,6, không ghi gì | pass | pglite `√ AC04: a sell larger than the holding is refused with the held quantity, nothing written` (`PortfolioOversellError('btc','0.6')`, số dòng vẫn 1). Probe thêm `REFUSED trades=1`. Unit `√ a refused sell reports the held quantity (FR04)`; e2e `√ AC04: an oversell is refused with the held quantity`. |
| `EPIC-003-AC05` | 5 input sai → từ chối kèm ví dụ, không ghi; `60,000.5` → 60000,5 | pass | Unit: đủ 5 case `√ AC05: rejects "/danhmuc mua btc 0.5" / "-1 60000" / "0.5 60k" / "0.123456789 60000" / "0.5 0" as PORTFOLIO_INVALID` (cùng 7 case khác) và `√ AC05: "," is a thousands separator in the price and the quantity`. e2e `√ AC05: bad syntax shows the correct syntax and records nothing`. probe: `0,5` → INVALID, `1e3` → INVALID, `.5` → INVALID. Riêng `0,123` → `quantity "0123"`, xem §6 #1. |
| `EPIC-003-AC06` | `/danhmuc mua xyzabc 10 1` → thông báo coin không tồn tại giống `/gia` | pass | e2e `√ AC06: an unknown coin gets the "/gia" unknown-coin reply and records nothing`. Code: `webhook.controller.ts` gọi `getPricesBySymbols([symbol])` trước `recordTrade`, và `UnknownCoinSymbolsError` đi vào `formatUnknownSymbolsReply` giống `/gia`. |
| `EPIC-003-AC07` | Trống → trả lời trống kèm `/danhmuc mua btc 0.5 60000` | pass | e2e `√ AC07: an empty portfolio shows an example and calls no price source`; unit `√ AC07: the empty reply shows how to record a buy`. |
| `EPIC-003-AC08` | 3 giao dịch → `lichsu` đủ 3, mới nhất trước, đủ cột; thêm #4 thì số cũ không đổi | pass | pglite `√ AC08: history is newest first, paged, and old numbers stay after a new trade` (`[3,2,1]` rồi `[4,3,2,1]`). Unit `√ AC08: history lists number, side, coin, quantity, price and Vietnam date, newest first`. e2e `√ AC08/AC09: history and delete reach the store with the chat id`. |
| `EPIC-003-AC09` | A: xoá #1 bị từ chối, xoá #2 được, B không bị ảnh hưởng, xoá 99 → không tìm thấy | pass | pglite `√ AC09: deletes only when no later sell breaks, and only in the own chat`, `√ a buy that a later sell needs can go once that sell is deleted; other coins never block`. Biên NUMERIC do verifier thử: mua 0,3, mua 0,3, bán 0,3, bán 0,00000001, rồi xoá #1 → `DELETE-BOUNDARY PortfolioDeleteWouldOversellError` và vẫn giữ `["0.29999999"]`. Kết quả đúng. |
| `EPIC-003-AC10` | A (đăng ký, giữ BTC) có phần danh mục; B (trống) nhận đúng tin cũ; C (chưa đăng ký) không nhận gì | pass | Unit `√ AC10: A gets a portfolio part, B gets exactly the old digest, C (not subscribed) nothing`, `√ a chat whose coins are all sold gets the plain digest`, `√ AC10: the digest section goes before the cron-tracking line; without it the digest is unchanged`. probe phần bản tin: `💼 Danh mục: $67,000.00 …`, `📈 Lãi/lỗ chưa chốt …`, `📅 Biến động 24h …`. |
| `EPIC-003-AC11` | Danh mục của A lỗi → A vẫn nhận watchlist, chat khác đủ, log đếm số lỗi | pass | Unit `√ AC11: a portfolio that fails to compute still sends the watchlist, and the run log counts it`, `√ AC11: when loading the portfolios fails, everyone gets their digest as before`, `√ NFR09: a send Zalo refused counts as failed in the run log, not as sent`. Code: `digest.controller.ts:106-112` luôn log `daily-digest-run` (kể cả khi lỗi), `:234-263` có try/catch riêng cho phần danh mục. |
| `EPIC-003-AC12` | Nhóm chat → từ chối, hướng dẫn nhắn riêng, không ghi gì | pass | e2e `√ AC12: refuses every /danhmuc command in a group chat, touching no store` và `√ AC12: refuses every /danhmuc command in a chat with no chat_type, touching no store`. Unit `√ AC12: the group refusal points to a private chat`. Code `webhook.controller.ts`: `(chatType ?? '').toUpperCase() !== 'PRIVATE'` → từ chối. Trường thiếu cũng bị từ chối. DTO có khai báo `chat_type` (`zalo-webhook.dto.ts`), nên ValidationPipe không lọc mất trường này. |
| `EPIC-003-AC13` | Nguồn giá lỗi → "tạm thời không lấy được giá", `200`; chỉ có BTC → ETH "không có giá lúc này", tổng chỉ gồm BTC, có ghi chú | pass | e2e `√ AC13: a price source outage when viewing gets the outage reply and no numbers`. Unit `√ AC13: a coin with no price is listed, and left out of every total`, `√ AC13: an unpriced coin shows "không có giá lúc này" and is noted as left out`, `√ a held coin with no price is noted in the portfolio part` (digest). Trường hợp *mọi* coin đều thiếu giá thì hiện `$0.00`, xem §6 #4. |
| `EPIC-003-AC14` | Giao dịch thứ 201 và coin thứ 21 bị từ chối kèm giới hạn | pass | pglite `√ AC14: the 201st trade is refused`, `√ AC14: a 21st held coin is refused, more of a held coin and coins sold out are fine`. Verifier thử thêm: lệnh bán ở mốc 200 giao dịch → `PortfolioLimitError`. e2e `√ AC14: the trade limit is explained`. |
| `EPIC-003-AC15` | `xoahet` không xoá, yêu cầu xác nhận; `xoahet xacnhan` xoá hết, `/danhmuc` trống | pass | Unit `√ AC15: "/danhmuc xoahet" asks for confirmation, "/danhmuc xoahet xacnhan" confirms`; e2e `√ AC15: "xoahet" alone asks to confirm and deletes nothing; confirmed, it clears`; pglite `√ AC15: clear deletes every trade of the chat and nothing else`. probe: `/danhmuc xoáhết xácnhận` → `confirmed: true`. |
| `EPIC-003-AC16` | Log không có số lượng/giá/lãi lỗ; bản ghi sử dụng có chat và thời điểm, đếm được chat khác owner dùng sau ngày đầu | pass | e2e `√ AC16: no amount the user sent reaches the logs` (bắt mọi mức `Logger`, rồi kiểm không có `0.5`, `60000`, `60,000`, `65000`). pglite `√ AC16: views and writes are counted per chat and day, with no amounts` (cột chỉ gồm `chat_id, day, first_seen_at, views, writes`). Unit `√ the metric counts non-owner chats that recorded a trade and came back after day one`. `npm run portfolio:report` chưa chạy trên DB thật (script chỉ là I/O mỏng quanh lib đã test). Chỉ số bị thổi lên bởi các lần ghi bị từ chối, xem §6 #6. |
| `EPIC-003-AC17` | 20 coin / 200 giao dịch: nguồn giá ≤ 2 lần, trả lời ≤ 5 giây p95 | untested | Phần số lần gọi: e2e `√ AC03: … prices every held coin in one lookup` kiểm `getPricesBySymbols` gọi đúng 1 lần, nhưng chỉ với 2 coin; không có test 20 coin như plan §5 hứa. Code (`replyWithPortfolio`) gọi 1 lần cho cả mảng, CoinPaprika chỉ chạy cho symbol còn thiếu, nên tối đa 2 request. Phần p95 ≤ 5 giây không đo được trước deploy. **Cách đóng:** deploy, rồi lấy p95 của `portfolio-view.durationMs` trong Vercel logs sau 7 ngày, hoặc sau 20 lần gọi thử với danh mục 20 coin / 200 giao dịch. |
| `EPIC-003-AC18` | `/huy` → `/danhmuc` vẫn đầy đủ, bản tin không gửi nữa | pass | e2e `√ AC18: "/huy" never touches the portfolio, which still answers afterwards`; unit digest `√ AC10: … C (not subscribed) nothing` (chỉ `listActive` mới được gửi). |
| `EPIC-003-AC19` | Hai lệnh mua đồng thời → đúng 2 giao dịch, giữ 2 BTC; DB lỗi giữa chừng → không dở dang, trả lời thân thiện | untested | Phần lỗi giữa chừng **đã kiểm được**: pglite `√ AC19: a statement failing mid-transaction leaves no trade and no usage row` (vi phạm `CHECK` 23514 → không có dòng trade lẫn dòng usage, service ném `PortfolioUnavailableError`); e2e `√ AC19: a store failure gets a friendly reply and a 200`. Phần đồng thời **chưa kiểm được**: pglite `√ AC19: two buys sent at once…` và `√ … of two sells sent at once… exactly one is recorded` đều pass, nhưng PGlite chỉ có một kết nối nên hai transaction chạy tuần tự, và `pg_advisory_xact_lock` chưa từng bị tranh chấp thật. **Cách đóng:** chạy `PORTFOLIO_INT_DATABASE_URL=<Neon branch tạm> npm run test:e2e -- portfolio.postgres` (hoặc dùng Docker + `local-neon-http-proxy` theo plan §6); 16 kịch bản phải pass qua HTTP driver thật. |
| `EPIC-003-AC20` | Owner so tổng `/danhmuc` với app sàn/ví | untested | Kiểm tay trên production, theo thiết kế (plan §3 bước 9). **Cách đóng:** sau deploy, owner ghi danh mục thật, gửi `/danhmuc` và cộng tay từ app sàn tại cùng thời điểm, rồi ghi hai con số cùng độ lệch vào file này. |
| `EPIC-003-AC21` | Redelivery cùng `message_id` → không ghi lần hai, trả lời "đã được ghi trước đó"; tin mới giống hệt trong 2 phút → 2 giao dịch và cảnh báo "Giống hệt giao dịch #n" | pass | pglite `√ a redelivered Zalo message records its trade once; another message, or another chat, records again`. Probe verifier: `DEDUPE dup=true`, 4 dòng. Các lần ghi không có id (`undefined`, `''`, không truyền) đều **không** bị gộp: `source_message_id = NULL` cho `NOT EXISTS` đúng. Unique index một phần `WHERE (source_message_id IS NOT NULL)` được tạo sau 2 lần migrate. Unit `√ stores the Zalo message_id…`, `√ a redelivered message returns the trade it recorded, marked duplicate…`, `√ without a message_id nothing is looked up as a duplicate`, `√ flags an identical trade recorded within 2 minutes…`. e2e `√ a redelivered webhook (same message_id) is passed on, and the reply says it was not recorded again`, `√ the same trade sent twice within 2 minutes is recorded twice (AC19), and the reply flags it`. |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| Unit: calculator, parser, formatter, service (mock `neon()`), digest, usage lib, db-migrate | Có (verifier chạy lại) | 276/276 pass |
| e2e `test/webhook.e2e-spec.ts` với `PortfolioService` bị override | Có | 40 pass |
| Integration opt-in `test/portfolio.postgres.e2e-spec.ts` qua **driver Neon thật** | **Không**: không có Docker, không có Neon branch; suite bị `describe.skip` | Chưa có kết quả. Driver thật chưa từng chạy, cả ở implement lẫn verify. Chặn AC19 |
| Cùng các kịch bản store đó trên Postgres engine thật (thay thế một phần) | Có: harness `pglite` của verifier, chạy trên HEAD kể cả rev 2 (lần chạy PGlite của implement là trước `90755b9`) | 16/16 kịch bản pass, cộng 10 probe pass |
| `db-migrate.js` chạy migration hai lần liên tiếp | Có: `applyMigrations` thật trên PGlite, 2 lần | Không lỗi. Có 9 cột, `quantity`/`price_usd` là `numeric(21,8)`, có unique index một phần. Bước tách theo `;` bỏ được các dòng comment (kể cả comment trong `CREATE TABLE`) |
| AC17 unit "xem 20 coin → gọi giá 1 lần" | Một phần: test chỉ có 2 coin | Xem AC17 |
| AC17 p95, AC20 đối chiếu tay (bước 9) | Không (phải chờ deploy) | untested |
| AC16 `npm run portfolio:report` với dữ liệu 2 ngày | Chỉ phần lib (`usage-report-lib.spec.ts`); script chưa chạy trên DB | lib pass |
| §6 đầu cuối cục bộ (`start:dev` + `POST /webhook`) | Không (không có DB scratch, không `.env`) | Không AC nào phụ thuộc riêng vào proof này |
| lint, build | Có | exit 0 (xem §4) |

## 4. Regressions

```
$ npm run lint
LINT EXIT 0
(--fix đổi line ending của src/app.module.ts, src/zalo/zalo.service.ts, src/zalo/zalo.service.spec.ts;
 git diff --ignore-cr-at-eol rỗng; đã git checkout -- lại, cây sạch)

$ npx jest --verbose
Test Suites: 19 passed, 19 total
Tests:       276 passed, 276 total
TEST EXIT 0

$ npm run test:e2e -- --verbose
Test Suites: 2 skipped, 1 passed, 1 of 3 total
Tests:       24 skipped, 40 passed, 64 total
E2E EXIT 0

$ npm run build
BUILD EXIT 0

$ node --experimental-vm-modules node_modules/jest/bin/jest.js --config <scratch>/ver003/jest.config.js --verbose
Tests:       26 passed, 26 total        (harness PGlite của verifier, không commit)
```

Các test của EPIC-001, EPIC-002 và EPIC-002-FIX đều vẫn xanh (price-alerts, monitor, evaluator, report-lib, guard, subscribers, coingecko, coinpaprika, zalo, digest cũ). Chỉ có một thay đổi hành vi ngoài phần danh mục: `1cd82ce` sửa `daily-digest-run` để lần gửi mà Zalo trả `false` được đếm là `failed`. Đây là sửa lỗi, có test `√ NFR09: a send Zalo refused counts as failed…`.

`implement.md` ghi unit 268 / e2e 38. Con số đó là trước rev 2, và rev 2 đã thêm 8 unit + 2 e2e, nên khớp với lần chạy này. Không có claim nào trong `implement.md` mâu thuẫn với output của verifier. `implement.md` cũng tự nhận là driver Neon thật chưa chạy.

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Diff không có đồng bộ sàn/ví, phí/thuế, nhập VND, ngày quá khứ, FIFO/LIFO, sửa giao dịch, tỷ giá thời gian thực, danh mục nhóm, CSV, biểu đồ, cảnh báo theo danh mục hay tư vấn đầu tư. Không có env var mới (`configuration.ts`, `env.validation.ts` không đổi, đúng plan §2). Không có truy vấn định kỳ mới (NFR04): bản tin chỉ thêm 1 truy vấn `listTradesForChats` mỗi lượt.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **`0,123` bị hiểu thành 123.** Regex hàng nghìn `\d{1,3}(,\d{3})+` chấp nhận nhóm đầu là `0`, nên người dùng Việt gõ `/danhmuc mua btc 0,123 60000` (dấu phẩy thập phân) sẽ ghi **123 BTC**, gấp 1000 lần, mà không có cảnh báo nào. probe: `"/danhmuc mua btc 0,123 60000" => quantity "0123"`. Lời xác nhận có in "Mua 123 BTC", nên người dùng vẫn có thể thấy và xoá. `0,5` thì bị từ chối đúng. Nên từ chối mọi số có nhóm hàng nghìn bắt đầu bằng `0` (`^[1-9]\d{0,2}(,\d{3})+`). Lỗi này đúng với FR02 hiểu theo chữ, nhưng nhóm `0,` không bao giờ là cách phân cách hàng nghìn hợp lệ. `/canhbao` (EPIC-002) cũng bị y như vậy | Medium | `src/command-parser/command-parser.service.ts:35` |
| 2 | **Số tiền in tới 6 chữ số lẻ.** `formatMoney`/`formatSignedMoney` dùng `USD_FORMATTER` (`maximumFractionDigits: 6`) của `/gia` cho cả tổng và lãi/lỗ. probe: `Biến động 24h: 🔻 −$492.260062`, `Tổng giá trị: $1,999.998`. Giá trị vẫn đúng tới 0,01 (AC03 pass), nhưng tin trả lời khó đọc và khác cách spec viết (−492,26). Test `toContain('−$492.26')` không bắt được vì chuỗi dài hơn vẫn chứa chuỗi đó. Nên dùng 2 chữ số lẻ cho số tiền, giữ 6–8 chữ số cho giá coin | Low | `src/utils/format-message.util.ts:16-20, 296-313` |
| 3 | **Nhiễu dấu phẩy động hiện thành lỗ âm.** Mua 3 lần cùng giá 3.333,33 rồi xem với cùng giá đó thì in `Lãi/lỗ: 🔻 −$0.00 (~−0₫) (−0.00%)`. Nên làm tròn về 0 trước khi chọn dấu | Low | `src/utils/format-message.util.ts:296` |
| 4 | **Mọi coin đang giữ đều thiếu giá thì hiện `Tổng giá trị: $0.00 (~0₫)`.** Tình huống: `getPricesBySymbols` ném `UnknownCoinSymbolsError` (bị nuốt) hoặc trả về rỗng. Có ghi chú loại trừ đi kèm, nhưng tinh thần AC13 là "không hiện số 0". Nên trả lời "tạm thời không lấy được giá" giống trường hợp nguồn giá lỗi | Low | `src/webhook/webhook.controller.ts` (`replyWithPortfolio`), `format-message.util.ts` (`formatPortfolioReply`) |
| 5 | **`changePercent24h = −100` làm chia cho 0.** probe: `📅 Biến động 24h: 🔻 −$∞ (~−∞₫)`. Hiếm gặp (coin sập hẳn, hoặc dữ liệu CoinPaprika lỗi), nhưng tin hiện số sai. Nên coi `pct <= −100` là thiếu số liệu 24h | Low | `src/portfolio/portfolio-calculator.ts:140-143` |
| 6 | **Lần ghi bị từ chối vẫn cộng vào `writes`.** `countUsage(chatId,'writes')` chạy vô điều kiện trong transaction. pglite: bán quá số giữ bị từ chối, nhưng usage vẫn thành `writes: 2` dù chỉ có 1 trade; redelivery cũng cộng thêm (`writes: 5` cho 4 trade). `successMetric` coi `writes > 0` là "đã ghi danh mục". Hệ quả: một chat chỉ thử `/danhmuc ban btc 1 1` vào ngày 1 rồi xem vào ngày 2 sẽ được tính là đạt tiêu chí thành công của intent §5, dù chưa từng ghi được giao dịch nào. `implement.md` chỉ nói tới redelivery, không nói tới lần từ chối. Nên chỉ cộng khi `INSERT` thực sự ghi (ví dụ đếm trong cùng CTE của INSERT) | Low | `src/portfolio/portfolio.service.ts:174`, `scripts/portfolio-usage-report.lib.js:52` |
| 7 | **Giao dịch có số thứ tự > 999 không xoá được.** `seq = MAX(seq)+1`, nên khi xoá giao dịch cũ rồi ghi giao dịch mới, `seq` cứ tăng (pglite: `SEQ-AFTER-999 1000`), trong khi parser chỉ nhận 1–999 cho `xoa`. Muốn chạm mốc này phải ghi trên 999 lần trong một chat, nên khả năng thấp | Low | `src/command-parser/command-parser.service.ts:30` |
| 8 | **`message_id` dài hơn 128 ký tự làm mọi lệnh ghi của tin đó thất bại.** DTO không có `MaxLength`, còn cột có `CHECK ≤ 128`. pglite: `LONG-MSGID PortfolioUnavailableError`, bot trả lời "tạm thời không truy cập được", không ghi gì. Id thật của Zalo chỉ khoảng 20 ký tự, nên đây là rủi ro lý thuyết. Nên cắt bớt id hoặc bỏ dedupe khi id quá dài | Low | `src/webhook/dto/zalo-webhook.dto.ts` (`message_id`), `db/migrations/0002_create_portfolio.sql` |
| 9 | **Message của `InconsistentTradesError` có thể chứa số lượng, và bị log.** `toQuantityUnits` ném lỗi với message `Not a decimal quantity: ${quantity}`, và webhook/digest log nguyên `error.message`. Comment ở webhook nói message "never an amount", điều này sai với hai message đó. Chỉ xảy ra khi dữ liệu bị sửa ngoài bot (NUMERIC(21,8) luôn khớp regex), nhưng vẫn là một đường rò NFR06 | Low | `src/portfolio/portfolio-calculator.ts:23,28`; `src/webhook/webhook.controller.ts:427`; `src/digest/digest.controller.ts:215` |
| 10 | **Redelivery tới sau khi giao dịch gốc đã bị xoá thì được ghi lại.** Dedupe dựa vào việc dòng gốc còn tồn tại. pglite: `REDELIVER-AFTER-DELETE duplicate=false`. Khoảng thời gian redelivery của Zalo ngắn, nên khó xảy ra | Low | `src/portfolio/portfolio.service.ts:150-153` |
| 11 | **Migration 0002 được sửa tại chỗ ở rev 2.** Cách này chỉ an toàn nếu 0002 chưa từng chạy ở đâu. Nếu có DB nào (production, hoặc một Neon branch tạo cho opt-in test) đã chạy bản trước `90755b9`, thì `CREATE TABLE IF NOT EXISTS` sẽ bỏ qua và không thêm cột `source_message_id`. Khi đó mọi lệnh ghi đều lỗi 42703 và bot trả lời "tạm thời không truy cập được". Nên thêm `ALTER TABLE portfolio_trades ADD COLUMN IF NOT EXISTS source_message_id …` cho chắc | Low | `db/migrations/0002_create_portfolio.sql` |
| 12 | **Driver Neon HTTP thật chưa từng chạy.** Chưa chạy `sql.transaction`, `pg_advisory_xact_lock`, `NUMERIC` → chuỗi, hay `ANY($1)` với mảng. PGlite chứng minh SQL đúng về ngữ nghĩa, nhưng chưa chứng minh được đường truyền và tranh chấp khoá. Đây đúng là loại lỗi đã gặp ở EPIC-001 (bài học trong plan §6). Đây là lỗ hổng của feedback loop, và là lý do AC19 untested | Medium (process) | `test/portfolio.postgres.e2e-spec.ts` (skip) |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. **AC19:** tạo một Neon branch tạm (hoặc chạy Docker + `local-neon-http-proxy`), rồi chạy `PORTFOLIO_INT_DATABASE_URL=… npm run test:e2e -- portfolio.postgres`. 16 kịch bản phải pass qua driver thật, kể cả hai kịch bản đồng thời. Xoá branch sau khi chạy. Bước này đồng thời đóng finding #12.
2. **Deploy** theo `DEPLOYMENT.md` §3a (`npm run db:migrate` trước, sau đó `vercel deploy --prod`) và smoke test `/danhmuc` trong chat riêng thật.
3. **AC17:** sau deploy, lấy p95 của `portfolio-view.durationMs` (danh mục 20 coin / 200 giao dịch, ≥ 20 lần gọi) và xác nhận ≤ 5 giây.
4. **AC20:** owner đối chiếu `/danhmuc` với tổng tự cộng từ app sàn/ví, rồi ghi kết quả vào file này.

Không bắt buộc để lật verdict, nhưng nên làm trước khi ship: sửa finding #1 (từ chối `0,xxx`, sửa một dòng regex, kèm test), vì một lần gõ nhầm có thể làm sai số dư 1000 lần. Các finding #2–#11 là Low, có thể gom lại làm một lần dọn dẹp sau.
