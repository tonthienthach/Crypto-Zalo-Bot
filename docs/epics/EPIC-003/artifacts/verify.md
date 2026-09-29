# Verification Report — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 2)
**Created:** `2026-09-26`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 2** (2026-09-29): kiểm lại trên HEAD `8f8fa27` của `feature/epic-003-portfolio-tracking`. Nhánh đã được rebase lên EPIC-002-FIX bản đã sửa, nên mọi sha của EPIC-003 đều đổi. Các commit EPIC-003 giờ là `6d0e596..8f8fa27`. Rev 2 kiểm năm commit sửa theo rev 1:
> - `eb54c49` fix(command-parser): từ chối dấu phẩy thập phân; nhận số thứ tự giao dịch lớn hơn 999.
> - `23e1d65` fix(portfolio): số tiền làm tròn tới cent, không còn số 0 có dấu, không còn biến động 24h vô hạn.
> - `d72a1a9` fix(portfolio): chỉ đếm giao dịch thực sự được ghi; chịu được `message_id` dài.
> - `9e67c85` docs.
> - `8f8fa27` test: migration spec chịu được checkout CRLF.
>
> **Rev 1** (HEAD `14bac07`, 2026-09-26) ra kết quả fail: 18/21 pass, 0 fail, 3 untested (AC17, AC19, AC20), với 12 finding. Finding Medium duy nhất về code là parser đọc `0,123` thành 123. Bảng finding ở §6 giữ số thứ tự của rev 1 và ghi trạng thái hiện tại của từng finding.
> Checklist vẫn lập từ `spec.md` §6 và `plan.md` §5. `implement.md` chỉ được đọc sau cùng, để đối chiếu. Máy Windows, không có Docker, không có Neon branch. Verifier không gọi production.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 18/21 pass, 0 fail, 3 untested (`EPIC-003-AC17`, `EPIC-003-AC19`, `EPIC-003-AC20`).

> Trước đó (rev 1): fail, 18/21 pass, 0 fail, 3 untested (cùng ba AC).

Bản sửa đã đóng hoặc giảm nhẹ 10 trong 11 finding về code của rev 1, và verifier không thấy hồi quy nào. Verdict vẫn fail chỉ vì ba AC không kiểm được trước deploy trên máy này:
- AC19: cần tranh chấp khoá thật qua driver Neon.
- AC17: cần đo p95 trên production.
- AC20: owner phải đối chiếu tay với app sàn.

