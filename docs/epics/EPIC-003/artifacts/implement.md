# Implementation Summary — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Author:** Engineer
**Status:** Draft
**Created:** 2026-09-26
**Traces to:** `plan.md`

---

## 1. Branch and PR

| | |
|---|---|
| Branch | `feature/epic-003-portfolio-tracking`, tách từ `feature/epic-002-fix-alert-monitoring`, **không** tách từ `master` như plan §3 ghi. Lý do: EPIC-002-FIX implement trước, theo quyết định "làm lần lượt" của owner. Vì vậy nhánh này chứa luôn code của EPIC-002-FIX và commit docs `8fc7982` (EPIC-002, không thuộc epic này) |
| PR | Chưa push, chưa mở PR. Nên merge EPIC-002-FIX vào `master` trước, rồi mở PR cho nhánh này. Khi đó diff của PR chỉ còn các commit EPIC-003 |

Các commit của epic này, theo thứ tự:

| Commit | Tiêu đề |
|---|---|
| `6d0e596` | feat(portfolio): add portfolio tables migration |
| `565168a` | feat(portfolio): weighted-average cost calculator |
| `fd907f7` | feat(command-parser): parse /danhmuc |
| `b4297af` | feat(portfolio): postgres-backed trade store |
| `6613782` | feat(portfolio): /danhmuc commands |
| `a145c63` | feat(digest): portfolio section in daily digest |
| `84943a7` | feat(portfolio): usage report script |
| `823047b` | docs(portfolio): /danhmuc commands, portfolio design and deploy order |
| `7a42412` | fix(digest): count a refused Zalo send as failed in the run log |

## 2. What was built

