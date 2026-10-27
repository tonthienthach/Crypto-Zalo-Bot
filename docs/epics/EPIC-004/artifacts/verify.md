# Verification Report — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Verifier:** Verifier (independent)
**Status:** Draft (revision 3)
**Created:** `2026-10-27`
**Verified against:** `spec.md`, `plan.md`

---

> **Revision 3** (2026-10-27): kiểm lại **toàn bộ** epic trên HEAD `efdeb02` của `feature/epic-004-simple-signals` bằng một verifier mới, không dựa vào kết luận của rev 1, rev 2 hay của engineer. Checklist lập từ `spec.md` §6 (AC01–AC18, FR/NFR), `plan.md` §5 và §7 và phần Out of scope **trước** khi mở `implement.md`; `implement.md` chỉ đọc sau cùng để đối chiếu (§6). Cây làm việc có các thay đổi không liên quan (EPIC-003, `.gitignore`, `.claude/CLAUDE.md`, `.aidlc/runs/*`, `docs/epics/EPIC-004/state.json`), verifier không đụng tới; chỉ ghi tệp này. Không commit, không gọi production.
>
> **Rev 2** (2026-10-07, HEAD `d48dd75`): fail, 17/18 AC pass, 1 untested (`EPIC-004-AC04`, phần "≤ 30 phút"), cùng NFR01, NFR02, NFR04, ngân sách Upstash và Lua trên Upstash thật chưa kiểm được trước deploy; finding mới #12–#14.
>
> **Rev 1** (2026-10-07, HEAD `e5c966f`): fail, 16/18 AC pass, `EPIC-004-AC10` fail (coin không mạnh thiếu vị trí trong khoảng 7 ngày), `EPIC-004-AC04` untested, 11 finding. Bảng finding §6 giữ số thứ tự của rev 1 và rev 2 kèm trạng thái hiện tại; finding mới của rev 3 đánh số từ 15.
>
> Môi trường kiểm rev 3: Redis scratch Docker (`ea-redis` + `ea-srh`, `http://localhost:8079`, token `local`; suite và verifier `FLUSHDB` DB này, không DB nào khác), ứng dụng **đã build** (`node dist/main`, cổng 3121) khởi động 5 lần với đủ env đặt tường minh (dòng `KV_REST_API_URL=http://localhost:8079` in ra mỗi lần), Zalo giả (cổng 9921, ghi body, từ chối HTTP 400 theo từng chat id), **CoinGecko giả** (cổng 9922; trả 200 / 404 / 429 / 500 theo yêu cầu và đếm số lệnh `simple/price` và `market_chart`) cho mọi ca lỗi và ca đếm lệnh, và CoinGecko **thật** (keyless) chỉ 5 lệnh cho hai việc: backtest dữ liệu thật (2 coin) và một lượt `/tinhieu eth` + `/cron/signals` ở ngưỡng mặc định. `POSTGRES_URL=postgres://u:p@127.0.0.1:1/db` (cố ý không với tới được). Mọi tiến trình do verifier khởi động đã dừng (kiểm bằng `Get-NetTCPConnection`: cổng 3121, 9921, 9922 đều 0 kết nối), hai container Docker vẫn chạy. Ngưỡng mặc định 8%/15% được giữ ở **mọi** lượt chạy live; verifier không hạ `SIGNAL_SWING_*` lần nào (dùng giá giả để tạo ca mạnh).

## 1. Verdict

> *Một dòng. Có bất kỳ dòng `fail` hoặc `untested` nào bên dưới thì verdict tổng là fail.*

**Overall:** fail. 17/18 AC pass, 0 fail, 1 untested (`EPIC-004-AC04`, phần "≤ 30 phút"). Ngoài bảng AC: NFR01, NFR02, NFR04, ngân sách lệnh Upstash và Lua trên Upstash thật chưa kiểm được trước deploy (§2.1).

> Trước đó: rev 2 fail 17/18 (AC04 untested); rev 1 fail 16/18 (AC10 fail, AC04 untested).

