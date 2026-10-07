# Verification Report — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 1)
**Created:** `2026-10-07`
**Verified against:** `spec.md`, `plan.md`

---

> Kiểm trên HEAD `e5c966f` của `feature/epic-004-simple-signals`, máy Windows có Docker. Checklist lập từ `spec.md` §6 và `plan.md` §5, §7 **trước** khi mở `implement.md`; `implement.md` chỉ được đọc sau cùng để đối chiếu (§6). Verifier không gọi production và không sửa code; cây làm việc sạch (`git status` rỗng), mọi probe nằm ở scratchpad, không commit.
>
> Môi trường kiểm: Redis scratch (Docker `ea-redis` + `ea-srh`, `http://localhost:8079`), một server giả (Zalo + CoinGecko) tự viết ở scratchpad để ép giá và ghi lại nội dung gửi, và **ứng dụng đã build** (`node dist/main`) chạy với đủ env đặt tường minh (`KV_REST_API_URL=http://localhost:8079` đã in ra và kiểm trước mỗi lần chạy). Postgres **cố ý không với tới được** (URL giả `127.0.0.1:1`) để chứng minh lượt kiểm tra không đụng Postgres. Một lượt chạy riêng dùng CoinGecko thật (keyless, vài lệnh) cho backtest BTC/ETH. Mọi tiến trình đã dừng khi xong.

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 16/18 AC pass, 1 fail (`EPIC-004-AC10`), 1 untested (`EPIC-004-AC04`, phần "≤ 30 phút"). Ngoài bảng AC: NFR01, NFR02, NFR04, ngân sách lệnh Upstash và Lua trên Upstash thật chưa kiểm được trước deploy (§2.1).