| Plan step | Change | Files |
|---|---|---|
| 1 | Hai bảng mới. `portfolio_trades`: `seq` ổn định theo chat, `UNIQUE (chat_id, seq)`, `CHECK` cho độ dài chat id (≤ 64) và symbol (≤ 20), cho `side`, và cho số lượng/giá > 0; kiểu `NUMERIC(21,8)`. `portfolio_usage`: đếm `views`/`writes` theo chat và ngày. Chỉ dùng `IF NOT EXISTS`, không có `;` trong literal, và ghi lệnh rollback trong comment (`6d0e596`) | `db/migrations/0002_create_portfolio.sql` |
| 2 | Hàm thuần `computeHoldings()`: giá vốn trung bình gia quyền, số lượng tính bằng `bigint` đơn vị 10⁻⁸, reset giá vốn khi bán về 0, giữ lãi/lỗ đã chốt của coin đã bán hết. Hàm `computePortfolio()`: loại coin thiếu giá khỏi mọi tổng, loại coin thiếu % 24h khỏi biến động 24h. Thêm `InconsistentTradesError` (`565168a`) | `src/portfolio/portfolio-calculator.ts` (+ spec), `interfaces/portfolio.interface.ts`, `portfolio.constants.ts` |
| 3 | Parse `/danhmuc` (`/danhmục`, `/portfolio`) với `mua`/`buy`, `ban`/`bán`/`sell`, `lichsu`/`history [trang]`, `xoa`/`delete <n>`, `xoahet [xacnhan]`. `parseThreshold` được đổi thành `parsePositiveNumber(raw, maxDecimals, max)`, trả cả `value` lẫn chuỗi thập phân chính xác `plain`. Hành vi `/canhbao` không đổi (`fd907f7`) | `src/command-parser/*` (+ spec) |
| 4 | `PortfolioService`: mỗi lệnh ghi là một `sql.transaction`. Câu đầu lấy khoá advisory theo chat, sau đó là `INSERT … SELECT … HAVING` (không bán quá, tối đa 200 giao dịch, tối đa 20 coin) hoặc `DELETE … NOT EXISTS` (số dư chạy của coin không được âm, dùng `SUM() OVER`), đếm usage, rồi đọc lại. Nếu có luật từ chối, lỗi cụ thể được suy ra từ chính dữ liệu đọc trong transaction đó. Lỗi DB trả về `PortfolioUnavailableError` và chỉ log tên lỗi kèm SQLSTATE. `scripts/db-migrate.js` export thêm `splitStatements`/`applyMigrations`, CLI giữ nguyên (`b4297af`) | `src/portfolio/portfolio.service.ts` (+ spec), `portfolio.module.ts`, `db-migrate.spec.ts`, `scripts/db-migrate.js`, `test/portfolio.postgres.e2e-spec.ts` (opt-in), `test/support/portfolio-store.scenarios.ts` |
| 5 | Webhook: mọi lệnh `/danhmuc` đi qua `replyToPortfolioCommand`. Chat không phải `PRIVATE`, kể cả khi thiếu `chat_type`, bị từ chối trước khi gọi store hay nguồn giá, và bot log giá trị `chat_type` nhận được. Ghi giao dịch: kiểm tra coin bằng `getPricesBySymbols([symbol])` trước. Xem: 1 lần đọc store rồi 1 lần tra giá, sau đó log `portfolio-view` (không có số tiền). Có 16 formatter thuần mới (USD kèm ~VND); `/help` được cập nhật (`6613782`) | `src/webhook/webhook.controller.ts`, `webhook.module.ts`, `src/utils/format-message.util.ts`, `src/utils/format-portfolio.util.spec.ts`, `src/portfolio/portfolio-prices.ts`, `test/webhook.e2e-spec.ts` |
| 6 | Bản tin: tải giao dịch của mọi subscriber bằng 1 truy vấn. Mỗi subscriber gọi tra giá đúng 1 lần cho watchlist ∪ coin đang giữ, rồi tách kết quả ra. Chat không giữ coin nào nhận đúng tin cũ. Phần danh mục có `try/catch` riêng. Mỗi lượt log một dòng `daily-digest-run` (`a145c63`) | `src/digest/digest.controller.ts` (+ spec), `digest.module.ts` |
| 7 | `npm run portfolio:report`, chỉ đọc: mỗi chat có ngày đầu, số ngày dùng, số lần xem/ghi, và tiêu chí thành công (loại trừ `OWNER_CHAT_ID`). Phần tính toán nằm trong lib thuần (`84943a7`) | `scripts/portfolio-usage-report.js`, `scripts/portfolio-usage-report.lib.js`, `src/portfolio/usage-report-lib.spec.ts`, `package.json` |
| 8 | `API.md`: bảng lệnh. `ARCHITECTURE.md`: bảng module và mục "Portfolio". `DEPLOYMENT.md` §3a: chạy migration 0002 trước khi deploy, cách rollback và drop bảng, smoke test trong chat riêng (`823047b`) | docs |
| (thêm) | Tìm ra khi rà thứ tự lỗi: `ZaloService` không throw mà trả `false`, nên `daily-digest-run` đếm lần gửi hỏng thành `sent`. Đã sửa, có test (`7a42412`) | `src/digest/digest.controller.ts` (+ spec) |
| 9 | **Chưa làm, owner làm:** deploy. Xem §6 | — |

## 3. Proofs executed

Số test trước → sau epic này:
- **Unit:** 185 → **268** (14 → 19 suite).
- **e2e:** 23 → **38 pass**.
- **Opt-in skip:** 8 → **23**. Có 8 test Redis thật của EPIC-002/FIX và 15 kịch bản Postgres thật mới.
- **Sau rev 2 và rev 3 (2026-09-29):** unit **288**, e2e **40 pass**, opt-in skip **26** (18 kịch bản Postgres thật). Lint và build xanh. Rev 3 chạy bộ kịch bản store trên PGlite (Postgres 16 WASM, harness không commit): **28/28 pass**, với đúng `PortfolioService` và `db-migrate.js` của HEAD. Riêng một bảng tạo bằng 0002 bản cũ (`6d0e596`) sau khi migrate có cột `source_message_id`, có unique index, chỉ một CHECK và giữ nguyên dữ liệu.

`npm run lint` (với `prettier endOfLine: auto`, xem §6) và `npm run build` xanh trước mỗi commit.

```
$ npm test
Test Suites: 19 passed, 19 total
Tests:       268 passed, 268 total
$ npm run test:e2e
Test Suites: 2 skipped, 1 passed, 1 of 3 total
Tests:       23 skipped, 38 passed, 61 total
```

