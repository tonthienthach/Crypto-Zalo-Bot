# Verification Report — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 2)
**Created:** `2026-10-07`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 2** (2026-10-07): kiểm lại **toàn bộ** epic trên HEAD `d48dd75` của `feature/epic-004-simple-signals` bằng một verifier không dựa vào kết luận của rev 1 hay của engineer. Checklist lập lại từ `spec.md` §6 (AC01–AC18, FR/NFR) và `plan.md` §5, §7 **trước** khi mở `implement.md`; `implement.md` chỉ được đọc sau cùng để đối chiếu (§6). Cây làm việc sạch, không commit, không gọi production; probe và server giả nằm ở scratchpad.
>
> **Rev 1** (HEAD `e5c966f`) ra kết quả fail: 16/18 AC pass, `EPIC-004-AC10` fail (coin không mạnh thiếu vị trí trong khoảng 7 ngày), `EPIC-004-AC04` untested (phần "≤ 30 phút"), cùng 11 finding. Bảng finding ở §6 giữ số thứ tự của rev 1 và ghi trạng thái hiện tại của từng finding; finding mới đánh số từ 12.
>
> Môi trường kiểm rev 2: Redis scratch Docker (`ea-redis` + `ea-srh`, `http://localhost:8079`, token `local`, bị `FLUSHDB` bởi các suite), ứng dụng **đã build** (`node dist/main`) chạy 5 lần với đủ env đặt tường minh (`KV_REST_API_URL=http://localhost:8079` in ra trước mỗi lần), Zalo giả (cổng 9911, ghi lại body, từ chối riêng `chat-bad` bằng HTTP 400), CoinGecko **thật** (keyless, dùng dè sẻn) cho các lượt chạy chính, và một CoinGecko giả (cổng 9912) chỉ để ép các tình huống thật khó có: giá `0`, `market_chart` trả 429 / 404. Postgres **cố ý không với tới được** (`POSTGRES_URL=postgres://u:p@127.0.0.1:1/db`). Mọi tiến trình do verifier khởi động đã dừng khi xong (kiểm lại bằng `Get-NetTCPConnection`: không còn cổng 3100, 9911, 9912).

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 17/18 AC pass, 0 fail, 1 untested (`EPIC-004-AC04`, phần "≤ 30 phút"). Ngoài bảng AC: NFR01, NFR02, NFR04, ngân sách lệnh Upstash và Lua trên Upstash thật chưa kiểm được trước deploy (§2.1).

> Trước đó (rev 1): fail, 16/18 pass, 1 fail (AC10), 1 untested (AC04).