Phần lõi hoạt động đúng và chắc: các quy tắc (ngưỡng, biên, vùng 25%, không báo lặp, giới hạn 1 giờ, backtest, chấm điểm) đúng với số của spec; luồng chạy thật qua ứng dụng đã build, Redis thật và Zalo giả cho đúng kết quả, kể cả lượt chạy trùng, chạy đồng thời, chat lỗi, nguồn giá lỗi, tắt/bật sau khi khởi động lại, giám sát (down / nhắc lại / recovered / chưa từng khoẻ thì im). Lỗi duy nhất ở mức tiêu chí là một thiếu sót nhỏ của định dạng trả lời (§2, AC10). Rủi ro đáng đọc nhất không nằm ở code mà ở con số chất lượng trong `implement.md` không tái hiện được (§6 #2).

## 2. Acceptance criteria

Mọi lệnh dưới đây do verifier tự chạy ngày 2026-10-07:
- `unit` = `npx jest`: **33/33 suite, 476/476 pass**.
- `e2e` = `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand --verbose`: **3 suite pass, 1 skip (Postgres opt-in); 84 pass, 18 skip, 0 fail**. Suite `signals.redis` chạy 17 ca trên Redis thật (Lua thật).
- `probe` = script ts-node gọi thẳng `evaluateSignal`, `selectCoinsToAlert`, `runBacktest`, `scoreRecords`, formatter và `CommandParserService` (từ `dist/`) với đúng số của spec, kèm các đầu vào dị biệt.
- `live` = ứng dụng đã build chạy thật + Redis scratch + Zalo/CoinGecko giả (`/cron/signals`, `/webhook`, `/cron/daily-digest` qua `AppModule` thật chỉ thay `SubscribersService` và `PortfolioService`, vì Postgres không có).

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-004-AC01` | 100.000→84.000 mạnh; +7,5%/+11,1% không mạnh; 72h đúng 15% mạnh | pass | probe: `100000->84000 (24h)` → `strong:true, v:buy, c24:-16.00`; `+7.5%/24h +11.1%/72h` → `strong:false, c24:7.53, c72:11.11`; `boundary 72h 100000->115000` → `strong:true, c24:2.68, c72:15.00, win:72h`. Biên thêm: đúng +8,00%/24h → `strong:true`; 7,99% → `strong:false`; đúng −8,00% → `strong:true`. |
| `EPIC-004-AC02` | Khoảng 80k–120k: 84k mua, 116k bán, 100k theo dõi, đúng 90k (25%) mua | pass | probe: `price 84000` → `buy, pos 10.0`; `116000` → `sell, pos 90.0`; `100000` → `watch, pos 50.0`; `90000` → `buy, pos 25.0`; thêm `89999.99` → `buy`; `110000` (75%) → `sell`. |
| `EPIC-004-AC03` | ETH +3%/24h, +5%/72h: không nhận định, không tin chủ động | pass | probe: `eth` → `strong:false, v:null` (c24 3,00; c72 6,03) và `eth 5% 72h` → `strong:false, v:null`. live: run 6–7 với coin không mạnh → `chatsAlerted:0`, server Zalo giả không nhận tin nào. unit `√ AC03: sends nothing when no coin swings strongly`. |
| `EPIC-004-AC04` | Chat đăng ký, BTC mạnh, chưa nhận tin 60 phút → đúng một tin có coin, nhận định, lý do, miễn trừ, **trong ≤ 30 phút** | untested | Phần nội dung pass: live lượt 1 gửi `chat-bad`/`chat-v` đúng một tin `📡 Tín hiệu: có coin dao động mạnh / 🔻 BTC: -16.0% (24h) · -16.0% (72h) — 🟢 Cân nhắc mua / Lý do: -16.0% trong 24 giờ; giá $84,000.00 nằm gần đáy khoảng 7 ngày (0%, khoảng $84,000.00–$100,000.00). / ⚠️ Chỉ là thông tin tham khảo… / Tắt tin này: /tinhieu tat`. Phần "≤ 30 phút kể từ khi vượt ngưỡng" phụ thuộc lịch cron-job.org 30 phút và chỉ quan sát được trên production. **Cách đóng:** sau khi tạo job, đọc log `signals-run` của vài lượt và đo thời gian từ lúc coin vượt ngưỡng tới lúc tin đến (plan §5, bước 10). |
| `EPIC-004-AC05` | 10:00 gửi; 10:20, 10:50 không; 11:00 gửi ETH; chạy trùng cùng phút không tin thứ hai | pass | probe `selectCoinsToAlert` (BTC báo 10:00): `10:20 eth (cooldown no) []`, `10:50 eth [] `, `10:59:59 eth (no) []`, `11:00 eth (yes) ['eth']`. live: hai lần `/cron/signals` liền nhau → `chatsAlerted:0` cả hai, không tin mới. live đồng thời (hai curl cùng lúc): log lượt chạy ra một `healthy chatsAlerted:3` và một `skipped`, mỗi chat đúng một tin. live sửa trạng thái: `lastSentAt` 59 phút trước → chat-v không nhận gì; 61 phút trước (đã báo BTC) → nhận một tin chỉ có ETH. |
| `EPIC-004-AC06` | BTC, ETH, SOL cùng mạnh → một tin chứa cả ba | pass | live: `chat-x` (SOL+BTC) và `chat-v` (BTC+ETH) mỗi chat đúng một tin chứa cả hai coin; 50 chat × 4 coin: tối đa 1 tin mỗi chat trong 5 lượt (`load chats messaged 50, max msgs per chat 1`). Ba coin: unit `√ AC06: puts BTC, ETH and SOL in a single message`. |
| `EPIC-004-AC07` | BTC báo −16% lúc 10:00; 15:00 −18% không; −21% có; đổi chiều +9% có ngay; sau 24h báo lại | pass | probe: `15:00 btc -18 (no) []`, `15:00 btc -21 (yes) ['btc']`, `-20.999999 (no?) []`, `+9 flip (yes) ['btc']`, `+24h btc -16 (yes) ['btc']`, `+23:59 btc -16 (no)` → `[]`. Đổi chiều trong lúc còn cooldown vẫn chờ hết giờ (đúng FR05). |
| `EPIC-004-AC08` | Bản tin 9h: có phần "Tín hiệu" với BTC và nhận định; không mạnh → một dòng; chat chưa đăng ký không có bản tin | pass | live `/cron/daily-digest` (AppModule thật, Postgres giả hai subscriber): chat có BTC/ETH nhận `📡 Tín hiệu: coin đang dao động mạnh / 🔻 BTC … 🟢 Cân nhắc mua … ⚠️ Chỉ là thông tin tham khảo…`; chat DOGE nhận `📡 Tín hiệu: Không có coin nào dao động mạnh.`. Chat không trong `listActive()` không được gửi (không có đường nào khác tới Zalo): unit `√ a chat that is not subscribed gets no digest and no signals (AC08)`. |
| `EPIC-004-AC09` | Tính tín hiệu lỗi → phần giá vẫn gửi, chat khác không bị ảnh hưởng, có log lỗi | pass | live: đặt `KV_REST_API_URL=http://127.0.0.1:1` (Redis chết) rồi chạy digest: cả hai chat vẫn nhận `🌅 Bản tin giá sáng nay: 🔺 BTC … 🔺 ETH …` không có phần tín hiệu; log `ERROR [DigestController] Daily digest: signals not computed, sending prices only: TypeError`, HTTP 200. Lỗi chỉ một chat: unit `√ AC09: a failure while building one chat part never touches another chat`. |
| `EPIC-004-AC10` | `/tinhieu eth` trả: thay đổi 24h, 72h, **vị trí trong khoảng 7 ngày**, có mạnh hay không, nhận định, lý do, miễn trừ; `xyzabc` → thông báo của `/gia`; nguồn giá lỗi → thông báo tạm thời, không số | **fail** | live (CoinGecko thật) `/tinhieu eth` khi ETH không mạnh trả đúng hai dòng: `📡 Tín hiệu hiện tại: / ➖ ETH: $2,571.90 · -4.8% (24h) · -4.7% (72h) — không dao động mạnh, không có nhận định.` Thiếu **vị trí trong khoảng giá 7 ngày** (và khoảng giá). Vị trí chỉ xuất hiện trong "Lý do" khi coin mạnh (`formatSignalLine` nhánh `!isStrong`, `src/utils/format-signals.util.ts:103-109`). Spec §3.1 và AC10 đòi vị trí cho `/tinhieu <coin>` nói chung. Phần còn lại pass: live `/tinhieu xyzabc` → `⚠️ Không tìm thấy đồng coin: XYZABC. Vui lòng kiểm tra lại mã coin.`; coin mạnh có đủ 24h/72h/vị trí/nhận định/lý do/miễn trừ (live `/tinhieu eth` với ETH −10%); nguồn giá lỗi: e2e `√ AC10: a price source outage gets the "/gia" outage message, with no numbers`. **Cách đóng:** thêm vị trí (`positionPct`, khoảng giá) vào dòng của coin không mạnh, kèm test. |
| `EPIC-004-AC11` | Coin có 5 ngày lịch sử → "chưa đủ dữ liệu", không nhận định | pass | probe: lịch sử 5 ngày → `insuff:true, v:null`; `empty` → `insuff:true`. Trả lời in ra: `⏳ NEWCOIN: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.`; phần bản tin: `ℹ️ Chưa đủ dữ liệu (cần 7 ngày): NEWCOIN`. e2e `√ AC11: shows "chưa đủ dữ liệu" and no verdict for a short history`. |
| `EPIC-004-AC12` | 90 ngày, 6 mua đúng 4 (66,7%), 5 bán đúng 2 (40%), ghi chú xấp xỉ, miễn trừ; dưới 14 ngày từ chối | pass | probe: chuỗi 90 ngày dựng tay (11 sự kiện, mỗi sự kiện kéo dài 3 ngày liên tiếp) → `{"insufficient":false,"days":90,"buy":{"scored":6,"correct":4},"sell":{"scored":5,"correct":2}}`; trả lời: `📊 Backtest BTC — 90 ngày gần nhất / • Cân nhắc mua: 6 lần, đúng 4 (66.7%) / • Cân nhắc bán: 5 lần, đúng 2 (40.0%) / … ℹ️ Chỉ là xấp xỉ: backtest dùng giá cuối ngày … / ⚠️ Chỉ là thông tin tham khảo…`. 13 ngày → `⏳ Chưa đủ lịch sử để backtest BTC: có 13 ngày, cần ít nhất 14 ngày.`; 14 ngày chạy được; mảng rỗng bị từ chối. Việc gộp các ngày liên tiếp được chứng minh: mỗi sự kiện 3 ngày vẫn cho đúng 11 tín hiệu, không phải 33. Số thập phân in `66.7%` (dấu chấm, cùng kiểu mọi tin khác của bot) thay vì `66,7%` trong spec: chỉ khác cách viết. |
| `EPIC-004-AC13` | Mua BTC ở 84.000; 3 ngày sau 90.000 → đúng; 80.000 → sai; trước 3 ngày → chờ chấm; `thongke` khớp; cùng coin-nhận định-ngày tính một lần | pass | probe `scoreRecords`: `90000 after 3d` → `buy {scored:1, correct:1}`; `80000 after 3d` → `correct:0`; bằng giá 84000 → `correct:0` (không "cao hơn"); `<3d pending` → `pending:1`; đúng 3 ngày nhưng chưa có điểm giá sau đó → `pending:1`; hai nhận định cùng ngày → `scored:1`. Redis thật: `√ keeps the first record per coin, verdict and day (AC13)`. live: `/tinhieu thongke` ở chat vừa xem ETH → `Còn chờ chấm: 1 (chưa đủ 3 ngày)`; chat khác (`chat-r2`) → `📭 Chưa có nhận định nào trong 30 ngày qua để chấm điểm.` |
| `EPIC-004-AC14` | `tat` xác nhận, không nhận tin chủ động, bản tin vẫn có phần Tín hiệu, watchlist không đổi; `bat` bật lại; còn nguyên sau khởi động lại | pass | live: `/tinhieu tat` → `🔕 Đã tắt tin tín hiệu chủ động. Phần "Tín hiệu" trong bản tin 9h sáng vẫn còn.`; `SMEMBERS signals:off` → `["chat-v"]`; `/cron/signals` (đã xoá trạng thái đã gửi) không gửi chat-v nhưng gửi chat khác; **dừng và khởi động lại ứng dụng**, chạy lại → vẫn không gửi chat-v; `/tinhieu bat` → `🔔 Đã bật tin tín hiệu chủ động…`; lượt sau gửi chat-v. Bản tin: `DigestController` không đọc tập tắt (`grep` rỗng), nên phần Tín hiệu luôn còn; watchlist nằm ở Postgres, không bị lệnh này chạm. |
| `EPIC-004-AC15` | Nguồn giá lỗi → không gửi, log một dòng lượt lỗi, lượt sau bình thường; một chat gửi lỗi, chat khác vẫn nhận | pass | live: CoinGecko giả trả 500 → HTTP 200, `signals-run … "outcome":"failed"`, `KEYS *` chỉ còn `signals:runs` và `signals:watch` (không lưu điểm giá, trạng thái hay nhận định), 0 tin tới Zalo; lượt kế `outcome:"healthy","chatsAlerted":4`. Chat lỗi: Zalo giả từ chối `chat-bad` → `{"outcome":"healthy","chatsAlerted":3,"failures":1}`, ba chat còn lại đều nhận tin; `signals:rec:chat-bad` không tồn tại (không ghi nhận định khi chưa gửi được) và chat-bad vẫn đủ điều kiện ở lượt sau. |
| `EPIC-004-AC16` | 50 chat, 30 coin khác nhau → nguồn giá ≤ 2 lần, Postgres không bị truy vấn | pass | live: 50 chat, 33 coin: lượt 1 gọi `cg-price` **1 lần**, các lượt sau 0 lần (bộ nhớ đệm 30 giây có sẵn); log lượt chạy `"coins":33,"chatsAlerted":17`. Postgres: cả lượt chạy `/cron/signals` đều xong với `POSTGRES_URL` trỏ `127.0.0.1:1`, log không có lỗi DB nào ở phía cron (lỗi `NeonDbError` chỉ xuất hiện ở `/tinhieu` không tham số, là lệnh người dùng); `SignalsModule` không import Postgres/`SubscribersService`. unit `√ AC16: prices 30 coins for 50 chats with at most two price lookups`. **Lưu ý:** lấp lịch sử gọi thêm `market_chart` (5 lệnh mỗi lượt, 7 lượt liền cho 33 coin), xem §6 #4. |
| `EPIC-004-AC17` | Dùng `/tinhieu` hoặc nhận tin được ghi (chat, loại, thời điểm); đếm được chat ngoài owner dùng lại sau ngày đầu; log không chứa nhận định | pass | live: `HGETALL signals:use:2026-10-07` → `["chat-v\|alert","1","chat-bad\|alert","1","chat-x\|alert","1",…]` rồi `chat-r\|command 3`. `npm run signals:report` trên Redis scratch (thêm một ngày cũ cho chat-r): `Used /tinhieu on 2+ different days (came back): 1 / => MET`. Log: `grep -ciE "cân nhắc\|theo dõi\|verdict\|buy\|sell\|-16\|84000"` trên toàn bộ log ứng dụng (mọi lượt) → `0`; unit `√ logs a run without any verdict text (AC17)`. |
| `EPIC-004-AC18` | `/help` liệt kê `/tinhieu` kèm ví dụ; `docs/API.md` có lệnh | pass | `formatHelpReply()` in ra: `• /tinhieu — … · /tinhieu eth — một coin` và `• /tinhieu backtest btc — … · /tinhieu thongke — … · /tinhieu tat (hoặc bat) — …`. `docs/API.md` dòng 109–113 có `/tinhieu`, `eth`, `backtest btc`, `thongke`, `tat`/`bat`, cộng mục `GET /cron/signals`; `.env.example` có `SIGNALS_CRON_SECRET`, `SIGNAL_SWING_24H_PCT`, `SIGNAL_SWING_72H_PCT`, `SIGNAL_BAND_PCT`. |

### 2.1 NFR kiểm được hoặc không kiểm được

| Id | Verdict | Evidence |
|---|---|---|
| `NFR01` ≤ 30 phút | untested | Chỉ quan sát được sau khi có job cron-job.org. Xem AC04 và §6 #3. |
| `NFR02` ≤ 5 giây p95 | untested | Một lệnh `/tinhieu eth` và backtest trên máy cục bộ trả lời dưới 1 giây (lượt cron 33 coin: `durationMs` 554 lần đầu có lấp lịch sử, 52–205 ms sau đó); không phải p95 trên production với Upstash thật. |
| `NFR03` quota nguồn giá | pass (kèm lưu ý) | Một lượt: 1 lệnh giá cho 33 coin. Lưu ý lấp lịch sử §6 #4. |
| `NFR04` lưu trữ | untested | Kích thước mỗi coin sau lấp: `ZCARD signals:hour:btc` 193, `signals:day:btc` 92 (nhỏ), nhưng dung lượng và trần của Upstash thật chưa đo. |
| `NFR05` không truy vấn Postgres mỗi lượt | pass | Xem AC16. |
| `NFR06` không quá 1 tin/60 phút | pass | Xem AC05; 50 chat × 5 lượt liên tiếp: `max msgs per chat 1`. |
| `NFR07` log ghi cả lỗi; giám sát | pass | Log `signals-run` có `outcome` `failed`/`skipped`/`healthy`, `failures`, `chatsAlerted`, `durationMs`. Giám sát qua `/cron/price-alerts-watch` (live): chưa từng khoẻ → 0 tin; 80 phút → 0 tin; 95 phút → đúng 1 tin `⚠️ Tín hiệu: lượt kiểm tra ngừng chạy.`; gọi lại và +2 giờ → 0 tin; nhắc cuối 361 phút trước → 1 tin `lượt kiểm tra vẫn chưa chạy lại`; ngay sau đó 0 tin; chạy một lượt khoẻ → đúng 1 tin `✅ … đã chạy lại … Gián đoạn khoảng 1 giờ 35 phút`; gọi lại → 0 tin. |
| `NFR08` xác định, kèm số | pass | probe: cùng dữ liệu luôn cùng kết quả; mọi nhận định in kèm % và vị trí. |
| `NFR09` giới hạn input | pass | live: `chat.id` 65 ký tự → `HTTP 400`, 64 ký tự → 200; ký hiệu coin 21 ký tự → `SIGNAL_INVALID`, 20 ký tự → hợp lệ; Redis thật `√ drops records older than 90 days and caps a chat at 1000`; `√ tracks up to the cap … and expires`. |
| `NFR10` riêng tư, log | pass | AC17; bảng điểm chỉ đọc `signals:rec:<chatId>` của chính chat (live: chat-r2 không thấy nhận định của chat-r). |
| `NFR11` giới hạn tần suất lệnh | pass | live: 7 lần `/tinhieu tat` liên tiếp từ một chat → `200 200 200 200 200 429 429`. |

## 3. Promised proofs

| Proof (plan §5, §6) | Executed | Result |
|---|---|---|
| `npx jest src/signals/signal-evaluator`, `signal-repeat`, `signal-backtest`, `signals.controller`, `src/digest`, `src/utils`, `scripts`, `src/price-alerts` | Có, trong `npx jest` đầy đủ | 33/33 suite, 476/476 |
| `npm run test:e2e` (webhook, AC10–AC14) | Có | 84 pass / 18 skip (Postgres) |
| `test/signals.redis.e2e-spec.ts` trên Redis thật (Lua, `NX`, khoá chạy, tắt/bật sau khi tạo lại service) | Có, `--runInBand` | 17/17 pass. Ghi chú: plan nói `ZADD NX`, code dùng `HSETNX` trên hash (đúng ý định, không được ghi ở "Deviations" của `implement.md`) |
| Instance chạy tay: `curl /cron/signals` + webhook giả | Có | Mục §2, live |
| Backtest thật BTC/ETH (AC12, rủi ro "chất lượng nhận định") | Có (CoinGecko thật) | Với ngưỡng mặc định: BTC mua 0 lần, bán 1 lần đúng 0; ETH mua 0 lần, bán 1 lần đúng 0. Xem §6 #2 |
| `npm run signals:report` trên Redis scratch | Có | In đúng chỉ số thành công, danh sách chat, lượt chạy gần nhất |
| NFR07 giám sát (cả hold/phục hồi) | Có, live | §2.1 |
| NFR01, NFR02, ngân sách Upstash, NFR04, Lua trên Upstash thật (plan bước 10) | **Không** — chỉ làm được sau deploy, plan đã nói trước | untested |
| Số lệnh Redis mỗi lượt | Đo gián tiếp | Một lượt ổn định trên Redis scratch: `eval` 3, `get` 1, `hgetall` 2, `smembers` 1, `zrange` 1, `mget` 1, `lpush`/`ltrim`/`set`/`multi`/`exec` mỗi loại 1–2 ở mức cao nhất (lệnh bên trong Lua cũng được đếm). Cỡ ~12–14 lệnh cấp cao mỗi lượt, khớp phần "~14 lệnh/lượt" trong `implement.md`; cách Upstash tính `EVAL` chưa kiểm |

## 4. Regressions

```
$ npx jest
Test Suites: 33 passed, 33 total
Tests:       476 passed, 476 total
EXIT 0

$ npx tsc --noEmit            -> EXIT 0
$ npm run build               -> EXIT 0
$ npx eslint src/signals src/utils src/digest src/webhook src/command-parser src/coingecko src/config test/signals.redis.e2e-spec.ts test/webhook.e2e-spec.ts
                              -> EXIT 0, không có dòng nào (kể cả nhiễu CRLF)

$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand --verbose
Test Suites: 1 skipped, 3 passed, 3 of 4 total
Tests:       18 skipped, 84 passed, 102 total
EXIT 0
```

Cảnh báo giá cũ không đổi hành vi:
- `git diff master...HEAD -- src/price-alerts` chỉ đụng hai tệp: `price-alerts-watch.controller.ts` (+15 dòng: gọi thêm `SignalsMonitorService.check()` trong `try/catch` riêng sau watcher cũ) và `price-alerts.module.ts` (import `SignalsModule`). Không spec nào của `src/price-alerts` bị sửa; toàn bộ vẫn xanh trong 476 test.
- `src/utils/format-message.util.ts`: `formatUsd` và `formatIctDateTime` được `export`, `formatDailyDigestReply` thêm tham số tuỳ chọn thứ tư, `formatHelpReply` thêm hai dòng. Test digest cũ (`… without it the digest is unchanged`) vẫn xanh.
- e2e cũ (`/gia`, `/dangky`, `/canhbao`, `/danhmuc`, `/cron/price-alerts*`) đều pass trong lượt chạy đầy đủ ở trên.

Hai suite Redis e2e (`price-alerts.redis`, `signals.redis`) cùng `flushdb` một DB nên **bắt buộc `--runInBand`**; không chạy song song (đã ghi trong header test; CI không ảnh hưởng vì cả hai tự bỏ qua khi không có URL).

## 5. Out-of-scope check

Không có gì trong `Out of scope` bị ship.
- Chỉ báo kỹ thuật: tìm theo từ nguyên (`rsi|macd|bollinger`) trong `src/` không có kết quả.
- Không có kênh khác ngoài Zalo (`telegram|messenger` không có trong code).
- Không có bảng Postgres hay migration: `git diff master...HEAD --name-only` không chứa `db/`, `.sql` hay migration; `src/signals` không import Postgres.
- Ngưỡng là cấu hình chung (`SIGNAL_SWING_*`, `SIGNAL_BAND_PCT`), không có ngưỡng theo chat.
- Không có gói trả phí, không liên kết với danh mục (`/danhmuc`), backtest chỉ chấm đúng/sai hướng, không mô phỏng lãi/lỗ.
- "Deliberately not doing" của plan §7: không dùng Postgres; luật `/canhbao` không đổi; không có cron chấm điểm riêng (chấm khi đọc: `signals:report` và `scorecard` đều tính khi đọc); không chạm `vercel.json`.

## 6. Findings

Đối chiếu `implement.md` (đọc sau cùng): các con số 476 test, 84/18 e2e, 17 ca Redis, và "chạy hai lần liền chỉ một tin" **khớp** lượt chạy của verifier; "đã đẩy lên origin" đúng (`origin/feature/epic-004-simple-signals` tồn tại). Số commit/tệp (`13`/`63`) nay là 15/64 do các commit docs thêm sau, không ảnh hưởng. Các điểm không khớp nằm ở bảng sau.

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **AC10 fail: trả lời cho coin không mạnh thiếu vị trí trong khoảng giá 7 ngày.** Reproduce: `/tinhieu eth` khi ETH không dao động mạnh in `➖ ETH: $2,571.90 · -4.8% (24h) · -4.7% (72h) — không dao động mạnh, không có nhận định.` Số `positionPct`, `rangeLow`, `rangeHigh` đã có trong `SignalResult` nhưng không được in ở nhánh này. Sửa một dòng trong formatter và một test | Medium (chặn AC10) | `src/utils/format-signals.util.ts:103-109` (`formatSignalLine`) |
| 2 | **Con số chất lượng trong `implement.md` không tái hiện được và dựa trên ngưỡng không phải của spec.** `implement.md` §3.2 và §5 nêu "Backtest BTC 90 ngày thật: mua 9 lần, đúng 6; bán 7 lần, đúng 2 (28,6%)", nhưng cùng mục nói ngưỡng được hạ xuống 0,05%/0,1% cho lượt chạy đó. Verifier chạy backtest trên dữ liệu thật (CoinGecko, 90 ngày) với ngưỡng mặc định 8%/15%: BTC `mua: chưa có lần nào đủ 3 ngày để chấm`, `bán: 1 lần, đúng 0 (0.0%)`; ETH cũng 1 lần bán, đúng 0. Hai điều rút ra cho owner: (a) kết luận "bán đúng 28,6%" không mô tả quy tắc đã ship; (b) với ngưỡng mặc định quy tắc gần như không bao giờ nổ trên BTC/ETH (một lần trong 90 ngày), nên tỉ lệ "đúng 0,0%" ở cỡ mẫu 1 gần như vô nghĩa và tin chủ động sẽ rất thưa với coin lớn. Không phải lỗi so với spec (spec concern 1 đã nêu ngưỡng chưa được duyệt), nhưng đây là dữ liệu mà owner cần trước khi bật rộng, và hiện `implement.md` đưa số sai nền | Medium (thông tin quyết định) | `docs/epics/EPIC-004/artifacts/implement.md` §3.2, §5; `docs/DEPLOYMENT.md` bước 8c |
| 3 | **Vòng phản hồi không phủ được AC04 (≤ 30 phút), NFR01, NFR02, NFR04, ngân sách lệnh Upstash, Lua trên Upstash thật.** Plan đã nói trước (§5, bước 10) nhưng như vậy sáu mục này chỉ kiểm được sau deploy; riêng Lua chỉ được thử trên Redis chuẩn 7 qua SRH (`ea-srh`), không phải Upstash. Đề xuất: lượt đầu tiên sau khi tạo job là một lượt kiểm tay bắt buộc có người đọc `signals-run` và `signals:report`; cân nhắc tách một Redis Upstash miễn phí nhánh thử để chạy `signals.redis.e2e` trước khi deploy | Medium (vòng phản hồi) | `plan.md` §5, §6 |
| 4 | **Lấp lịch sử làm tăng số lệnh gọi nguồn giá so với ý spec (NFR03 "việc tích luỹ dùng lại chính dữ liệu đó, không gọi thêm").** Live: 33 coin cần 7 lượt liên tiếp, mỗi lượt 5 lệnh `market_chart` (~220 KB mỗi coin) ngoài 1 lệnh giá. Test AC16 chỉ đếm `getPricesBySymbols`. Plan §1 đã chấp nhận, nên đây là một lệch đã biết chứ không phải lỗi, nhưng bước đầu có thể chạm giới hạn tốc độ không key của CoinGecko: trong lượt chạy thật của verifier, sau khoảng 8 lệnh thật `/tinhieu backtest sol` đã nhận thông báo tạm thời không lấy được giá (429) | Low–Medium | `src/signals/signals-history.service.ts` (backfill), `signals.constants.ts` `MAX_BACKFILL_PER_RUN` |
| 5 | **Tin đầu tiên của một chat chỉ chứa các coin đã lấp xong.** Vì lấp 5 coin mỗi lượt, một chat có nhiều coin mới có thể nhận tin về vài coin trước, coin còn lại phải chờ qua giới hạn 1 giờ. Live: 5 lượt cho 50 chat × 4 coin, mỗi chat nhận đúng 1 tin trong 5 lượt (17, 10, 5, 10, 10 chat mỗi lượt). Đúng FR05, chỉ là ngày đầu tiên tin sẽ không gộp đủ | Low | cùng trên |
| 6 | **Giá hiện tại bằng 0 cho ra "Cân nhắc mua −100%".** probe: `now price 0` → `strong:true, v:buy, c24:-100.00`. Có thể xảy ra nếu CoinGecko trả `usd: 0` cho coin chết | Low | `src/signals/signal-evaluator.ts:57-110` |
| 7 | **Khi `market_chart` bị giới hạn tốc độ, `/tinhieu backtest <coin>` có thể báo "chưa đủ lịch sử, có 0 ngày" thay vì "tạm thời không lấy được giá".** Chỉ đọc code (`chartPoints` nuốt `CoingeckoUnavailableError`), chưa tái hiện riêng lỗi này: trong lượt chạy thật, lỗi xuất hiện ở lệnh giá trước đó nên ra thông báo tạm thời đúng | Low (chưa tái hiện) | `src/signals/signals.service.ts:154-168` |
| 8 | **Chat chặn bot bị gửi lại ở mọi lượt 30 phút, mãi mãi.** Live: `chat-bad` bị từ chối và vẫn đủ điều kiện ở lượt sau (đúng ý định "không mất tin"), mỗi lượt cộng 1 vào `failures` nhưng không làm lượt "không khoẻ". Không có lùi nhịp; quy mô nhỏ nên chấp nhận được, nhưng nên cân nhắc đánh dấu chat sau N lần từ chối liên tiếp | Low | `src/signals/signals.controller.ts:165-168` |
| 9 | **Phần bản tin có thêm dòng "Chưa đủ dữ liệu" bên cạnh dòng "Không có coin nào dao động mạnh"**, trong khi AC08 nói phần đó "là một dòng". Ngoài ra bản tin ghi "Không có coin nào dao động mạnh" cả khi coin không có giá (bị bỏ khỏi `bySymbol`) | Low | `src/utils/format-signals.util.ts:89-103`; `src/digest/digest.controller.ts` `signalsPart` |
| 10 | **Điều chỉnh tài liệu:** `implement.md` §4 không liệt kê rằng bản ghi nhận định dùng `HSETNX` trên hash (plan §2 ghi `ZADD NX` với khoá `coin:verdict:ngày`); hành vi tương đương và test Redis thật xác nhận. Tình huống "gửi được nhưng ghi trạng thái lỗi → báo lại sau 30 phút" (`implement.md` §6 #3) đã được tác giả tự nêu, verifier không thử tạo lại | Low (docs) | `implement.md` §4, `signals-state.service.ts` |
| 11 | Không có `/tinhieu bat` cho coin BAT (đã được tác giả ghi lại), và `/tinhieu tatt` (gõ nhầm) được hiểu là coin `tatt` rồi trả "Không tìm thấy đồng coin" thay vì gợi ý cú pháp. Chấp nhận được | Low | `src/command-parser/command-parser.service.ts:172-206` |

## 7. Shortest path to pass

1. **AC10:** in vị trí trong khoảng 7 ngày (và khoảng giá) cho cả coin không mạnh trong `formatSignalLine`, thêm một test formatter; chạy lại `npx jest src/utils`.
2. **AC04 (phần ≤ 30 phút):** sau khi owner deploy và tạo job cron-job.org mỗi 30 phút, đọc log `signals-run` của vài lượt, chạy tay `/cron/signals` một lần đầu trên Upstash thật (kiểm Lua) và `npm run signals:report`; ghi kết quả vào file này. Cùng lượt quan sát đó đóng NFR01, NFR02 (p95 thời gian lệnh trong log), NFR04 và ngân sách lệnh Upstash (dashboard sau 48 giờ).
3. Không chặn verdict nhưng nên làm trước khi báo người dùng ngoài owner: chạy lại backtest với ngưỡng mặc định cho vài coin, sửa §3.2/§5 của `implement.md` cho khớp con số thật (finding #2), và quyết định ngưỡng với owner.

Không cần thay đổi nào ngoài mục 1 để lật các dòng `fail`; mục 2 chỉ làm được sau deploy.

**Verdict tổng: FAIL — 16 pass, 1 fail (AC10), 1 untested (AC04, chờ production); NFR01, NFR02, NFR04 và Upstash thật chưa kiểm được.**