**Kịch bản store trên Postgres thật (chạy tay, một lần).** Bộ 15 kịch bản trong `test/support/portfolio-store.scenarios.ts` đã được chạy với PGlite (Postgres 16 bản WASM, chạy trong tiến trình), đúng với `portfolio.service.ts` và migration đã commit ở `b4297af`. Để chạy được phải thêm `--experimental-vm-modules`, nên PGlite không được đưa vào CI (xem §4). Kết quả:

```
$ node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json portfolio.pglite
    √ AC01/AC02: records buys and a sell with stable numbers, and the holdings add up
    √ keeps exact quantities and 8-decimal prices through NUMERIC
    √ AC04: a sell larger than the holding is refused with the held quantity, nothing written
    √ a sell of exactly the held quantity is allowed
    √ AC08: history is newest first, paged, and old numbers stay after a new trade
    √ AC09: deletes only when no later sell breaks, and only in the own chat
    √ a buy that a later sell needs can go once that sell is deleted; other coins never block
    √ AC14: the 201st trade is refused
    √ AC14: a 21st held coin is refused, more of a held coin and coins sold out are fine
    √ AC15: clear deletes every trade of the chat and nothing else
    √ AC16: views and writes are counted per chat and day, with no amounts
    √ AC19: two buys sent at once are both recorded, with distinct numbers
    √ AC19: of two sells sent at once that together oversell, exactly one is recorded
    √ AC19: a statement failing mid-transaction leaves no trade and no usage row
    √ loads many chats in one query for the digest
Tests:       15 passed, 15 total
```

Trước lần chạy đó, migration được áp **hai lần** qua đúng logic tách statement của `db-migrate.js`, và không lỗi. Adapter PGlite và spec đó đã bị xoá sau khi chạy. Chính các kịch bản này được giữ lại cho spec opt-in `test/portfolio.postgres.e2e-spec.ts`, spec này dùng driver Neon thật.

### `EPIC-003-AC01`

```
$ npx jest --verbose src/portfolio src/utils/format-portfolio src/command-parser
      √ AC01: one buy holds that quantity at that price
    √ AC01: a recorded buy shows its number, the coin, quantity, price, holding and average cost
      √ AC01: parses "/danhmuc mua btc 0.5 60000" as a buy trade
      √ runs lock, insert, usage and read in one transaction, and returns the new trade
$ npx jest --config ./test/jest-e2e.json --verbose
      √ AC01: records a buy after checking the coin, and confirms it
```

### `EPIC-003-AC02`

```
      √ AC02: buys average the cost; a sell keeps the average and realizes the gain
    √ a recorded sell also shows the coin's realized result
```

### `EPIC-003-AC03`

```
      √ AC03: value, unrealized and realized PnL, and the 24h change match the hand calculation
    √ AC03: "/danhmuc" shows each coin and every total in USD with ~VND
      √ AC03: "/danhmuc" prices every held coin in one lookup        (e2e)
```

Các con số được kiểm: tổng 67.000; chưa chốt +8.000 (+13,56%); đã chốt +6.000; 24h −492,26 (sai số ≤ 0,01); mọi dòng có số tiền đều kèm `₫`.

### `EPIC-003-AC04`

```
      √ a refused sell reports the held quantity (FR04)
      √ AC04: an oversell is refused with the held quantity           (e2e)
    √ AC04: a sell larger than the holding is refused ...             (Postgres, chạy tay)
```

### `EPIC-003-AC05`

```
      √ AC05: "," is a thousands separator in the price and the quantity
      √ AC05: rejects "/danhmuc mua btc 0.5" as PORTFOLIO_INVALID     (+ 11 input sai khác)
    √ AC05: the invalid-syntax reply shows the correct syntax and number rules
      √ AC05: bad syntax shows the correct syntax and records nothing (e2e)
```

### `EPIC-003-AC06`

```
      √ AC06: an unknown coin gets the "/gia" unknown-coin reply and records nothing   (e2e)
```

### `EPIC-003-AC07`