AC10 đã đóng: `/tinhieu eth` cho coin không mạnh nay in vị trí trong khoảng 7 ngày (live, CoinGecko thật). Mọi quy tắc đúng với số của spec ở cả hai nhánh biên; luồng chạy thật qua ứng dụng đã build, Redis thật và Zalo giả cho đúng kết quả, kể cả chạy trùng, tắt/bật qua khởi động lại, chat bị Zalo từ chối, nguồn giá lỗi và giám sát (down / recovered / chưa từng khoẻ thì im). Verdict vẫn là fail **chỉ vì** AC04 (và các NFR kèm theo) không kiểm được trước deploy. Verifier tìm thêm hai điểm mới đáng đọc: giá `0` vẫn bị **lưu** vào lịch sử và làm sai khoảng 7 ngày (§6 #12), và khi `market_chart` bị 429 thì `/tinhieu <coin mới>` nói "chưa đủ dữ liệu" thay vì "tạm thời bận" (§6 #13).

## 2. Acceptance criteria

Mọi lệnh dưới đây do verifier tự chạy ngày 2026-10-07 trên HEAD `d48dd75`:
- `unit` = `npx jest`: **33/33 suite, 485/485 pass**.
- `e2e` = `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand`: **3 suite pass, 1 skip (Postgres opt-in); 84 pass, 18 skip, 0 fail**. Suite `signals.redis` chạy trên Redis thật (Lua thật).
- `probe` = script ts-node (`--transpile-only --project tsconfig.json`) gọi thẳng `evaluateSignal`, `selectCoinsToAlert`, `runBacktest`, `scoreRecords`, formatter và `CommandParserService` với đúng số của spec và đầu vào dị biệt.
- `live` = ứng dụng đã build chạy thật (`/cron/signals`, `/webhook`, `/cron/price-alerts-watch`) + Redis scratch + Zalo giả + CoinGecko thật (hoặc CoinGecko giả khi nói rõ). Riêng để ép có tín hiệu mạnh trên dữ liệu thật, verifier **hạ ngưỡng** `SIGNAL_SWING_24H_PCT=0.01`, `SIGNAL_SWING_72H_PCT=0.02` trong đúng hai lần chạy (ghi rõ bên dưới); các lần còn lại dùng ngưỡng mặc định 8%/15%.
- Bản tin 9h **không** chạy live ở rev 2 (cần Postgres cho `listActive()`, cố ý không có): AC08, AC09 dựa trên unit test `src/digest` do verifier chạy và formatter in ra thật.

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-004-AC01` | 100.000→84.000 mạnh; +7,5%/+11,1% không mạnh; 72h đúng 15% mạnh | pass | probe: `100000->84000` → `strong:true, v:buy, c24:-16.00`; `+7.5%/24h +11.1%/72h` → `strong:false, c24:7.53, c72:11.11`; `boundary 72h 100000->115000` → `strong:true, c24:2.68, c72:15.00, win:72h`. Biên thêm: đúng +8,00%/24h → `strong:true`; 7,99% → `strong:false`; đúng −8,00% → `strong:true`; đúng +15%/72h với 24h = 0% → `strong:true, win:72h`. |
| `EPIC-004-AC02` | Khoảng 80k–120k: 84k mua, 116k bán, 100k theo dõi, đúng 90k mua | pass | probe (ngưỡng 24h hạ về 0 để cô lập vùng 25%): `84000` → `buy, pos 10.0`; `116000` → `sell, pos 90.0`; `100000` → `watch, pos 50.0`; `90000` → `buy, pos 25.0`; `89999.99` → `buy`; `110000` (75%) → `sell`. Với ngưỡng thật: 84000 → `buy`, 116000 → `sell`, 100000 → `strong:false`. |
| `EPIC-004-AC03` | ETH +3%/24h, +5%/72h: không nhận định, không tin chủ động | pass | probe: `eth 24h=3%, 72h=5%` → `strong:false, v:null` (c24 3,00; c72 5,10). live (ngưỡng mặc định, CoinGecko thật, coin không mạnh): hai lượt `/cron/signals` → `"chatsAlerted":0`, Zalo giả không nhận tin nào. unit `√ AC03: sends nothing when no coin swings strongly` nằm trong 485 test. |
| `EPIC-004-AC04` | Chat đăng ký, BTC mạnh, chưa nhận tin 60 phút → đúng một tin có coin, nhận định, lý do, miễn trừ, **trong ≤ 30 phút** | untested | Phần nội dung pass: live (ngưỡng hạ) lượt 1 gửi cho `chat-v` đúng một tin `📡 Tín hiệu: có coin dao động mạnh / 🔻 BTC: -2.6% (24h) · -2.3% (72h) — 🟢 Cân nhắc mua / Lý do: -2.6% trong 24 giờ; giá $83,400.00 nằm gần đáy khoảng 7 ngày (12%, khoảng $82,952.17–$86,789.89). / 🔻 ETH … / ⚠️ Chỉ là thông tin tham khảo … / Tắt tin này: /tinhieu tat`. Phần "≤ 30 phút kể từ khi vượt ngưỡng" phụ thuộc lịch cron-job.org 30 phút và chỉ quan sát được trên production. **Cách đóng:** sau khi tạo job, đọc log `signals-run` của vài lượt và đo thời gian từ lúc coin vượt ngưỡng tới lúc tin đến (plan §5, bước 10). |
| `EPIC-004-AC05` | 10:00 gửi; 10:20, 10:50 không; 11:00 gửi ETH; chạy trùng cùng phút không tin thứ hai | pass | probe `selectCoinsToAlert` (BTC báo 10:00): `10:20 eth` → `[]`, `10:50 eth` → `[]`, `10:59:59 eth` → `[]`, `11:00 eth` → `["eth"]`. live (ngưỡng hạ): hai lần `/cron/signals` liền nhau → `"chatsAlerted":2` rồi `"chatsAlerted":0`, `durationMs` 549 → 19. |
| `EPIC-004-AC06` | BTC, ETH, SOL cùng mạnh → một tin chứa cả ba | pass | live (ngưỡng hạ): `chat-v` (BTC+ETH) nhận **một** tin chứa cả hai; ba coin: unit `√ AC06: puts BTC, ETH and SOL in a single message` (trong 485 test). |
| `EPIC-004-AC07` | BTC báo −16% lúc 10:00; 15:00 −18% không; −21% có; đổi chiều +9% có ngay; sau 24h báo lại | pass | probe (BTC đã báo −16% lúc 10:00, hết cooldown): `15:00 btc -18` → `[]`, `15:00 btc -21` → `["btc"]`, `-20.999` → `[]`, `15:00 btc +9 flip` → `["btc"]`, `+24h btc -16` → `["btc"]`, `+23:59 btc -16` → `[]`. |
| `EPIC-004-AC08` | Bản tin 9h: phần "Tín hiệu" với BTC và nhận định; không mạnh → một dòng; chat chưa đăng ký không có bản tin | pass | unit `src/digest` (chạy lại, 74/74 pass cùng `signals.service`, `format-signals`, `coingecko`): `√ AC08: adds the "Tín hiệu" part with the verdict for a strong coin, after the prices`, `√ AC08: says "Không có coin nào dao động mạnh" in one line when nothing swings`, `√ a chat that is not subscribed gets no digest and no signals (AC08)`. Formatter in ra: `📡 Tín hiệu: Không có coin nào dao động mạnh.` (danh sách rỗng) và `📡 Tín hiệu: Không có coin nào dao động mạnh (chưa đủ dữ liệu: NEW).` (một dòng, không còn dòng thứ hai). Chưa chạy live (xem trên). |
| `EPIC-004-AC09` | Tính tín hiệu lỗi → phần giá vẫn gửi, chat khác không bị ảnh hưởng, có log lỗi | pass | unit: `√ AC09: when signals cannot be computed the prices still go out, without the part`, `√ AC09: a failure while building one chat part never touches another chat`. Chưa chạy live. |
| `EPIC-004-AC10` | `/tinhieu eth` trả: 24h, 72h, vị trí trong khoảng 7 ngày, mạnh hay không, nhận định, lý do, miễn trừ; `xyzabc` → thông báo của `/gia`; nguồn giá lỗi → thông báo tạm thời, không số | pass | live, ngưỡng mặc định, CoinGecko thật, ETH không mạnh: `📡 Tín hiệu hiện tại: / ➖ ETH: $2,564.95 · -4.9% (24h) · -5.1% (72h) · ở 1% khoảng 7 ngày ($2,562.28–$2,754.29) — không dao động mạnh, không có nhận định.` (rev 1 thiếu đúng phần "ở 1% khoảng 7 ngày"). live, ngưỡng hạ, ETH mạnh: `🔻 ETH: -4.9% (24h) · -5.1% (72h) — 🟢 Cân nhắc mua / Lý do: -5.1% trong 72 giờ; giá $2,565.24 nằm gần đáy khoảng 7 ngày (2%, khoảng $2,562.28–$2,754.29). / ⚠️ Chỉ là thông tin tham khảo …`. `/tinhieu xyzabc` → `⚠️ Không tìm thấy đồng coin: XYZABC. Vui lòng kiểm tra lại mã coin.` Nguồn giá lỗi: live với `COINGECKO_API_BASE_URL=http://127.0.0.1:1` → `/tinhieu eth` = `⚠️ Không thể lấy dữ liệu giá lúc này (dịch vụ CoinGecko đang bận hoặc quá giới hạn). Vui lòng thử lại sau ít phút.`, không có số nào; cũng gặp 429 thật của CoinGecko trong lúc chạy và cùng thông báo đó. |
| `EPIC-004-AC11` | Coin có 5 ngày lịch sử → "chưa đủ dữ liệu", không nhận định | pass | probe: lịch sử 5 ngày → `insuff:true, v:null`; `empty history` → `insuff:true`. Formatter: `⏳ DEAD: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.`; live (CoinGecko giả, `market_chart` 404/429): `/tinhieu ada` → `⏳ ADA: chưa đủ dữ liệu …`. e2e `√ AC11 …` pass trong lượt 84/18. |
| `EPIC-004-AC12` | 90 ngày, 6 mua đúng 4 (66,7%), 5 bán đúng 2 (40%), ghi chú xấp xỉ, miễn trừ; dưới 14 ngày từ chối | pass | probe, chuỗi 90 ngày tự dựng (11 sự kiện cách nhau 7 ngày, hồi phục ±1%/ngày): `{"insufficient":false,"days":90,"buy":{"scored":6,"correct":4},"sell":{"scored":5,"correct":2}}`; trả lời in `• Cân nhắc mua: 6 lần, đúng 4 (66.7%) / • Cân nhắc bán: 5 lần, đúng 2 (40.0%) / ℹ️ Chỉ là xấp xỉ: backtest dùng giá cuối ngày …`, có `⚠️ Chỉ là thông tin tham khảo …`. 13 ngày → `⏳ Chưa đủ lịch sử để backtest BTC: có 13 ngày, cần ít nhất 14 ngày.`; 14 ngày chạy được. Số thập phân in `66.7%` (dấu chấm, cùng kiểu mọi tin khác của bot), spec viết `66,7%`: chỉ khác cách viết. |
| `EPIC-004-AC13` | Mua BTC ở 84.000; 3 ngày sau 90.000 → đúng; 80.000 → sai; trước 3 ngày → chờ chấm; `thongke` khớp; cùng nhận định-coin-ngày tính một lần | pass | probe `scoreRecords`: `90000 after 3d` → `buy {scored:1, correct:1}`; `80000 after 3d` → `correct:0`; bằng giá 84000 → `correct:0`; `pending <3d` → `pending:1`; hai nhận định cùng ngày → `scored:1`. live: `/tinhieu thongke` ở `chat-v` sau khi nhận tin chủ động → `• Còn chờ chấm: 2 (chưa đủ 3 ngày)`; `chat-r` (chưa có nhận định) → `📭 Chưa có nhận định nào trong 30 ngày qua để chấm điểm.` |
| `EPIC-004-AC14` | `tat` xác nhận, không nhận tin chủ động, bản tin vẫn có phần Tín hiệu, watchlist không đổi; `bat` bật lại; còn nguyên sau khởi động lại | pass | live (ngưỡng hạ): `/tinhieu tat` → `🔕 Đã tắt tin tín hiệu chủ động. Phần "Tín hiệu" trong bản tin 9h sáng vẫn còn. Bật lại: /tinhieu bat`; `SMEMBERS signals:off` → `["chat-v"]`; xoá trạng thái đã gửi rồi `/cron/signals` → 0 tin cho `chat-v`; **dừng và khởi động lại ứng dụng**, xoá trạng thái, chạy lại → vẫn 0 tin cho `chat-v`, còn `chat-d`, `chat-bad` vẫn nhận; `/tinhieu bat` → `🔔 Đã bật tin tín hiệu chủ động …`; lượt sau gửi lại cho `chat-v`. Bản tin vẫn có phần Tín hiệu và watchlist không đổi: lệnh chỉ chạm tập `signals:off` (xem webhook `SIGNAL_TOGGLE`), `DigestController` không đọc tập đó. |
| `EPIC-004-AC15` | Nguồn giá lỗi → không gửi, log một dòng lượt lỗi, lượt sau bình thường; một chat gửi lỗi, chat khác vẫn nhận | pass | live, CoinGecko chết (`http://127.0.0.1:1`): `"event":"signals-run",…,"outcome":"failed","coins":3,"chatsAlerted":0` và 0 tin tới Zalo giả; cũng gặp 429 thật của CoinGecko: log `Signals lookup failed, skipping this run` hai lần liên tiếp rồi hồi phục. Lượt kế (nguồn sống lại) `"outcome":"healthy"`. Chat lỗi: `chat-bad` bị Zalo giả từ chối 400 → `"outcome":"healthy","chatsAlerted":2,"failures":1`; `chat-v`, `chat-d` đều nhận tin; `signals:rec:chat-bad` không tồn tại, và `chat-bad` vẫn đủ điều kiện ở lượt sau (xem §6 #8). |
| `EPIC-004-AC16` | 50 chat, 30 coin khác nhau → nguồn giá ≤ 2 lần, Postgres không bị truy vấn | pass | unit `√ AC16: prices 30 coins for 50 chats with at most two price lookups`. live: mọi lượt `/cron/signals` chạy xong với `POSTGRES_URL` trỏ `127.0.0.1:1`; `grep -c Neon` trên log ứng dụng của 5 lần chạy → `0` (lỗi `NeonDbError` chỉ xuất hiện ở `/tinhieu` không tham số, là lệnh người dùng, ghi nhận là thông báo lỗi chung thân thiện). Số lệnh giá: lượt cron đầu với CoinGecko thật gọi 1 lệnh giá cho 3 coin; lượt thứ hai dùng bộ nhớ đệm. Lấp lịch sử gọi thêm `market_chart` (§6 #4). |
| `EPIC-004-AC17` | Dùng `/tinhieu` hoặc nhận tin được ghi; đếm được chat ngoài owner dùng lại sau ngày đầu; log không chứa nhận định | pass | live: `HKEYS signals:use:2026-10-07` → `["chat-q\|command","12345678901234567890\|command","1e3\|command","007\|command","a\|b\|command"]` (kèm `\|alert` cho chat nhận tin). Đã đọc `scripts/signals-report.lib.js`: tách bằng `lastIndexOf('\|')`, nên chat id có `\|` vẫn đúng. Log: `grep -ciE "cân nhắc\|theo dõi:\|verdict\|buy\|sell\|-2\.6\|83400"` trên log ứng dụng của 5 lần chạy → `0` mỗi lần; log `signals-run` chỉ có số đếm. `report-lib.spec.ts` pass trong 485 test. |
| `EPIC-004-AC18` | `/help` liệt kê `/tinhieu` kèm ví dụ; `docs/API.md` có lệnh | pass | `src/utils/format-message.util.ts` dòng 128–129: `• /tinhieu — … · /tinhieu eth — một coin` và `• /tinhieu backtest btc — … · /tinhieu thongke — … · /tinhieu tat (hoặc bat) — …`; `docs/API.md` dòng 109–113 có `/tinhieu`, `eth`, `backtest btc`, `thongke`, `tat`/`bat`; `.env.example` có `SIGNALS_CRON_SECRET`, `SIGNAL_SWING_24H_PCT`, `SIGNAL_SWING_72H_PCT`, `SIGNAL_BAND_PCT`. |

### 2.1 NFR kiểm được hoặc không kiểm được

| Id | Verdict | Evidence |
|---|---|---|
| `NFR01` ≤ 30 phút | untested | Chỉ quan sát được sau khi có job cron-job.org. Xem AC04 và §6 #3. |
| `NFR02` ≤ 5 giây p95 | untested | Cục bộ: `durationMs` của lượt cron 3 coin 549 ms (lần đầu, có lấp lịch sử), 16–83 ms sau đó; mọi lệnh `/tinhieu` trả lời dưới vài giây (gồm cả khi CoinGecko thật). Không phải p95 trên production với Upstash thật. |
| `NFR03` quota nguồn giá | pass (kèm lưu ý) | Một lượt cron = 1 lệnh giá cho mọi coin (CoinGecko thật: một lượt = 1 lệnh `simple/price` cho cả 3 coin). Lưu ý lấp lịch sử §6 #4 (đã gặp 429 thật). |
| `NFR04` lưu trữ | untested | Cục bộ `ZCARD signals:day:btc` = 90, `signals:hour:btc` = 192; dung lượng và trần của Upstash thật chưa đo. |
| `NFR05` không truy vấn Postgres mỗi lượt | pass | Xem AC16. |
| `NFR06` không quá 1 tin/60 phút | pass | Xem AC05: lượt thứ hai ngay sau → 0 tin. |
| `NFR07` log ghi cả lỗi; giám sát | pass | Log `signals-run` có `outcome` `failed`/`healthy`, `failures`, `chatsAlerted`, `durationMs`. Giám sát live qua `/cron/price-alerts-watch` (secret `PRICE_ALERTS_WATCH_SECRET`, `OWNER_CHAT_ID=owner-1`): `signals:last-healthy` mới → 0 tin; đặt về 100 phút trước (`SET`) → **đúng 1 tin** `⚠️ Tín hiệu: lượt kiểm tra ngừng chạy. / Không có lượt chạy tốt nào từ 22:08 07/10 (ICT), đã 1 giờ 40 phút. / Gợi ý: lượt gần nhất bị lỗi (thường là nguồn giá hoặc Redis) …`; gọi lại → 0 tin; chạy một lượt khoẻ rồi gọi watcher → **đúng 1 tin** `✅ Tín hiệu: lượt kiểm tra đã chạy lại. … Gián đoạn khoảng 1 giờ 40 phút.`; gọi lại → 0 tin; xoá `last-healthy` và `outage` (chưa từng khoẻ) → 0 tin. |
| `NFR08` xác định, kèm số | pass | probe: cùng dữ liệu luôn cùng kết quả; mọi nhận định in kèm % và vị trí. |
| `NFR09` giới hạn input | pass | live: chat id số rất dài `12345678901234567890`, `1e3`, `007`, `a|b` đều giữ nguyên là chuỗi (`SMEMBERS signals:off` → `["12345678901234567890","1e3","007","a|b"]`, không bị Redis/driver đổi thành số). Parser: ký hiệu 21 ký tự → `SIGNAL_INVALID`, 20 ký tự → `SIGNAL_VIEW`. Redis thật (e2e): `√ drops records older than 90 days and caps a chat at 1000`. Giới hạn `chat.id` 64 ký tự do rev 1 đã kiểm live (không đổi mã; e2e/unit vẫn xanh). |
| `NFR10` riêng tư, log | pass | AC17; `scorecard(chatId)` chỉ đọc `signals:rec:<chatId>` (live: `chat-r` không thấy nhận định của `chat-v`). |
| `NFR11` giới hạn tần suất lệnh | pass | live: sáu lệnh webhook liên tiếp của một chat trong 10 giây → lệnh thứ sáu `[429]` (`THROTTLE_LIMIT=5`). |

## 3. Promised proofs

| Proof (plan §5, §6) | Executed | Result |
|---|---|---|
| `npx jest src/signals/...`, `src/digest`, `src/utils`, `scripts`, `src/price-alerts` | Có, trong `npx jest` đầy đủ | 33/33 suite, 485/485 |
| `npm run test:e2e` (webhook, AC10–AC14) | Có, `--runInBand` | 84 pass / 18 skip (Postgres) |
| `test/signals.redis.e2e-spec.ts` trên Redis thật (Lua, khoá chạy, tắt/bật sau khi tạo lại service) | Có | PASS trong lượt e2e trên. Ghi chú: code dùng `HSETNX` trên hash, plan nói `ZADD NX`; nay đã ghi ở `implement.md` §7 |
| Instance chạy tay: `curl /cron/signals` + webhook giả | Có | §2, live |
| Backtest thật BTC/ETH/SOL (AC12, rủi ro "chất lượng nhận định") | Có (CoinGecko thật), ngưỡng mặc định | BTC mua 0/0, bán 0/1; SOL mua 0/0, bán 1/3 (`runBacktest` trên giá cuối ngày); qua `/tinhieu backtest btc` trong ứng dụng: `Cân nhắc mua: chưa có lần nào đủ 3 ngày để chấm`, `Cân nhắc bán: 1 lần, đúng 0 (0.0%)`. ETH chạy lại ở rev 1, không chạy lại ở rev 2 |
| `npm run signals:report` trên Redis scratch | Không chạy lại ở rev 2 | rev 1 đã chạy; code script không đổi từ đó (`git diff e5c966f..HEAD --stat` không chứa `scripts/`) |
| NFR07 giám sát (hold/phục hồi) | Có, live | §2.1 |
| NFR01, NFR02, ngân sách Upstash, NFR04, Lua trên Upstash thật (plan bước 10) | **Không**: chỉ làm được sau deploy, plan đã nói trước | untested |

## 4. Regressions

```
$ npx jest
Test Suites: 33 passed, 33 total
Tests:       485 passed, 485 total
EXIT 0

$ npx tsc --noEmit            -> EXIT 0
$ npm run build               -> EXIT 0
$ npx eslint src/signals src/utils src/digest src/webhook src/command-parser src/coingecko src/config test/signals.redis.e2e-spec.ts test/webhook.e2e-spec.ts
                              -> EXIT 0, không có dòng nào

$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand
Test Suites: 1 skipped, 3 passed, 3 of 4 total
Tests:       18 skipped, 84 passed, 102 total
EXIT 0
```

Cảnh báo giá cũ không đổi hành vi: `git diff e5c966f..HEAD` (vòng sửa) không chạm `src/price-alerts`; toàn bộ spec cảnh báo giá vẫn xanh trong 485 test. Hai suite Redis e2e (`price-alerts.redis`, `signals.redis`) cùng `flushdb` một DB nên **bắt buộc `--runInBand`** (đã ghi trong header test; CI không ảnh hưởng vì cả hai tự bỏ qua khi không có URL).

Vòng sửa d48dd75 chỉ đụng 12 tệp (`git diff e5c966f..HEAD --stat`): `coingecko.service.ts`, `digest.controller.ts`, `signal-evaluator.ts`, `signals.service.ts`, `format-signals.util.ts` cùng spec tương ứng và hai tài liệu epic. Không có tệp ngoài phạm vi epic.

## 5. Out-of-scope check

Không có gì trong `Out of scope` bị ship.
- Chỉ báo kỹ thuật (RSI, MACD, nến, học máy): không có trong `src/signals` (nguyên văn quy tắc chỉ là biến động % và vị trí trong khoảng 7 ngày, `signal-evaluator.ts`).
- Không có kênh khác ngoài Zalo.
- Không có bảng Postgres hay migration; ứng dụng chạy suốt cả rev 2 với Postgres không với tới được mà luồng cron/tín hiệu không bị ảnh hưởng.
- Ngưỡng là cấu hình chung (`SIGNAL_SWING_*`, `SIGNAL_BAND_PCT`), không có ngưỡng theo chat.
- Không có gói trả phí, không liên kết với danh mục, backtest chỉ chấm đúng/sai hướng, không mô phỏng lãi/lỗ.
- "Deliberately not doing" của plan §7: không dùng Postgres; luật `/canhbao` không đổi; không có cron chấm điểm riêng (chấm khi đọc: `scorecard` tính khi gọi); không chạm `vercel.json` (`git diff` vòng sửa không có).

## 6. Findings

Đối chiếu `implement.md` (đọc sau cùng). **Khớp** với lượt chạy của verifier: `485 test` (§7), AC10 sửa, "429 ra thông báo tạm thời / 404 mới ra chưa đủ lịch sử" (tái hiện live ở #7), "chỉ một dòng ở bản tin" (#9), backtest ngưỡng mặc định BTC `0/0, 0/1` và SOL `0/0, 1/3` (#2), "BTC có biến động ngày lớn nhất 8,0%" (probe của verifier cũng in `maxDailyMove=8.0%`). **Chưa kiểm lại**: số liệu ETH/XRP/DOGE ở §5 của `implement.md` (verifier chạy lại BTC và SOL, đủ hai coin theo yêu cầu). **Không khớp**: các con số cũ ở §1 và §3 (xem #14).

### 6.1 Trạng thái các finding của rev 1

| # | Finding (rev 1) | Severity | Trạng thái rev 2 | Evidence rev 2 |
|---|---|---|---|---|
| 1 | AC10: coin không mạnh thiếu vị trí trong khoảng 7 ngày | Medium | **Fixed** | live: `➖ ETH: $2,564.95 · -4.9% (24h) · -5.1% (72h) · ở 1% khoảng 7 ngày ($2,562.28–$2,754.29) — không dao động mạnh, không có nhận định.` (`formatSignalLine`, `src/utils/format-signals.util.ts:125-131`). |
| 2 | Con số chất lượng trong `implement.md` dựa trên ngưỡng không phải của spec | Medium (thông tin quyết định) | **Fixed** (tài liệu) | `implement.md` §3.2 và §6 nay nói rõ ngưỡng hạ và đưa bảng ngưỡng 8%/15%; verifier chạy lại: BTC `buy=0/0 sell=0/1`, SOL `buy=0/0 sell=1/3`, khớp. Hệ quả cho owner vẫn nguyên: với coin lớn quy tắc gần như không bao giờ nổ, cỡ mẫu 0–3 không đánh giá được chất lượng, cần quyết ngưỡng trước khi báo người dùng ngoài owner. |
| 3 | Vòng phản hồi không phủ AC04 ≤ 30 phút, NFR01, NFR02, NFR04, ngân sách Upstash, Lua trên Upstash thật | Medium (vòng phản hồi) | **Still open**, ghi trung thực ở `implement.md` §7 | §2.1; chỉ đóng được sau deploy. |
| 4 | Lấp lịch sử thêm lệnh `market_chart`, dễ chạm giới hạn tốc độ keyless của CoinGecko | Low–Medium | **Still open**, ghi ở `implement.md` §7 (plan §1 đã chấp nhận) | **Bằng chứng mới, mạnh hơn rev 1:** sau chỉ khoảng 4 lệnh CoinGecko thật (1 giá + 3 `market_chart` ở lượt cron đầu) và vài lệnh `/tinhieu`, các lượt cron kế tiếp bị 429 (`CoinGecko simple/price call failed: Request failed with status code 429`, outcome `failed`) và `/tinhieu eth` trả thông báo "đang bận"; phải đợi khoảng một phút mới hết. `implement.md` §3.1 "5 coin liên tiếp không chạm giới hạn" không phải cơ sở an toàn cho ngày đầu có nhiều coin mới. Hệ quả: một chuỗi lượt `failed` quá 90 phút sẽ làm watcher báo owner. |
| 5 | Tin đầu tiên của chat nhiều coin mới chỉ chứa các coin đã lấp xong | Low | **Still open**, ghi ở `implement.md` §7, không đo lại ở rev 2 | Mã không đổi. |
| 6 | Giá hiện tại bằng 0 cho ra "Cân nhắc mua −100%" | Low | **Fixed ở `evaluateSignal`; còn hổng ở chỗ lưu** (xem #12) | probe: `now=0`, `NaN`, `-5`, `Infinity` → đều `insuff:true, v:null`. Giá dương rất nhỏ (`1e-12` so với 100) vẫn ra `-100%` mua, chấp nhận được vì là giá hợp lệ về mặt số học. |
| 7 | 429 của `market_chart` báo "chưa đủ lịch sử, có 0 ngày" | Low | **Fixed**, tái hiện cả hai nhánh | live với CoinGecko giả: `/tinhieu backtest ada` (chart 429) → `⚠️ Không thể lấy dữ liệu giá lúc này (dịch vụ CoinGecko đang bận hoặc quá giới hạn)…`; `/tinhieu backtest bnb` (chart 404) → `⏳ Chưa đủ lịch sử để backtest BNB: có 0 ngày, cần ít nhất 14 ngày.`. Mã: `CoingeckoCoinNotFoundError` chỉ cho 404 (`coingecko.service.ts:166-169`), `chartPoints` chỉ nuốt lỗi đó (`signals.service.ts:164-171`); unit `√ backtest surfaces a rate limit instead of reporting 0 days`, `√ does not report a 429 as an unknown coin`. |
| 8 | Chat chặn bot bị gửi lại ở mọi lượt, mãi mãi | Low | **Still open**, ghi ở `implement.md` §7 | live: `chat-bad` (Zalo giả trả 400) bị thử lại mỗi lượt: log `Failed to send Zalo message to chat chat-bad: Request failed with status code 400` hai lượt liền, `failures:1` mỗi lượt, lượt vẫn `healthy`. |
| 9 | Bản tin có thêm dòng "Chưa đủ dữ liệu" bên cạnh dòng "Không có coin nào…"; và nói "không có coin nào mạnh" khi coin không có giá | Low | **Fixed** | formatter: `📡 Tín hiệu: Không có coin nào dao động mạnh (chưa đủ dữ liệu: NEW).` (một dòng); unit `√ has no signals part for a chat none of whose coins were priced (verify finding 9)`, `√ AC08: says "Không có coin nào dao động mạnh" in one line when nothing swings`. Mã: `digest.controller.ts` trả `{ shown }` không có `section` khi không coin nào có giá. |
| 10 | Tài liệu: `HSETNX` thay `ZADD NX` không được ghi | Low (docs) | **Fixed** (tài liệu) | `implement.md` §7 dòng "10". `plan.md` §2, §5 vẫn ghi `ZADD NX` (plan là hợp đồng đã duyệt, không sửa là đúng). |
| 11 | `/tinhieu bat` là công tắc, không phải coin BAT; `/tinhieu tatt` gõ nhầm bị hiểu là coin | Low | **Still open**, ghi ở `implement.md` §7 | parser: `/tinhieu tatt` → `SIGNAL_VIEW symbols:["tatt"]`; live trả `⚠️ Không tìm thấy đồng coin: TATT. …` (không gợi ý cú pháp). Chấp nhận được. |

### 6.2 Finding mới của rev 2

| # | Finding | Severity | Where |
|---|---|---|---|
| 12 | **Giá `0` (hoặc rác) vẫn được lưu vào lịch sử và làm sai khoảng 7 ngày.** Bản sửa #6 chỉ chặn ở `evaluateSignal`. `evaluateWithPrices` vẫn gọi `history.snapshot` với giá `0`. Reproduce live: CoinGecko giả trả `usd: 0` cho `dogecoin` → `ZRANGE signals:hour:doge` kết thúc bằng `…,"1791391685120:0"` và `ZCARD signals:day:doge` = 90 gồm điểm 0. Hệ quả (probe): lịch sử có một điểm `0` trong 7 ngày + coin giảm 20% → `{"strong":true,"v":"sell","c24":"-20.00","pos":"80.0"}`, tức **"Cân nhắc bán / chốt lời" cho một coin đang rơi**, kéo dài đến 8 ngày (và điểm `0` trong lịch sử ngày còn làm sai backtest tới 90 ngày). Điểm `NaN` trong lịch sử cho `v:"watch", pos 50` thay vì bỏ qua. Cần giá lỗi từ nguồn nên khó xảy ra, nhưng đúng là loại lỗi AC/finding #6 muốn chặn. Sửa: lọc giá không hữu hạn hoặc ≤ 0 trước `snapshot` (và/hoặc bỏ điểm ≤ 0 khi tính khoảng) kèm test | Low–Medium | `src/signals/signals.service.ts` `evaluateWithPrices` (lọc `priced`), `signals-history.service.ts` `snapshot`, `signal-evaluator.ts` (`rangePrices`) |
| 13 | **Khi `market_chart` bị 429, `/tinhieu <coin mới>` nói "chưa đủ dữ liệu (cần 7 ngày)" như thể coin quá mới.** Live (CoinGecko giả, chart `cardano` = 429): `/tinhieu ada` → `⏳ ADA: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.`; key `signals:bf-fail:ada` giữ coin 2 giờ nên cùng thông báo lặp lại tới khi hết hold. Khác với `/tinhieu backtest`, nơi 429 đã được báo đúng ("đang bận"). Không có số sai nên không vi phạm AC10/AC11, nhưng người dùng có thể hiểu nhầm lý do trong lúc CoinGecko quá giới hạn (và #4 cho thấy giới hạn này dễ gặp) | Low | `signals-history.service.ts` `backfill` (nuốt lỗi, đặt `bf-fail`), `signals.service.ts` `evaluateWithPrices` (`.catch` trả `[]`) |
| 14 | **`implement.md` còn hai chỗ chưa theo vòng sửa:** §3 bảng "Toàn bộ" ghi `Tests: 476 passed` (hiện 485, §7 đã ghi đúng), và §1 ghi "13 commit … 63 tệp" (nay nhiều hơn). Ngoài ra §3.1 kết luận "không chạm giới hạn tốc độ ở 5 coin/lượt" mâu thuẫn với bằng chứng ở #4 | Low (docs) | `docs/epics/EPIC-004/artifacts/implement.md` §1, §3, §3.1 |

## 7. Shortest path to pass

**Mã không còn dòng `fail` nào.** Verdict tổng là fail chỉ vì một dòng `untested`. Tách đôi:

Có thể làm ngay trong code (không chặn verdict, nên làm trước khi báo người dùng ngoài owner):
1. **#12:** lọc giá ≤ 0/không hữu hạn khỏi `snapshot` (và test), để bản sửa #6 đi hết đường.
2. **#13** (tuỳ chọn): phân biệt "đang bị giới hạn tốc độ" với "coin mới" trong câu trả lời `/tinhieu <coin>` khi lấp lịch sử thất bại.
3. **#14:** sửa các con số cũ ở `implement.md` §1, §3, §3.1 cho khớp (485 test; bỏ ý "không chạm giới hạn tốc độ").

Chỉ làm được sau deploy (đây mới là thứ lật dòng `untested`):
4. **AC04 (phần ≤ 30 phút):** owner deploy và tạo job cron-job.org mỗi 30 phút; chạy tay `/cron/signals` một lần trên Upstash thật (kiểm Lua), đọc log `signals-run` của vài lượt, đo từ lúc coin vượt ngưỡng tới lúc tin đến, chạy `npm run signals:report`; ghi vào file này. Cùng lượt quan sát đó đóng NFR01, NFR02 (p95 thời gian lệnh trong log), NFR04 và ngân sách lệnh Upstash (dashboard sau 48 giờ). Nên canh số lệnh `market_chart` của ngày đầu (#4) và quyết ngưỡng với owner (#2).

**Verdict tổng: FAIL — 17 pass, 0 fail, 1 untested (AC04, chờ production); NFR01, NFR02, NFR04, ngân sách Upstash và Lua trên Upstash thật chưa kiểm được trước deploy.**