Không còn defect code nào ở mức Medium. Rủi ro còn lại đáng kể nhất nằm ở tầng spec, không ở code: `1,500` vẫn là 1500 theo FR02 (xem §6 #1).

## 2. Acceptance criteria

Mọi lệnh bên dưới do verifier tự chạy trên HEAD `8f8fa27`, ngày 2026-09-29:
- `unit` = `npx jest --verbose`: 20/20 suite, **309/309 pass**.
- `e2e` = `npm run test:e2e -- --verbose`: **40 pass**, 27 skip (2 suite opt-in: Postgres và Redis).
- `pglite` = harness của verifier, không commit, ở scratchpad `ver003/`. Nó chạy **`PortfolioService` và `applyMigrations` thật của HEAD** (migrate 2 lần) trên PGlite, tức Postgres 16 bản WASM. Adapter đổi mọi tham số sang chuỗi như driver Neon. Có hai file:
  - `pglite.e2e-spec.ts`: **28/28 pass**, gồm 18 kịch bản của `test/support/portfolio-store.scenarios.ts` và 10 probe của verifier.
  - `legacy.e2e-spec.ts`: **2/2 pass**, kiểm nâng cấp một DB đã chạy 0002 bản cũ.

  **Giới hạn của `pglite`:** không đi qua HTTP driver Neon, và chỉ có một kết nối.
- `probe` = `npx ts-node` gọi thẳng calculator, formatter và parser của HEAD, rồi in output thật.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-003-AC01` | Chat riêng trống, `/danhmuc mua btc 0.5 60000` → ghi, xác nhận số thứ tự, 0,5 BTC, giá 60.000, đang giữ 0,5, giá vốn TB 60.000 | pass | e2e `√ AC01: records a buy after checking the coin, and confirms it`; unit `√ AC01: parses…`, `√ AC01: a recorded buy shows its number…`; pglite `√ AC01/AC02: records buys and a sell with stable numbers…`. |
| `EPIC-003-AC02` | Mua thêm 0,5@70k → 1 BTC, giá vốn 65.000; bán 0,4@80k → 0,6, giá vốn 65.000, đã chốt +6.000 | pass | Unit `√ AC02: buys average the cost; a sell keeps the average and realizes the gain`; pglite `√ AC01/AC02`. probe bán từng phần ra `realizedPnlUsd: 7.5`, và lời xác nhận in `Lãi/lỗ đã chốt của SOL: +$7.50`. |
| `EPIC-003-AC03` | Tổng 67.000; chưa chốt +8.000 (+13,56%); đã chốt +6.000; 24h −492,26; mọi số tiền có ~VND | pass | Unit `√ AC03: value, unrealized…`, `√ AC03: "/danhmuc" shows each coin and every total in USD with ~VND`; e2e `√ AC03: "/danhmuc" prices every held coin in one lookup`. probe rev 2 in ra `💰 Tổng giá trị: $67,000.00 (~1.701.800.000₫)`, `📈 … +$8,000.00 (~+203.200.000₫) (+13.56%)`, `✅ … +$6,000.00 (~+152.400.000₫)`, `📅 Biến động 24h: 🔻 −$492.26 (~−12.503.404₫) (−0.73%)`, khớp đúng số của spec (rev 1 in `−$492.260062`). |
| `EPIC-003-AC04` | Giữ 0,6, bán 2 → từ chối, nêu 0,6, không ghi gì | pass | pglite `√ AC04: a sell larger than the holding is refused with the held quantity, nothing written`; probe `REFUSED trades=1 usage=[{"views":0,"writes":1}]`, tức lần bị từ chối không còn bị đếm. e2e `√ AC04: an oversell is refused with the held quantity`. |
| `EPIC-003-AC05` | 5 input sai → từ chối kèm ví dụ; `60,000.5` → 60000,5 | pass | Unit: đủ 5 case AC05 và các case mới `0,123`, `0,5`, `0.5 0,123`; `√ AC05: "," is a thousands separator in the price and the quantity`. e2e `√ AC05: bad syntax shows the correct syntax and records nothing`. probe: `1 60,000.5` → `priceUsd: 60000.5`; `100,000`, `1,234.5`, `1,000,000` vẫn đúng; `0,123`, `0,5`, `1,5`, `0,35` → INVALID. |
| `EPIC-003-AC06` | `xyzabc` → thông báo coin không tồn tại giống `/gia` | pass | e2e `√ AC06: an unknown coin gets the "/gia" unknown-coin reply and records nothing`. |
| `EPIC-003-AC07` | Trống → trả lời trống kèm ví dụ | pass | e2e `√ AC07: an empty portfolio shows an example and calls no price source`; unit `√ AC07: the empty reply shows how to record a buy`. |
| `EPIC-003-AC08` | `lichsu` đủ 3, mới nhất trước, đủ cột; số cũ không đổi khi thêm #4 | pass | pglite `√ AC08: history is newest first, paged, and old numbers stay after a new trade`; unit `√ AC08: history lists…`; e2e `√ AC08/AC09: history and delete reach the store with the chat id`. |
| `EPIC-003-AC09` | Xoá #1 bị từ chối, xoá #2 được, B không bị ảnh hưởng, xoá 99 → không tìm thấy | pass | pglite `√ AC09: deletes only when no later sell breaks, and only in the own chat`, `√ a buy that a later sell needs can go…`. Biên NUMERIC: `DELETE-BOUNDARY PortfolioDeleteWouldOversellError`, `HELD ["0.29999999"]`. probe: `/danhmuc xoa 1234` → `index: 1234` (rev 1 là INVALID). |
| `EPIC-003-AC10` | A có phần danh mục; B nhận đúng tin cũ; C không nhận gì | pass | Unit `√ AC10: A gets a portfolio part, B gets exactly the old digest, C (not subscribed) nothing`, `√ AC10: the digest section goes before the cron-tracking line; without it the digest is unchanged`. probe phần bản tin: `💼 Danh mục: $67,000.00 …`, `📅 Biến động 24h: 🔻 −$492.26 …`. |
| `EPIC-003-AC11` | Danh mục A lỗi → A vẫn có watchlist, chat khác đủ, log đếm lỗi | pass | Unit `√ AC11: a portfolio that fails to compute still sends the watchlist, and the run log counts it`, `√ AC11: when loading the portfolios fails, everyone gets their digest as before`, `√ NFR09: a send Zalo refused counts as failed…`. |
| `EPIC-003-AC12` | Nhóm (hoặc thiếu `chat_type`) → từ chối, không ghi gì | pass | e2e `√ AC12: refuses every /danhmuc command in a group chat, touching no store`, `√ AC12: … in a chat with no chat_type, touching no store`. |
| `EPIC-003-AC13` | Nguồn giá lỗi → "tạm thời không lấy được giá", `200`; chỉ có BTC → ETH "không có giá lúc này", tổng chỉ gồm BTC | pass | e2e `√ AC13: a price source outage when viewing gets the outage reply and no numbers`; unit `√ AC13: …`. Rev 2 thêm `√ when no held coin has a price, the total says so instead of $0.00`. probe: `💰 Tổng giá trị: chưa lấy được giá lúc này` (rev 1 là `$0.00`). |
| `EPIC-003-AC14` | #201 và coin thứ 21 bị từ chối | pass | pglite `√ AC14: the 201st trade is refused`, `√ AC14: a 21st held coin is refused…`, và probe `√ sell refused at 200 trades reports the trade limit`. |
| `EPIC-003-AC15` | `xoahet` hỏi xác nhận; `xoahet xacnhan` xoá hết | pass | Unit `√ AC15: …`; e2e `√ AC15: "xoahet" alone asks to confirm and deletes nothing; confirmed, it clears`; pglite `√ AC15: clear deletes every trade of the chat and nothing else`. |
| `EPIC-003-AC16` | Log không có số tiền; bản ghi sử dụng đếm được chat khác owner dùng sau ngày đầu | pass | e2e `√ AC16: no amount the user sent reaches the logs`; pglite `√ AC16: views and writes are counted per chat and day, with no amounts`. Theo probe rev 2, `writes` giờ chỉ đếm giao dịch đã ghi: lần bị từ chối không được cộng (`writes: 1` cho 1 trade), redelivery cũng không (`writes: 4` cho 4 trade; rev 1 là 2 và 5). Unit `√ never quotes the quantity in the error, since the message is logged (NFR06)`. |
| `EPIC-003-AC17` | 20 coin / 200 giao dịch: nguồn giá ≤ 2 lần, ≤ 5 giây p95 | untested | Không đổi so với rev 1. e2e kiểm `getPricesBySymbols` gọi đúng 1 lần, nhưng chỉ với 2 coin. p95 phải đo trên production. **Cách đóng:** sau deploy, lấy p95 của `portfolio-view.durationMs` (danh mục 20 coin / 200 giao dịch, ≥ 20 lần gọi). |
| `EPIC-003-AC18` | `/huy` → `/danhmuc` vẫn đủ, bản tin không gửi nữa | pass | e2e `√ AC18: "/huy" never touches the portfolio, which still answers afterwards`; unit digest `√ AC10: … C (not subscribed) nothing`. |
| `EPIC-003-AC19` | Hai lệnh mua đồng thời → đúng 2 giao dịch; DB lỗi giữa chừng → không dở dang, trả lời thân thiện | untested | Phần lỗi giữa chừng pass: pglite `√ AC19: a statement failing mid-transaction leaves no trade and no usage row`; e2e `√ AC19: a store failure gets a friendly reply and a 200`. CTE ghi usage mới nằm trong cùng câu với INSERT nên rollback cùng nhau. Phần đồng thời vẫn chưa chứng minh được: PGlite chỉ có một kết nối, và driver Neon thật chưa chạy (`implement.md` ghi "opt-in skip 26", tức vẫn skip). **Cách đóng:** chạy `PORTFOLIO_INT_DATABASE_URL=<Neon branch tạm> npm run test:e2e -- portfolio.postgres`; 18 kịch bản phải pass qua driver thật. |
| `EPIC-003-AC20` | Owner so `/danhmuc` với app sàn/ví | untested | Kiểm tay trên production theo thiết kế. **Cách đóng:** sau deploy, owner đối chiếu và ghi hai con số cùng độ lệch vào file này. |
| `EPIC-003-AC21` | Redelivery cùng `message_id` → không ghi lần hai; tin mới giống hệt trong 2 phút → 2 giao dịch kèm cảnh báo | pass | pglite `√ a redelivered Zalo message records its trade once; another message, or another chat, records again`; probe `DEDUPE dup=true`, 4 dòng, id NULL không bị gộp. `message_id` 129 ký tự giờ ghi được (`LONG-MSGID ok`), chỉ không có chống lặp. Unit `√ a message_id longer than the column allows is not used for de-duplication, and the trade still records`. e2e `√ a redelivered webhook (same message_id)…`, `√ the same trade sent twice within 2 minutes is recorded twice (AC19), and the reply flags it`. |

> *`pass` bắt buộc có output lệnh đã chụp lại. `untested` nghĩa là chưa có gì kiểm tra nó.
> Nó chặn verdict giống như một lỗi, chỉ là một loại chưa biết khác.*

## 3. Promised proofs

> *Mọi proof ghi trong `plan.md` đã thực sự được chạy chưa?*

| Proof | Executed | Result |
|---|---|---|
| Unit (calculator, parser, formatter, service mock `neon()`, digest, usage lib, db-migrate) | Có (rev 2) | 309/309 pass |
| e2e `test/webhook.e2e-spec.ts` | Có (rev 2) | 40 pass |
| Integration opt-in `test/portfolio.postgres.e2e-spec.ts` qua **driver Neon thật** | **Không** (không có Docker, không có Neon branch; suite bị skip) | Chưa có kết quả. Vẫn chặn AC19 |
| Kịch bản store trên Postgres engine thật (thay thế một phần) | Có: harness `pglite` trên HEAD `8f8fa27` | 18/18 kịch bản + 10 probe pass |
| `db-migrate.js` hai lần liên tiếp | Có: DB mới, và DB đã chạy 0002 bản cũ (`6d0e596`) có sẵn 1 dòng | DB mới: 9 cột, đúng 1 CHECK cho `source_message_id`, có unique index một phần. DB cũ: sau 2 lần migrate thì có cột, có CHECK (chỉ 1, `ADD COLUMN IF NOT EXISTS` lần 2 không thêm CHECK trùng), có index; insert id 129 ký tự bị CHECK chặn |
| AC17 "20 coin → gọi giá 1 lần" | Một phần (test chỉ có 2 coin) | Xem AC17 |
| AC17 p95, AC20 (bước 9) | Không (phải chờ deploy) | untested |
| AC16 `npm run portfolio:report` trên DB | Chỉ phần lib | lib pass |
| lint, build | Có | exit 0 |

## 4. Regressions

```
$ npm run lint
LINT EXIT 0
(--fix đổi line ending nhiều file; git diff --ignore-cr-at-eol rỗng; đã git checkout -- ., cây sạch)

$ npx jest --verbose
Test Suites: 20 passed, 20 total
Tests:       309 passed, 309 total
TEST EXIT 0

$ npm run test:e2e -- --verbose
Test Suites: 2 skipped, 1 passed, 1 of 3 total
Tests:       27 skipped, 40 passed, 67 total
E2E EXIT 0

$ npm run build
BUILD EXIT 0

$ node --experimental-vm-modules node_modules/jest/bin/jest.js --config <scratch>/ver003/jest.config.js --verbose
Tests:       28 passed, 28 total      (pglite.e2e-spec.ts)
Tests:       2 passed, 2 total        (legacy.e2e-spec.ts)
```

Verifier tìm hồi quy do các bản sửa gây ra, và không thấy:
- **Parser.** Sau `eb54c49`, `/canhbao` vẫn nhận `100,000` và `0.35`. Nó từ chối `0,35` và `01,000`, đúng hướng của EPIC-002-FR02. Mọi test parser cũ của EPIC-002 vẫn xanh.
- **Formatter.** Sau `23e1d65`, chỉ số tiền của danh mục bị làm tròn tới cent. Giá coin vẫn giữ tới 6 chữ số lẻ (`SHIB × $0.000013`). `/gia` và bản tin watchlist không đổi, vì vẫn dùng `USD_FORMATTER` cũ. Test `√ AC10: … without it the digest is unchanged` vẫn xanh. VND giờ tính từ số USD đã làm tròn, nên lệch tối đa 0,005 USD × tỷ giá (≈ 127₫). Mức này không đáng kể.
- **Service.** Sau `d72a1a9`, INSERT giao dịch và INSERT usage nằm trong một CTE ghi dữ liệu ở top level, vẫn là 1 round-trip. Transaction giờ có 4 câu thay vì 5, và thứ tự destructure đã khớp. Toàn bộ 18 kịch bản pglite pass. Độ dài id được so bằng `.length` (UTF-16) trong JS, còn CHECK trong DB dùng `char_length` (code point). Hướng so này an toàn: id qua được bước kiểm JS thì không bao giờ vi phạm CHECK.

`implement.md` ghi "unit **288**", còn verifier đếm được 309. Phần chênh là do rebase lên EPIC-002-FIX bản đã sửa, nên đây không phải claim sai về EPIC-003. Nhưng `implement.md` tham chiếu các sha trước rebase (`102be65`, `cc24a41`, `9409ef6`), và các sha này không còn trên nhánh (§6 #13).

## 5. Out-of-scope check

> *Có gì trong mục `Out of scope` của spec vẫn bị ship không?*

Không. Các bản sửa của rev 2 chỉ đụng parser, formatter, service và migration của phần danh mục. Không có tính năng mới, không có env var mới, không có truy vấn định kỳ mới.

## 6. Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **Rev 1 #1 (`0,123` → 123): đã đóng trong phạm vi spec.** `eb54c49` từ chối nhóm hàng nghìn bắt đầu bằng `0`. probe: `0,123`, `0,5`, `0,35`, `1,5` → INVALID; `100,000`, `60,000.5`, `1,234.5` vẫn đúng. **Quyết định của engineer có đúng spec không: có.** EPIC-003-FR02 buộc "`,` là phân cách hàng nghìn, theo đúng quy tắc của `/canhbao`", và AC05 buộc `60,000.5` = 60000,5. Nhóm `0,xxx` không phải cách phân cách hàng nghìn hợp lệ, nên từ chối nó không trái spec. Còn từ chối *mọi* dấu phẩy thì sẽ làm AC05 fail. **Rủi ro còn lại, nằm ở tầng spec (Known gap trong `implement.md`):** khi dấu phẩy đứng sau một chữ số khác 0 và theo sau đúng 3 chữ số, như `1,500` hay `2,250`, số vẫn bị hiểu là hàng nghìn. Người dùng quen dấu phẩy thập phân mà gõ `/danhmuc mua btc 1,500 60000` với ý 1,5 BTC sẽ ghi **1500 BTC**, lệch 1000 lần, không có cảnh báo. Bán thì an toàn hơn, vì lệnh bán quá số đang giữ bị từ chối; rủi ro nằm ở lệnh mua. Có hai lớp giảm nhẹ: lời xác nhận in `Mua 1500 BTC` và số đang giữ, và người dùng có thể `/danhmuc xoa`. Verifier đánh giá mức **Medium (rủi ro sản phẩm)**: sai số dữ liệu tiền, dễ xảy ra với người Việt, nhưng thấy được ngay và sửa được. Verifier không coi đây là defect của build. Việc quyết định thuộc PO/originator. Hướng có thể chọn: cấm dấu phẩy trong *số lượng* (giá vẫn giữ), hoặc cảnh báo trong lời xác nhận khi số lượng có dấu phẩy. Verifier không sửa spec | Medium (spec gap, không chặn) | `src/command-parser/command-parser.service.ts:39`; `spec.md` FR02 |
| 2 | **Rev 1 #2 (số tiền 6 chữ số lẻ): đã đóng.** probe: `−$492.26 (~−12.503.404₫)`, `$2,000.00` (rev 1 in `$1,999.998`). Unit `√ amounts are shown in whole cents even when the price has 6 decimals` | Closed | `src/utils/format-message.util.ts` |
| 3 | **Rev 1 #3 (`🔻 −$0.00`): đã đóng.** probe: `Lãi/lỗ: ➖ $0.00 (~0₫) (0.00%)`, `Lãi/lỗ đã chốt: $0.00 (~0₫)`. Unit `√ an amount that rounds to zero shows no sign and no down arrow` | Closed | `format-message.util.ts` |
| 4 | **Rev 1 #4 (mọi coin thiếu giá → `$0.00`): đã đóng.** probe: `💰 Tổng giá trị: chưa lấy được giá lúc này`. Bản tin in `💼 Danh mục: chưa lấy được giá lúc này` | Closed | `format-message.util.ts` (`formatTotalValue`) |
| 5 | **Rev 1 #5 (`−$∞`): đã đóng.** `changePercent24h ≤ −100` giờ được coi là thiếu số liệu. Unit `√ a 24h change of −100% or less is treated as missing, never as an infinite change` | Closed | `src/portfolio/portfolio-calculator.ts:144-149` |
| 6 | **Rev 1 #6 (lần ghi bị từ chối vẫn được đếm): đã đóng.** Bộ đếm giờ được cộng từ `RETURNING` của INSERT, qua CTE. pglite: bị từ chối → `writes: 1` cho 1 trade; redelivery → `writes: 4` cho 4 trade | Closed | `src/portfolio/portfolio.service.ts` (`recordTrade`) |
| 7 | **Rev 1 #7 (số thứ tự > 999): đã đóng.** Parser nhận 1–999999. probe: `xoa 1234` → 1234, `xoa 999999` → OK, `xoa 1000000` → INVALID. Để chạm trần mới phải ghi gần 10⁶ lần trong một chat, nên không còn là rủi ro thực tế | Closed | `command-parser.service.ts:30` |
| 8 | **Rev 1 #8 (`message_id` > 128 làm lệnh ghi lỗi): đã đóng.** Id dài giờ được thay bằng NULL (bỏ chống lặp cho tin đó). pglite `LONG-MSGID ok`. Đánh đổi: tin có id dài không được chống lặp khi Zalo gửi lại. Id thật chỉ dài khoảng 20 ký tự, nên verifier chấp nhận cách này | Closed | `portfolio.service.ts`, `portfolio.constants.ts` |
| 9 | **Rev 1 #9 (message của `InconsistentTradesError` chứa số lượng): đã đóng.** Message giờ không còn chứa số lượng. Unit `√ never quotes the quantity in the error, since the message is logged (NFR06)` | Closed | `portfolio-calculator.ts:27,32` |
| 10 | **Rev 1 #10 (tin gửi lại sau khi giao dịch gốc bị xoá thì được ghi lại): còn, đã được chấp nhận.** pglite vẫn cho `REDELIVER-AFTER-DELETE duplicate=false`. `implement.md` ghi owner đã duyệt chấp nhận. Khả năng xảy ra thấp | Low (accepted) | `portfolio.service.ts` |
| 11 | **Rev 1 #11 (0002 được sửa tại chỗ): đã đóng.** Migration có thêm `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Probe `legacy`: DB đã chạy 0002 bản cũ, có sẵn dữ liệu, sau 2 lần migrate thì có cột, có đúng 1 CHECK và có unique index | Closed | `db/migrations/0002_create_portfolio.sql` |
| 12 | **Rev 1 #12: driver Neon HTTP thật vẫn chưa chạy.** Không đổi. Đây là lý do AC19 untested | Medium (process) | `test/portfolio.postgres.e2e-spec.ts` (skip) |
| 13 | **Mới: `implement.md` tham chiếu sha trước rebase** (`102be65`, `cc24a41`, `9409ef6`). Các sha này không còn trên nhánh; sha đúng là `eb54c49`, `23e1d65`, `d72a1a9`. Chỉ ảnh hưởng khả năng truy vết | Low (docs) | `docs/epics/EPIC-003/artifacts/implement.md` |

## 7. Shortest path to pass

> *Chỉ khi verdict là fail: tập thay đổi nhỏ nhất để lật verdict.*

1. **AC19:** tạo một Neon branch tạm (hoặc chạy Docker + `local-neon-http-proxy`), rồi chạy `PORTFOLIO_INT_DATABASE_URL=… npm run test:e2e -- portfolio.postgres`. 18 kịch bản phải pass qua driver thật. Bước này cũng đóng finding #12.
2. **Deploy** theo `DEPLOYMENT.md` §3a (`npm run db:migrate` trước, sau đó `vercel deploy --prod`), rồi smoke test `/danhmuc` trong chat riêng thật.
3. **AC17:** lấy p95 của `portfolio-view.durationMs` và xác nhận ≤ 5 giây.
4. **AC20:** owner đối chiếu `/danhmuc` với app sàn/ví, rồi ghi kết quả vào file này.

Không cần thay đổi code nào để lật verdict. Nên có quyết định của PO về finding #1 (`1,500` = 1500 trong số lượng) trước khi mở `/danhmuc` cho người dùng ngoài owner.