```
    √ AC07: the empty reply shows how to record a buy
      √ AC07: an empty portfolio shows an example and calls no price source           (e2e)
```

### `EPIC-003-AC08`

```
    √ AC08: history lists number, side, coin, quantity, price and Vietnam date, newest first
    √ history points to the next page, and explains an empty page
      √ AC08/AC09: history and delete reach the store with the chat id                  (e2e)
    √ AC08: history is newest first, paged, and old numbers stay after a new trade      (Postgres, chạy tay)
```

### `EPIC-003-AC09`

```
      √ a trade that still exists after the delete would break a later sell
      √ a trade number the chat does not have is not found
    √ AC09: deletes only when no later sell breaks, and only in the own chat           (Postgres, chạy tay)
```

### `EPIC-003-AC10`

```
      √ AC10: A gets a portfolio part, B gets exactly the old digest, C (not subscribed) nothing
      √ a chat whose coins are all sold gets the plain digest
    √ AC10: the digest section goes before the cron-tracking line; without it the digest is unchanged
```

Tin của B được so bằng đúng chuỗi với `formatDailyDigestReply` cũ, và mỗi subscriber gọi `getPricesBySymbols` đúng một lần.

### `EPIC-003-AC11`

```
      √ AC11: a portfolio that fails to compute still sends the watchlist, and the run log counts it
      √ AC11: when loading the portfolios fails, everyone gets their digest as before
      √ NFR09: a send Zalo refused counts as failed in the run log, not as sent
```

### `EPIC-003-AC12`

```
      √ AC12: refuses every /danhmuc command in a group chat, touching no store        (e2e)
      √ AC12: refuses every /danhmuc command in a chat with no chat_type, touching no store (e2e)
    √ AC12: the group refusal points to a private chat
```

### `EPIC-003-AC13`

```
      √ AC13: a coin with no price is listed, and left out of every total
    √ AC13: an unpriced coin shows "không có giá lúc này" and is noted as left out
      √ AC13: a price source outage when viewing gets the outage reply and no numbers  (e2e)
    √ a held coin with no price is noted in the portfolio part                        (digest)
```

### `EPIC-003-AC14`

```
      √ a refused write at 200 trades reports the trade limit (NFR05)
      √ a refused buy under 200 trades reports the held-coin limit (NFR05)
      √ AC14: the trade limit is explained                                              (e2e)
    √ AC14: the 201st trade is refused                                                  (Postgres, chạy tay)
    √ AC14: a 21st held coin is refused, more of a held coin and coins sold out are fine (Postgres, chạy tay)
```

### `EPIC-003-AC15`

```
      √ AC15: "/danhmuc xoahet" asks for confirmation, "/danhmuc xoahet xacnhan" confirms
      √ AC15: "xoahet" alone asks to confirm and deletes nothing; confirmed, it clears   (e2e)
    √ AC15: clear deletes every trade of the chat and nothing else                     (Postgres, chạy tay)
```

### `EPIC-003-AC16`

```
      √ AC16: no amount the user sent reaches the logs                                  (e2e: bắt mọi Logger level)
      √ a database error becomes PortfolioUnavailableError, and the log carries no amounts (NFR06)
    √ summarizes each chat: first day, days used, totals, and whether it came back
    √ the metric counts non-owner chats that recorded a trade and came back after day one
    √ AC16: views and writes are counted per chat and day, with no amounts             (Postgres, chạy tay)
```

### `EPIC-003-AC17`

Phần "gọi nguồn giá ≤ 2 lần" đã có bằng chứng (e2e AC03: `getPricesBySymbols` được gọi đúng 1 lần cho 2 coin). Phần **≤ 5 giây p95 chưa đo**: cần log `portfolio-view.durationMs` trên production (bước 9).

### `EPIC-003-AC18`

```
      √ AC18: "/huy" never touches the portfolio, which still answers afterwards        (e2e)
```

### `EPIC-003-AC19`

```
      √ AC19: a store failure gets a friendly reply and a 200                           (e2e)
    √ AC19: two buys sent at once are both recorded, with distinct numbers              (Postgres, chạy tay)
    √ AC19: of two sells sent at once that together oversell, exactly one is recorded   (Postgres, chạy tay)
    √ AC19: a statement failing mid-transaction leaves no trade and no usage row        (Postgres, chạy tay)
```