Mã không còn dòng `fail`. Mọi quy tắc đúng với số của spec ở cả hai nhánh biên; luồng chạy thật qua ứng dụng đã build, Redis thật và Zalo giả cho đúng kết quả, kể cả bốn hành vi mới của `efdeb02` (lấp lịch sử tối đa 3 coin/lượt, 429 giữ 10 phút và dừng lượt, 404 giữ 2 giờ và đi tiếp, chat bị chặn thử 3 lượt rồi nghỉ 6 giờ, lỗi gõ từ khoá `/tinhieu`). Verdict vẫn là fail **chỉ vì** AC04 (và các NFR kèm theo) không kiểm được trước deploy. Verifier tìm thêm ba điểm nhỏ (§6.2, #15–#17): số liệu cũ trong `implement.md`, backoff 6 giờ cũng kích hoạt khi **Zalo** sập chứ không chỉ khi một chat chặn bot, và từ khoá `on`/`off`/`stats` che các mã coin cùng tên.

## 2. Acceptance criteria

Mọi lệnh dưới đây do verifier tự chạy ngày 2026-10-27 trên HEAD `efdeb02`:
- `unit` = `npx jest`: **33/33 suite, 500/500 pass**.
- `e2e` = `REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand`: **3 suite pass, 1 skip (Postgres opt-in); 84 pass, 18 skip, 0 fail**; suite `signals.redis` chạy Lua thật (17 ca).
- `probe` = script ts-node (`--transpile-only --project tsconfig.json`, tệp ở scratchpad) gọi thẳng `evaluateSignal`, `selectCoinsToAlert`, `recordFailed/isBackedOff`, `runBacktest`, `scoreRecords`, formatter, `CommandParserService` với đúng số của spec và đầu vào dị biệt.
- `live` = ứng dụng đã build chạy thật + Redis scratch + Zalo giả + CoinGecko giả (hoặc thật khi nói rõ), ngưỡng mặc định.
- Bản tin 9h **không** chạy live (cần Postgres cho `listActive()`, cố ý không có; lệnh `/tinhieu` không tham số cũng cần Postgres nên chỉ kiểm bằng unit/e2e): AC08, AC09 dựa trên unit test `src/digest` do verifier chạy lại (`npx jest src/digest src/signals/signals.controller --verbose`: 39/39 pass).

| Id | Criterion | Verdict | Evidence |
|---|---|---|---|
| `EPIC-004-AC01` | 100.000→84.000 mạnh; +7,5%/+11,1% không mạnh; 72h đúng 15% mạnh | pass | probe: `100000->84000` → `strong:true, v:buy, c24:-16.00`; `93000/90000 -> 100000` → `strong:false, c24:7.53, c72:11.11`; `100000->115000 (24h 112000)` → `strong:true, c24:2.68, c72:15.00, win:72h`. |
| `EPIC-004-AC02` | Khoảng 80k–120k: 84k mua, 116k bán, 100k theo dõi, đúng 90k mua | pass | probe (24h hạ nhẹ bằng đường đi giá để chắc chắn mạnh): `84000` → `buy, pos 10.0`; `116000` → `sell, pos 90.0`; `100000` → `watch, pos 50.0`; `90000` → `buy, pos 25.0`; `90000.0001` → `watch`; `110000` (75%) → `sell`; `110000.0001` → `sell`. |
| `EPIC-004-AC03` | ETH +3%/24h, +5%/72h: không nhận định, không tin chủ động | pass | probe: `eth 24h=3% 72h=5%` → `strong:false, v:null, c24 3.00, c72 5.00`. live với CoinGecko giả (ETH phẳng): lượt `/cron/signals` → `chatsAlerted` không gồm ETH; live CoinGecko **thật**, ngưỡng mặc định: `/cron/signals` cho chat `r1` (btc, eth) → `"outcome":"healthy","coins":2,"chatsAlerted":0` và Zalo giả không nhận tin. unit `√ AC03: sends nothing when no coin swings strongly`. |
| `EPIC-004-AC04` | Chat đăng ký, BTC mạnh, chưa nhận tin 60 phút → đúng một tin có coin, nhận định, lý do, miễn trừ, **trong ≤ 30 phút** | untested | Phần nội dung pass: live, lượt `/cron/signals` đầu, giá giả BTC 84.000 so với 100.000 → mỗi chat (`chat-v`, `chat-d`) nhận đúng **một** tin: `📡 Tín hiệu: có coin dao động mạnh / 🔻 BTC: -16.0% (24h) · -16.0% (72h) — 🟢 Cân nhắc mua / Lý do: -16.0% trong 24 giờ; giá $84,000.00 nằm gần đáy khoảng 7 ngày (0%, khoảng $84,000.00–$100,000.00). / ⚠️ Chỉ là thông tin tham khảo theo quy tắc đơn giản (…), không phải lời khuyên đầu tư. Bạn tự chịu trách nhiệm với quyết định của mình. / Tắt tin này: /tinhieu tat`. Phần "≤ 30 phút kể từ khi vượt ngưỡng" phụ thuộc lịch cron-job.org 30 phút và chỉ quan sát được trên production. **Cách đóng:** sau khi tạo job, đọc log `signals-run` của vài lượt và đo thời gian từ lúc coin vượt ngưỡng tới lúc tin đến (plan bước 10). |
| `EPIC-004-AC05` | 10:00 gửi; 10:20, 10:50 không; 11:00 gửi ETH; chạy trùng cùng phút không tin thứ hai | pass | probe `selectCoinsToAlert` (BTC báo 10:00): `10:20 eth` → `[]`, `10:50` → `[]`, `10:59:59` → `0`, `11:00` → `["eth"]`. live: hai lần `/cron/signals` liền nhau → lần hai `chatsAlerted:0`, Zalo giả không nhận gì. live **ba lượt song song** (3 `curl` cùng lúc): log `outcome:healthy chatsAlerted:5` một lần và `outcome:skipped` hai lần; mỗi chat đúng 1 tin (`sends per chat: chat-ok:1 chat-bad:1 12345678901234567890:1 1e3:1 007:1`). |
| `EPIC-004-AC06` | BTC, ETH, SOL cùng mạnh → một tin chứa cả ba | pass | live: không coin thứ hai nào mạnh với giá giả mặc định, nên dùng unit `√ AC06: puts BTC, ETH and SOL in a single message` (trong 500 test, chạy lại bằng `--verbose`). |
| `EPIC-004-AC07` | BTC báo −16% lúc 10:00; 15:00 −18% không; −21% có; đổi chiều +9% có ngay; sau 24h báo lại | pass | probe (BTC đã báo −16% lúc 10:00, hết cooldown): `15:00 -18` → `[]`; `-21` → `["btc"]`; `-20.999` → `[]`; `flip +9` → `["btc"]`; `+24h, -16` → `["btc"]`; `+23:59, -16` → `[]`. |
| `EPIC-004-AC08` | Bản tin 9h: phần "Tín hiệu" với BTC và nhận định; không mạnh → một dòng; chat chưa đăng ký không có bản tin | pass | unit (`src/digest`, chạy lại): `√ AC08: adds the "Tín hiệu" part with the verdict for a strong coin, after the prices`, `√ AC08: says "Không có coin nào dao động mạnh" in one line when nothing swings`, `√ AC08: looks signals up once for all chats, over the union of their watchlists`, `√ a chat that is not subscribed gets no digest and no signals (AC08)`. Chưa chạy live (xem trên). |
| `EPIC-004-AC09` | Tính tín hiệu lỗi → phần giá vẫn gửi, chat khác không bị ảnh hưởng, có log lỗi | pass | unit: `√ AC09: when signals cannot be computed the prices still go out, without the part`, `√ AC09: a failure while building one chat part never touches another chat`. Chưa chạy live. |
| `EPIC-004-AC10` | `/tinhieu eth` trả: 24h, 72h, vị trí trong khoảng 7 ngày, mạnh hay không, nhận định, lý do, miễn trừ; `xyzabc` → thông báo của `/gia`; nguồn giá lỗi → thông báo tạm thời, không số | pass | live, CoinGecko **thật**, ngưỡng mặc định, ETH không mạnh: `📡 Tín hiệu hiện tại: / ➖ ETH: $2,326.24 · +0.1% (24h) · -0.6% (72h) · ở 12% khoảng 7 ngày ($2,300.60–$2,513.51) — không dao động mạnh, không có nhận định.` live, CoinGecko giả, BTC mạnh: `🔻 BTC: -16.0% (24h) · -16.0% (72h) — 🟢 Cân nhắc mua / Lý do: … / ⚠️ Chỉ là thông tin tham khảo …`. `/tinhieu xyzabc` → `⚠️ Không tìm thấy đồng coin: XYZABC. Vui lòng kiểm tra lại mã coin.` Nguồn giá lỗi (giả trả 500): `/tinhieu eth` → `⚠️ Không thể lấy dữ liệu giá lúc này (dịch vụ CoinGecko đang bận hoặc quá giới hạn). Vui lòng thử lại sau ít phút.`, không có số nào. |
| `EPIC-004-AC11` | Coin có 5 ngày lịch sử → "chưa đủ dữ liệu", không nhận định | pass | probe: lịch sử 5 ngày → `insuff:true, v:null`; lịch sử rỗng → `insuff:true`. live (giả, chart 404): `/tinhieu aaa` → `⏳ AAA: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.` e2e `√ AC11 …` pass trong 84. |
| `EPIC-004-AC12` | 90 ngày, 6 mua đúng 4 (66,7%), 5 bán đúng 2 (40%), ghi chú xấp xỉ, miễn trừ; dưới 14 ngày từ chối | pass | probe: tìm chuỗi 90 giá đóng cửa (seed 3900) cho `{"insufficient":false,"days":90,"buy":{"scored":6,"correct":4},"sell":{"scored":5,"correct":2}}`; trả lời in `📊 Backtest BTC — 90 ngày gần nhất / • Cân nhắc mua: 6 lần, đúng 4 (66.7%) / • Cân nhắc bán: 5 lần, đúng 2 (40.0%) / … ℹ️ Chỉ là xấp xỉ: backtest dùng giá cuối ngày … / ⚠️ Chỉ là thông tin tham khảo …`. 13 ngày → `⏳ Chưa đủ lịch sử để backtest BTC: có 13 ngày, cần ít nhất 14 ngày.`; 14 ngày chạy được; 40 ngày in `40 ngày gần nhất`. Số thập phân in `66.7%` (dấu chấm như mọi tin khác), spec viết `66,7%`: chỉ khác cách viết. |
| `EPIC-004-AC13` | Mua BTC ở 84.000; 3 ngày sau 90.000 → đúng; 80.000 → sai; trước 3 ngày → chờ chấm; `thongke` khớp; cùng nhận định-coin-ngày tính một lần | pass | probe `scoreRecords`: `90000 sau 3 ngày` → `buy {scored:1, correct:1}`; `80000` → `correct:0`; bằng giá 84000 → `correct:0`; điểm giá sau 2 ngày → `pending:1`; hai nhận định cùng ngày → `scored:1`; bán đúng khi giá xuống → `sell {1,1}`; đủ 3 ngày nhưng chưa có điểm giá sau mốc → `pending:1`. live: `/tinhieu thongke` ở `u1` (vừa nhận một "mua" từ `/tinhieu btc`) → `• Cân nhắc mua: chưa có lần nào được chấm / • Còn chờ chấm: 1 (chưa đủ 3 ngày)`; chat chưa có nhận định → `📭 Chưa có nhận định nào trong 30 ngày qua để chấm điểm.` |
| `EPIC-004-AC14` | `tat` xác nhận, không nhận tin chủ động, bản tin vẫn có phần Tín hiệu, watchlist không đổi; `bat` bật lại; còn nguyên sau khởi động lại | pass | live: `/tinhieu tat` → `🔕 Đã tắt tin tín hiệu chủ động. Phần "Tín hiệu" trong bản tin 9h sáng vẫn còn. Bật lại: /tinhieu bat`; `SMEMBERS signals:off` → `["chat-ok"]`; **dừng và khởi động lại** ứng dụng đã build, xoá `signals:sent`, `/cron/signals` → `sends per chat after restart: {"chat-bad":1}` (không có `chat-ok`); `/tinhieu bat` → `SMEMBERS` rỗng, lượt sau `{"chat-ok":1,"chat-bad":1}`. Bản tin 9h không bị tắt: `rg "isEnabled\|listDisabled\|disabled" src` chỉ khớp `SignalsController` (không có trong `src/digest`), và lệnh chỉ chạm tập `signals:off` (watchlist không đổi). |
| `EPIC-004-AC15` | Nguồn giá lỗi → không gửi, log một dòng lượt lỗi, lượt sau bình thường; một chat gửi lỗi, chat khác vẫn nhận | pass | live (giả `simple/price` 500): `"event":"signals-run",…,"outcome":"failed","coins":5,"chatsAlerted":0`, không tin nào tới Zalo; lượt kế sau khi nguồn sống lại → `"outcome":"healthy"`. Chat lỗi: `chat-bad` bị Zalo giả trả 400 → `"outcome":"healthy","chatsAlerted":1,"failures":1` và `chat-ok` vẫn nhận tin trong cùng lượt (`sends: {"chat-ok/200":1,"chat-bad/400":1}`). |
| `EPIC-004-AC16` | 50 chat, 30 coin khác nhau → nguồn giá ≤ 2 lần, Postgres không bị truy vấn | pass | unit `√ AC16: prices 30 coins for 50 chats with at most two price lookups`. live: số lệnh `simple/price` do CoinGecko giả đếm = **1 mỗi lượt** `/cron/signals` (nhiều lượt, 2–7 coin, nhiều chat). Postgres không với tới được suốt mọi lượt cron mà không lỗi nào: `grep -c "neon\|ECONNREFUSED\|postgres"` log app3/app4 = 0; sáu dòng `NeonDbError` ở log app2 chỉ ở `/tinhieu` không tham số (lệnh người dùng, trả thông báo lỗi chung thân thiện). Lấp lịch sử thêm tối đa 3 lệnh `market_chart` mỗi lượt (xem §6 #4). |
| `EPIC-004-AC17` | Dùng `/tinhieu` hoặc nhận tin được ghi; đếm được chat ngoài owner dùng lại sau ngày đầu; log không chứa nhận định | pass | live: `npm run signals:report` (env shell trỏ Redis scratch) in `Used /tinhieu at least once: 5`, bảng từng chat (`u1: first 2026-10-27, command days 1, active days 1, commands 9, alerts 0 …`, `chat-ok: … alerts 2`), `Verdicts sent … pending 3`, `Last healthy check run`, danh sách lượt chạy. Log: `grep -ciE "cân nhắc\|verdict\|84,?000\|buy\b"` trên log ứng dụng app2/app3/app4 → `0` mỗi tệp; mọi dòng `logger.*` trong `src/signals`, `src/digest`, `src/webhook` đã đọc: chỉ có số đếm, tên lỗi, chat id; dòng `signals-run` chỉ có số. |
| `EPIC-004-AC18` | `/help` liệt kê `/tinhieu` kèm ví dụ; `docs/API.md` có lệnh | pass | `src/utils/format-message.util.ts` dòng 128–129 (`• /tinhieu … · /tinhieu eth — một coin`, `• /tinhieu backtest btc … · /tinhieu thongke … · /tinhieu tat (hoặc bat) …`); `docs/API.md` dòng 109–113 có đủ `/tinhieu`, `eth`, `backtest btc`, `thongke`, `tat`/`bat`; `.env.example` có `SIGNALS_CRON_SECRET`, `SIGNAL_SWING_24H_PCT`, `SIGNAL_SWING_72H_PCT`, `SIGNAL_BAND_PCT`. |

### 2.1 NFR kiểm được hoặc không kiểm được

| Id | Verdict | Evidence |
|---|---|---|
| `NFR01` ≤ 30 phút | untested | Chỉ quan sát được sau khi có job cron-job.org. Xem AC04 và §6 #3. |
| `NFR02` ≤ 5 giây p95 | untested | Cục bộ: `durationMs` của lượt cron 1–131 ms (CoinGecko giả), 1.191 ms với CoinGecko thật gồm lấp lịch sử 2 coin; mọi lệnh `/tinhieu` trả lời tức thì. Không phải p95 trên production với Upstash thật. |
| `NFR03` quota nguồn giá | pass (kèm lưu ý) | Mỗi lượt cron = đúng 1 lệnh `simple/price` cho mọi coin (đếm ở CoinGecko giả). Lưu ý: lượt có coin mới thêm tối đa 3 lệnh `market_chart` (lượt 1/2/3 của 7 coin: 3 + 3 + 1), vượt chữ "≤ 2 lần" của spec về mặt nghĩa đen nhưng bị chặn trên; xem #4. |
| `NFR04` lưu trữ | untested | Cục bộ `ZCARD signals:day:btc` = 90, `signals:hour:btc` = 192, TTL `signals:bf:btc` = 7.776.000 s; dung lượng và trần của Upstash thật chưa đo. |
| `NFR05` không truy vấn Postgres mỗi lượt | pass | Xem AC16: cron chạy sạch với Postgres không với tới được; `rg "subscribers\|postgres" src/signals` (trừ spec) chỉ ra chú thích. |
| `NFR06` không quá 1 tin/60 phút | pass | Xem AC05 (lượt liền sau 0 tin; ba lượt song song 1 tin/chat). |
| `NFR07` log ghi cả lỗi; giám sát | pass | Log `signals-run` có `outcome` (`healthy`/`failed`/`skipped`), `failures`, `chatsAlerted`, `deferred`, `durationMs`. Giám sát live qua `/cron/price-alerts-watch` (secret `PRICE_ALERTS_WATCH_SECRET`, `OWNER_CHAT_ID=owner-1`): `signals:last-healthy` mới → **0** tin; đặt về 100 phút trước → **đúng 1** tin `⚠️ Tín hiệu: lượt kiểm tra ngừng chạy. / Không có lượt chạy tốt nào từ 20:07 27/10 (ICT), đã 1 giờ 40 phút. / Gợi ý: …`; gọi lại → 0; một lượt cron khoẻ rồi gọi watcher → **đúng 1** tin `✅ Tín hiệu: lượt kiểm tra đã chạy lại. … Gián đoạn khoảng 1 giờ 40 phút.`; gọi lại → 0; xoá `last-healthy` và `outage` (chưa từng khoẻ) → 0 tin hai lần liên tiếp. |
| `NFR08` xác định, kèm số | pass | probe: cùng dữ liệu luôn cùng kết quả; mọi nhận định in kèm % và vị trí. |
| `NFR09` giới hạn input | pass | live: chat id `12345678901234567890`, `1e3`, `007` giữ nguyên là chuỗi (`HKEYS signals:sent` → `["chat-bad","12345678901234567890","1e3","chat-ok","007"]`, Zalo giả nhận đúng `chat_id` đó); chat id 65 ký tự → HTTP `400` và không vào `signals:off`; ký hiệu coin: 21 ký tự → `SIGNAL_INVALID`, 20 ký tự → `SIGNAL_VIEW`; `/tinhieu eth;drop table`, `/tinhieu ../../etc`, `/tinhieu 💥` → cú pháp sai. Redis thật (e2e): `√ drops records older than 90 days and caps a chat at 1000`. |
| `NFR10` riêng tư, log | pass | AC17; live: `nobody` (chat không có nhận định) không thấy nhận định của `u1`. |
| `NFR11` giới hạn tần suất lệnh | pass | live với `THROTTLE_LIMIT=5`: bảy lệnh liên tiếp của một chat → `200 200 200 200 200 429 429`. |

## 3. Promised proofs

| Proof (plan §5, §6) | Executed | Result |
|---|---|---|
| `npx jest src/signals/...`, `src/digest`, `src/utils`, `scripts`, `src/price-alerts` | Có, trong `npx jest` đầy đủ | 33/33 suite, 500/500 |
| `npm run test:e2e` (webhook, AC10–AC14) | Có, `--runInBand` | 84 pass / 18 skip (Postgres) |
| `test/signals.redis.e2e-spec.ts` trên Redis thật (Lua, khoá chạy, tắt/bật sau khi tạo lại service) | Có | PASS trong lượt e2e trên (17 ca). Ghi chú: code dùng `HSETNX` trên hash, plan nói `ZADD NX`; đã ghi ở `implement.md` §7 |
| Instance chạy tay: `curl /cron/signals` + webhook giả | Có | §2, live |
| Backtest thật BTC/ETH/SOL (AC12, rủi ro "chất lượng nhận định") | Có (CoinGecko thật, ngưỡng mặc định), **BTC và XRP** | `runBacktest` trên giá cuối ngày 2026-10-27: BTC mua 0/0, bán 0/1 (biến động ngày lớn nhất 8,0%); XRP mua 1/1, bán 2/3 (lớn nhất 15,0%). Khớp bảng §5 của `implement.md` (BTC `0/0, 0/1`; XRP `1/1, 2/3`), không lệch. ETH/SOL/DOGE không chạy lại |
| `npm run signals:report` trên Redis scratch | Có | §2 AC17 |
| NFR07 giám sát (hold/phục hồi) | Có, live | §2.1 |
| NFR01, NFR02, ngân sách Upstash, NFR04, Lua trên Upstash thật (plan bước 10) | **Không**: chỉ làm được sau deploy, plan đã nói trước | untested |

## 4. Regressions

```
$ npx jest
Test Suites: 33 passed, 33 total
Tests:       500 passed, 500 total
EXIT 0

$ npx tsc --noEmit            -> EXIT 0
$ npm run build               -> EXIT 0 (nest build, dist/ chạy được: §2 live)
$ npx eslint src/signals src/utils src/digest src/webhook src/command-parser src/coingecko src/config test/signals.redis.e2e-spec.ts test/webhook.e2e-spec.ts
                              -> EXIT 0, không có dòng nào

$ REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npx jest --config ./test/jest-e2e.json --runInBand
Test Suites: 1 skipped, 3 passed, 3 of 4 total
Tests:       18 skipped, 84 passed, 102 total
EXIT 0
```

`git diff master...HEAD --stat`: 66 tệp, +6.607/−10 dòng, 21 commit. Cảnh báo giá cũ không đổi hành vi: `git diff master...HEAD -- src/price-alerts` chỉ gồm `price-alerts-watch.controller.ts` (+13 dòng: gọi `SignalsMonitorService.check()` trong `try/catch` riêng sau lần theo dõi cũ) và `price-alerts.module.ts` (import `SignalsModule`); toàn bộ spec cảnh báo giá vẫn xanh trong 500 test.

## 5. Out-of-scope check

Không có gì trong `Out of scope` bị ship.
- Chỉ báo kỹ thuật (RSI, MACD, nến, học máy): `rg -i "rsi\|macd" src/signals src/utils/format-signals.util.ts` → không có; quy tắc chỉ là biến động % và vị trí trong khoảng 7 ngày (`signal-evaluator.ts`).
- Không có kênh khác ngoài Zalo (`rg -i "telegram\|messenger\|stripe\|paid"` → không có); không có gói trả phí.
- Không có bảng Postgres hay migration: `git diff master...HEAD --name-only` không chứa `.sql`/`migrat`/`schema`; ứng dụng chạy suốt rev 3 với Postgres không với tới được mà luồng cron/tín hiệu không bị ảnh hưởng.
- Ngưỡng là cấu hình chung (`SIGNAL_SWING_*`, `SIGNAL_BAND_PCT`), không có ngưỡng theo chat.
- Không liên kết với danh mục; backtest chỉ chấm đúng/sai hướng, không mô phỏng lãi/lỗ.
- "Deliberately not doing" của plan §7: không dùng Postgres; luật `/canhbao` không đổi (diff `src/price-alerts` như §4); không có cron chấm điểm riêng (`scorecard` tính khi gọi); không chạm `vercel.json` (không có trong `--stat`); tệp ngoài phạm vi epic trong `--stat` chỉ là `.env.example`, `CHANGELOG.md`, `docs/*`, `package.json` (`signals:report`), `src/app.module.ts`.
- Plan §2 dự kiến mở rộng `PriceAlertsMonitorService`; thực tế giám sát tín hiệu là lớp riêng `SignalsMonitorService` (plan §4 rủi ro 3 cho phép; `implement.md` §4 mục 3 đã ghi).

## 6. Findings

Đối chiếu `implement.md` (đọc sau cùng, chỉ để đối chiếu). **Khớp** với lượt chạy của verifier: 500 test (§7.1), AC10 sửa, các hành vi mới của §7.1 (3 coin/lượt; 429 giữ 10 phút = `busy`, 404 giữ 2 giờ = `notfound` và đi tiếp; chat bị chặn thử 3 lượt rồi 6 giờ, thành công xoá chuỗi; lỗi gõ `tatt`/`batt`/`bactest`/`thongkee`; TAO vẫn là coin), "chỉ một dòng ở bản tin" (formatter), backtest ngưỡng mặc định BTC và XRP (§3), giám sát down/recovered/im lặng, "BTC có biến động ngày lớn nhất 8,0%". **Chưa kiểm lại**: số liệu ETH/SOL/DOGE ở §5 (đã chạy lại BTC và XRP), ngân sách gửi 20 giây (chỉ có unit `deferred: 1`), và `/tinhieu backtest <coin>` khi `market_chart` 429 (chỉ unit `√ backtest surfaces a rate limit …`; live đã kiểm đường `/tinhieu <coin>`). **Không khớp**: §1 và §3 của `implement.md` (xem #15).

### 6.1 Trạng thái các finding của rev 1 và rev 2

| # | Finding | Severity | Trạng thái rev 3 | Evidence rev 3 |
|---|---|---|---|---|
| 1 | AC10: coin không mạnh thiếu vị trí trong khoảng 7 ngày | Medium | **Fixed** | live thật: `➖ ETH: $2,326.24 · +0.1% (24h) · -0.6% (72h) · ở 12% khoảng 7 ngày ($2,300.60–$2,513.51) — không dao động mạnh, không có nhận định.` |
| 2 | Con số chất lượng trong `implement.md` dựa trên ngưỡng không phải của spec | Medium (thông tin quyết định) | **Fixed** (tài liệu) | chạy lại ngưỡng mặc định: BTC `buy 0/0, sell 0/1`, XRP `buy 1/1, sell 2/3`, khớp `implement.md` §5. Hệ quả cho owner vẫn nguyên: với coin lớn quy tắc gần như không bao giờ nổ (BTC có biến động ngày lớn nhất 8,0%), cỡ mẫu 0–3 không đánh giá được chất lượng; cần quyết ngưỡng trước khi báo người dùng ngoài owner. |
| 3 | Vòng phản hồi không phủ AC04 ≤ 30 phút, NFR01, NFR02, NFR04, ngân sách Upstash, Lua trên Upstash thật | Medium (vòng phản hồi) | **Still open**, ghi trung thực ở `implement.md` §6 | §2.1; chỉ đóng được sau deploy. Số lệnh Redis đo trên scratch (INFO `commandstats`, một lượt cron rảnh, 5 coin): 12 lệnh phía client (SET NX, 4 đọc, EVAL ghi, MGET, EVAL đọc, EVAL nhả khoá, LPUSH, LTRIM, SET `last-healthy`) + MULTI/EXEC = 14, khớp "khoảng 14 lệnh/lượt" của `docs/ARCHITECTURE.md`; mỗi nhịp watcher thêm đúng 1 `MGET` cho tín hiệu (lượt đo watcher: `lrange 1, set 1, get 1, mget 1`, ba lệnh kia thuộc cảnh báo giá cũ). Redis thật thực thi 61 lệnh gồm cả lệnh bên trong Lua (ZADD, ZREMRANGEBYSCORE, EXPIRE… cho 5 coin): nếu Upstash đếm cả lệnh bên trong `EVAL` thì ngân sách cao hơn nhiều so với 14; chưa kiểm được. |
| 4 | Lấp lịch sử thêm lệnh `market_chart`, dễ chạm giới hạn tốc độ keyless của CoinGecko | Low–Medium | **Mitigated**, còn mở ở mức chữ của NFR03 | live (CoinGecko giả, 7 coin watchlist): lượt 1 gọi `bitcoin, ethereum, solana`, lượt 2 `cardano, ripple, dogecoin`, lượt 3 `litecoin`, lượt 4 không gọi `market_chart` (tối đa 3 coin/lượt). 429: xoá cờ `bf` của sol/ada/xrp, `cardano` 429 → gọi `solana:ok, cardano:429` rồi **dừng** (không gọi `ripple`); `GET signals:bf-fail:ada` → `"busy"`, `TTL` → `600`; lượt ngay sau: ada bị giữ, gọi `ripple:ok`. 404: `ripple` 404, xoá cờ xrp/doge/ltc → gọi `ripple:404, dogecoin:ok, litecoin:ok` (**đi tiếp**); `GET signals:bf-fail:xrp` → `"notfound"`, `TTL` → `7200`. Còn lại: một lượt có coin mới có thể gọi 1 + 3 = 4 lệnh nguồn giá, trên chữ "≤ 2 lần" của NFR03; ngày đầu nhiều coin mới phải trải qua nhiều lượt (rev 2 đã gặp 429 thật sau khoảng 4 lệnh keyless). |
| 5 | Tin đầu tiên của chat nhiều coin mới chỉ chứa các coin đã lấp xong | Low | **Still open**, ghi ở `implement.md` §7 | live: chat 7 coin, lượt 1 chỉ lấp 3 coin (btc, eth, sol), 4 coin còn lại "chưa đủ dữ liệu" đến lượt 2–3. Hệ quả của #4, đúng FR05, chỉ khác trải nghiệm ngày đầu. |
| 6 | Giá hiện tại bằng 0 cho ra "Cân nhắc mua −100%" | Low | **Fixed** | probe: giá hiện tại `0`, `NaN`, `-5`, `Infinity` → `insuff:true, v:null`; một điểm `0` trong lịch sử và một điểm `0` đúng mốc 24h → kết quả vẫn `buy, pos 10.0, c24 -16.00` (điểm hỏng bị bỏ qua, láng giềng trong 90 phút được dùng); `parseMembers(['1:0','2:NaN','3:5','4:-1','x:1'])` → chỉ còn `{"t":3,"p":5}`. Giá dương cực nhỏ (`1e-12` so với 100) vẫn ra `-100%` mua, là giá hợp lệ về mặt số học. |
| 7 | 429 của `market_chart` báo "chưa đủ lịch sử, có 0 ngày" | Low | **Fixed** (live cho `/tinhieu <coin>`; backtest dựa vào unit) | xem #13 live; unit `√ backtest surfaces a rate limit instead of reporting 0 days`, `√ does not report a 429 as an unknown coin` (trong 500 test). |
| 8 | Chat chặn bot bị gửi lại ở mọi lượt, mãi mãi | Low | **Fixed** | live (`chat-bad` bị Zalo giả trả 400; `chat-ok` bình thường): lượt 1, 2, 3 đều thử `chat-bad` (`sends: {"chat-bad/400":1}`, `failures` 1, trạng thái `failures:1 → 2 → 3`); lượt 4 và 5 **không thử** (`sends: {}`, `failures:0`), mọi lượt `outcome:healthy`; `failedAt` chỉnh thành 5 giờ 59 phút trước → không thử; 6 giờ 01 phút trước → **đúng một** lần thử (vẫn 400, `failures:4, failedAt` mới), lượt liền sau lại không thử; bỏ chặn + `failedAt` cũ → gửi thành công (`chat-bad/200`) và trạng thái thành `{"lastSentAt":…,"coins":{"btc":…}}` (**không còn** `failures`). Một chat lỗi không chặn chat khác (xem AC15). |
| 9 | Bản tin có dòng "Chưa đủ dữ liệu" thừa; nói "không có coin nào mạnh" khi coin không có giá | Low | **Fixed** (unit) | `npx jest src/digest` (39/39 cùng controller) gồm ca chat không coin nào có giá; formatter một dòng; chưa chạy bản tin live (cần Postgres). |
| 10 | Tài liệu: `HSETNX` thay `ZADD NX` không được ghi | Low (docs) | **Fixed** (tài liệu) | `implement.md` §7 dòng "10". `plan.md` vẫn ghi `ZADD NX` (plan là hợp đồng đã duyệt, không sửa là đúng). |
| 11 | `/tinhieu bat` là công tắc; `/tinhieu tatt` gõ nhầm bị hiểu là coin | Low | **Fixed**, danh sách hữu hạn (xem #17) | live qua webhook: `tatt`, `batt`, `bactest btc`, `thongkee` → `❓ Cú pháp /tinhieu chưa đúng. / Ví dụ: /tinhieu · /tinhieu eth · /tinhieu backtest btc · /tinhieu thongke · /tinhieu tat / Mã coin chỉ gồm chữ và số. Lưu ý: "bat"/"tat" là công tắc bật/tắt tin chủ động.`; `/tinhieu tao` → tín hiệu TAO (`➖ TAO: $300.00 …`); `/tinhieu bat` → `🔔 Đã bật tin tín hiệu chủ động …`, `/tinhieu tat` → `🔕 Đã tắt …`. probe thêm: `backtes btc`, `thong ke`, `bat-x`, `$btc`, `eth btc`, `bat tat` → `SIGNAL_INVALID`; `TAT`, `tắt` → toggle tắt; `1inch` → coin. |
| 12 | Giá `0` (hoặc rác) vẫn được lưu vào lịch sử và làm sai khoảng 7 ngày | Low–Medium | **Fixed** (`a657a08`) | probe (#6): điểm 0 trong lịch sử không làm đổi khoảng giá/vị trí; `snapshot` lọc giá ≤ 0 và không hữu hạn (`signals-history.service.ts:118-121`); `evaluateWithPrices` lọc tương tự (`signals.service.ts:83-86`). |
| 13 | Khi `market_chart` bị 429, `/tinhieu <coin mới>` nói "chưa đủ dữ liệu" | Low | **Fixed** (`efdeb02`) | live (CoinGecko giả): `/tinhieu trx` với chart tron 429 → `⚠️ Không thể lấy dữ liệu giá lúc này (dịch vụ CoinGecko đang bận hoặc quá giới hạn). Vui lòng thử lại sau ít phút.` (`GET signals:bf-fail:trx` → `"busy"`); hỏi lại trong thời gian giữ → cùng thông báo; `/tinhieu aaa` với chart 404 → `⏳ AAA: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.` |
| 14 | `implement.md` còn hai chỗ chưa theo vòng sửa | Low (docs) | **Partly fixed** | §7 và §7.1 đã cập nhật; §1 và §3 vẫn lỗi thời (#15). |

### 6.2 Finding mới của rev 3

| # | Finding | Severity | Where |
|---|---|---|---|
| 15 | **`implement.md` §1 và §3 còn số liệu cũ.** §1: "13 commit … 63 tệp, +5.847/−10 dòng"; thực tế `git log master..HEAD` có 21 commit và `git diff master...HEAD --stat` ra 66 tệp, +6.607/−10. §3 hàng "Toàn bộ" ghi `Tests: 487 passed`, trong khi `npx jest` ra 500 (§7.1 đã nói "500 sau rev 3" nhưng ngay trong §7.1 cũng còn "487 test pass", nên tài liệu tự mâu thuẫn). Không ảnh hưởng hành vi; chỉ làm người duyệt hiểu sai quy mô thay đổi. | Low (docs) | `docs/epics/EPIC-004/artifacts/implement.md` §1, §3, §7.1 |
| 16 | **Backoff 6 giờ cũng kích hoạt khi Zalo (không phải chat) sập.** `ZaloService.sendTextMessage` trả `false` cho mọi lỗi gửi (HTTP 4xx/5xx, timeout 8 giây), và `recordFailed` đếm cả các lỗi đó. Nếu Zalo hoặc mạng từ Vercel tới Zalo lỗi qua 3 lượt 30 phút liên tiếp (90 phút), **mọi chat** có tín hiệu cần báo bị `isBackedOff` đến 6 giờ, kể cả sau khi Zalo hồi phục (xem lượt 4–5 của #8: không thử dù không có gì thay đổi ở phía chat), và lượt cron vẫn `healthy` nên giám sát không báo owner. Tin tín hiệu chỉ trễ chứ không mất (tín hiệu còn hiệu lực sẽ được gửi sau 6 giờ; tín hiệu đã qua thì mất), nên mức Low. Phân biệt lỗi 400 của chat với lỗi 5xx/timeout (chỉ đếm 400 và `ok:false`) hoặc chặn backoff khi mọi chat cùng lỗi trong một lượt sẽ đóng. Suy ra từ mã (`signals.controller.ts:163-174`, `signal-repeat.ts:50-61`) và hành vi #8; verifier không giả lập sập Zalo toàn phần. | Low | `src/signals/signals.controller.ts` (`alertChat`), `src/signals/signal-repeat.ts` |
| 17 | **Từ khoá `on`, `off`, `stats`, `signals` ngoài spec che các mã coin cùng tên; danh sách lỗi gõ là hữu hạn.** Parser đọc `/tinhieu on` là bật, `/tinhieu off` là tắt, `/tinhieu stats` là bảng điểm (probe: `SIGNAL_TOGGLE {"enabled":true}`, `SIGNAL_STATS`); spec FR13 chỉ định `tat`/`bat` và `thongke`. `ON` là một mã coin thật; người gõ `/tinhieu on` để xem coin đó sẽ vô tình bật tin chủ động. Câu báo sai cú pháp chỉ nhắc `bat`/`tat`. Ngoài ra chỉ 7 lỗi gõ được nhận diện (`tatt batt thongk thongkee backtes bactest backtst`); lỗi khác (`/tinhieu bactkest btc` → 2 tham số → cú pháp sai thì ổn, nhưng `/tinhieu statss`, `/tinhieu thonke`) vẫn ra "Không tìm thấy đồng coin: THONKE", không gợi ý cú pháp. Chấp nhận được; ghi để owner biết. | Low | `src/command-parser/command-parser.service.ts` (`SIGNAL_OFF_KEYWORDS`, `SIGNAL_ON_KEYWORDS`, `SIGNAL_STATS_KEYWORDS`, `SIGNAL_KEYWORD_TYPOS`) |

## 7. Shortest path to pass

**Mã không còn dòng `fail`.** Verdict tổng là fail chỉ vì một dòng `untested` (AC04), cùng các NFR không kiểm được trước deploy.

Có thể làm ngay trong mã/tài liệu (không lật được verdict, nhưng nên làm trước khi merge):
1. Cập nhật `implement.md` §1, §3, §7.1 cho khớp (21 commit, 66 tệp, +6.607/−10, 500 test) (#15).
2. (Tuỳ chọn) chỉ đếm lỗi kiểu "chat từ chối" vào chuỗi backoff, hoặc không backoff khi mọi chat cùng lỗi trong một lượt (#16); thêm `on`/`off`/`stats` vào ghi chú cú pháp hoặc bỏ khỏi từ khoá (#17).

Chỉ làm được sau deploy (đây mới là thứ lật dòng `untested`):
3. **AC04 (phần ≤ 30 phút):** owner deploy và tạo job cron-job.org mỗi 30 phút; chạy tay `/cron/signals` một lần trên Upstash thật (kiểm Lua), đọc log `signals-run` của vài lượt, đo từ lúc coin vượt ngưỡng tới lúc tin đến, chạy `npm run signals:report`; ghi vào file này. Cùng lượt quan sát đó đóng NFR01, NFR02 (p95 thời gian lệnh trong log), NFR04 (dung lượng) và ngân sách lệnh Upstash (dashboard sau 48 giờ; kiểm riêng xem Upstash có đếm lệnh bên trong `EVAL` không, #3). Canh số lệnh `market_chart` của ngày đầu (#4) và quyết ngưỡng với owner (#2).

**Verdict tổng: FAIL — 17 pass, 0 fail, 1 untested (AC04, chờ production); NFR01, NFR02, NFR04, ngân sách Upstash và Lua trên Upstash thật chưa kiểm được trước deploy.**