### `EPIC-003-AC20`

Chưa làm, vì đây là kiểm tra thủ công trên production do owner làm ở bước 9.

## 4. Deviations from the plan

1. **Không có test Postgres thật chạy trong CI.** Tôi thử dùng PGlite (Postgres WASM, không cần Docker) làm devDependency. Nhưng cả bản ESM lẫn CJS của nó đều gọi `await import("module")`, và Jest VM từ chối lời gọi đó nếu không có `--experimental-vm-modules`. Theo chỉ dẫn "không sa lầy", tôi đã gỡ PGlite khỏi `package.json`/lock và xoá adapter. Bù lại, trước khi gỡ tôi đã chạy tay 15 kịch bản một lần (§3). Các kịch bản giữ trong `test/support/portfolio-store.scenarios.ts`, dùng chung với spec opt-in chạy driver Neon thật, đúng như plan §6.
2. **Sửa `scripts/db-migrate.js`** (plan không liệt kê). Script export `splitStatements`/`applyMigrations` và chỉ chạy `main()` khi được gọi trực tiếp; lệnh CLI không đổi. Lý do: unit test (`db-migrate.spec.ts`) và spec opt-in cần chạy **đúng** code tách statement trên migration 0002, không phải một bản chép lại. Đây là bài học EPIC-001.
3. **`quantity NUMERIC(21,8)` thay cho `NUMERIC(20,8)`.** 10¹² với 8 chữ số lẻ cần 13 + 8 = 21 chữ số, nên với (20,8) thì mức trần trong NFR05 sẽ bị từ chối.
4. **Webhook đi qua một hàm `replyToPortfolioCommand`**, không phải 6 nhánh `case PORTFOLIO_*` trong `switch` chính. Nhờ vậy việc chặn chat nhóm nằm ở một chỗ duy nhất, chạy trước mọi lệnh con.
5. **`pricesBySymbol()` là file mới `src/portfolio/portfolio-prices.ts`**, dùng chung cho webhook và bản tin, thay vì viết lặp ở hai controller. `PriceAlertsController.loadPrices` được giữ nguyên, như plan §7.
6. **Bản tin**: thêm `formatPortfolioDigestUnavailableSection` cho trường hợp tính danh mục lỗi. Dòng `daily-digest-run` có thêm `sent`, `failed` và `portfolioLoadFailed` ngoài các trường plan liệt kê.
7. **Test formatter nằm trong file mới** `format-portfolio.util.spec.ts`, không nối vào `format-message.util.spec.ts`, để giảm xung đột dòng với EPIC-002-FIX.
8. **Ngày trong `portfolio_usage` tính theo giờ Việt Nam** (`Asia/Ho_Chi_Minh`), không theo UTC, để "ngày đầu tiên" khớp với cách người dùng hiểu.
9. **CHANGELOG/ROADMAP chưa sửa**, đúng plan ("cập nhật khi ship").
10. Plan §3 ghi nhánh tách từ `master`; thực tế nhánh tách từ nhánh EPIC-002-FIX (§1).

- **Rev 2 (2026-09-26, owner yêu cầu): chống ghi trùng giao dịch.** Thêm cột `source_message_id` và unique index một phần `(chat_id, source_message_id)` vào `0002_create_portfolio.sql`. Sửa thẳng file 0002 vì chưa chạy trên production. `recordTrade` nhận `message_id` của Zalo; trong cùng transaction, dưới khoá của chat, câu INSERT có thêm `NOT EXISTS` và một câu SELECT tìm giao dịch cũ. Tin gửi lại trả về giao dịch cũ với `duplicate: true`. Unique index là lớp chặn cuối nếu điều kiện bị lách. Hàm thuần `findRecentTwin` (`portfolio-calculator.ts`, cửa sổ `TWIN_TRADE_WINDOW_MS` = 2 phút) phát hiện giao dịch giống hệt giao dịch ngay trước, để lời xác nhận cảnh báo. Lần gửi trùng vẫn cộng 1 vào `portfolio_usage.writes`. Chấp nhận được, vì chỉ số thành công đếm chat chứ không đếm số lần ghi.

- **Rev 3 (2026-09-29): sửa theo verify rev 1.** Ba commit:
  - `eb54c49`: parser từ chối dấu phẩy thập phân. Một số có nhóm hàng nghìn không được bắt đầu bằng `0`, nên `0,123` bị từ chối (trước đó đọc thành 123), còn `100,000` và `60,000.5` vẫn đúng như EPIC-002-FR02 và EPIC-003-AC05. Lời nhắc lỗi có thêm "0.5, không phải 0,5". Số thứ tự xoá và trang lịch sử nhận tới 999999, vì `seq` tăng mãi.
  - `23e1d65`: số tiền trong danh mục làm tròn tới cent, giá coin vẫn giữ tới 6 chữ số lẻ. Số tiền tròn về 0 thì hiện `$0.00` không dấu, kèm `➖`. Khi mọi coin đều thiếu giá, bot ghi "chưa lấy được giá lúc này" thay vì `$0.00`. Biến động 24h ≤ −100% được coi là không có số liệu.
  - `d72a1a9`: `writes` chỉ được cộng từ chính các dòng `RETURNING` của INSERT, qua một CTE ghi dữ liệu. Vẫn 1 round-trip, nên lệnh bị từ chối hay tin gửi lại không được tính. `message_id` dài hơn 128 ký tự thì bỏ qua chống lặp (NULL), không làm lỗi lệnh; tôi chọn cách này thay vì nới cột, vì id thật chỉ dài 20 ký tự. `InconsistentTradesError` không còn chứa số lượng. Migration 0002 có thêm `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
  - Không sửa: tin Zalo gửi lại sau khi giao dịch gốc đã bị xoá thì được ghi lại (xem Known gaps).

- **Rev 4 (2026-09-29): số lượng không có dấu phẩy.** Verify rev 2 xếp `1,500` = 1500 BTC là rủi ro Medium (lỗ hổng spec). Owner quyết định: số lượng trong `/danhmuc mua|ban` không được chứa dấu phẩy, giá vẫn nhận dấu phẩy hàng nghìn, `/canhbao` giữ nguyên. Commit `503c6e8`: `PLAIN_NUMBER_PATTERN` cho số lượng trong `command-parser.service.ts`, lời nhắc lỗi tách quy tắc số lượng và giá, test unit (`1,500`, `1,234.5`, `1,000,000` bị từ chối; `1.5` với giá `60,000` được nhận; `/canhbao btc > 100,000` vẫn đúng) và e2e (không gọi nguồn giá, không ghi). Spec FR02/AC05 và `docs/API.md` sửa theo. Unit 309 → 313, e2e 40 → 41 pass.

## 5. Discovered work

| Item | Where it went |
|---|---|
| Lint local trên Windows báo lỗi `␍` ở mọi file CRLF (git `core.autocrlf=true`, prettier `endOfLine: lf`). Cổng lint của epic này chạy với `prettier endOfLine: auto`. CI (Linux) không bị ảnh hưởng | Nên thêm `.gitattributes` (`* text=auto eol=lf`). EPIC-002-FIX cũng đã ghi nhận việc này. Để owner quyết |
| `PriceAlertsController.loadPrices` và `pricesBySymbol()` làm cùng một việc | Dọn sau khi cả hai nhánh merge (plan §7) |
| Đếm lượt gửi bản tin hỏng thành `sent` | Đã sửa ở `7a42412` |
| Intent Open Q5 (thời gian mỗi lần kiểm tra hôm nay) vẫn chưa có số liệu | Owner, trước khi ra mắt (spec Concern 9) |

## 6. Known gaps

- **Driver Neon HTTP thật chưa được chạy** với `PortfolioService`, vì máy không có Docker và cũng chưa có Neon branch. Spec opt-in `portfolio.postgres.e2e-spec.ts` đang bị skip. Những điểm cần xác nhận trước khi merge: `sql.transaction([...])` chứa `pg_advisory_xact_lock` qua HTTP, `NUMERIC` trả về dạng chuỗi, tham số mảng trong `chat_id = ANY(${chatIds})`, và `COUNT(*)` trả về chuỗi. Cách chạy: tạo một Neon branch, đặt `PORTFOLIO_INT_DATABASE_URL=… npm run test:e2e -- portfolio.postgres`, xong thì xoá branch.
- **Tranh chấp khoá thật chưa được chứng minh.** PGlite chỉ có một kết nối, nên hai kịch bản đồng thời của AC19 thực chất chạy tuần tự. Việc khoá advisory chặn được hai request HTTP song song chỉ chứng minh được trên Postgres thật (mục trên).
- **Bộ đếm usage nằm chung transaction với lệnh.** Nếu ghi `portfolio_usage` lỗi thì cả lệnh xem/ghi cũng lỗi (người dùng nhận "tạm thời không truy cập được"), và mỗi lần xem là một lần ghi. Từ rev 3, lượt ghi chỉ được đếm khi thật sự có giao dịch được ghi. Cách này được chọn để giữ 1 round-trip. Nếu bộ đếm gây sự cố thì tách nó ra.
- **Ghi giao dịch phụ thuộc nguồn giá.** Coin được kiểm tra bằng `getPricesBySymbols` trước khi ghi (FR03), nên khi CoinGecko và CoinPaprika cùng lỗi thì không ghi được giao dịch.
- **Tin gửi lại sau khi giao dịch gốc đã bị xoá sẽ được ghi lại**, vì không còn dòng nào mang `message_id` đó. Cửa sổ gửi lại của Zalo ngắn, nên trường hợp này hiếm. Chấp nhận, không sửa (verify rev 1, owner duyệt).
- ~~**1 BTC viết `1,234` vẫn được hiểu là 1234**~~ Đã xử lý ở rev 4: số lượng không còn nhận dấu phẩy. Giá vẫn nhận (`1,234` = $1234), đúng EPIC-002-FR02.
- ~~**Giao dịch có thể bị ghi trùng**~~ Đã xử lý 2026-09-26 (FR16/AC21, xem §4). Còn lại: người dùng cố ý gửi lại bằng một tin mới vẫn tạo giao dịch thứ hai (đúng AC19), chỉ được cảnh báo. Kịch bản DB thật cho chống lặp nằm trong bộ Postgres opt-in, chưa chạy (không có Docker/Neon branch).
- **`chat_type` của chat riêng thật** mới chỉ được xác nhận qua một payload ngày 2026-09-04. Nếu owner bị chặn nhầm, log sẽ có dòng `Portfolio command refused outside a private chat … chat_type=…`. Cần smoke test ở bước 9.
- **AC17 (p95 ≤ 5 giây) và AC20 (đối chiếu với app sàn)** chỉ đo được sau deploy.
- **Số thứ tự `seq` được dùng lại** khi xoá giao dịch mới nhất. Plan đã chấp nhận điều này.
- Bản tin tải **mọi** giao dịch của các subscriber đang active trong một truy vấn, tối đa 200 dòng mỗi chat. Ổn ở quy mô hiện tại, nhưng cần xem lại nếu số subscriber tăng mạnh.

### Việc owner làm khi deploy (bước 9)

1. Merge EPIC-002-FIX, rồi mở PR cho nhánh này; CI phải xanh.
2. (Nên làm) Tạo một Neon branch và chạy `PORTFOLIO_INT_DATABASE_URL=… npm run test:e2e -- portfolio.postgres`.
3. Chạy `npm run db:migrate` với `POSTGRES_URL` production **trước**, rồi `npm run portfolio:report` phải in ra `Chats that used /danhmuc: 0`.
4. Chạy `npx vercel deploy --prod`.
5. Smoke test từ chat riêng thật: `/danhmuc mua btc 0.001 1`, `/danhmuc`, `/danhmuc lichsu`, `/danhmuc xoahet`, rồi `/danhmuc xoahet xacnhan`.
6. Sau 7 ngày: đọc p95 của `portfolio-view.durationMs` (AC17), xem Neon → Usage (CU-giờ), và đối chiếu với app sàn (AC20).
