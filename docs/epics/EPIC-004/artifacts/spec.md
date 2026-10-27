# Spec — Tín hiệu đơn giản (biến động / nhận định mua-bán tham khảo)

**Epic ID:** `EPIC-004`
**Owner:** Product Owner
**Status:** Approved (Thach, 2026-09-30)
**Created:** 2026-09-30
**Traces to:** `intent.md`

---

## 1. Overview

Bot hiện chỉ cho biết giá hiện tại của từng coin. Epic này thêm **tín hiệu** cho các coin trong watchlist của một chat: coin có đang **dao động mạnh trong vài ngày gần đây** hay không, kèm một **nhận định mua/bán mang tính tham khảo** dựa trên quy tắc cố định, dễ giải thích. Người dùng thấy tín hiệu ở ba nơi: trong bản tin 9h sáng, qua tin **báo chủ động** khi có dao động mạnh (tối đa 1 tin mỗi giờ mỗi chat), và khi tự hỏi bằng lệnh. Bot lưu lại lịch sử giá và mọi nhận định đã đưa ra, để người dùng xem được nhận định kiểu này trong quá khứ **đúng hay sai đến đâu** (backtest và bảng điểm thực tế). Mục tiêu là owner nắm xu hướng ngay trong Zalo, không phải mở app khác (`intent.md` §1, §5). Tiêu chí thành công là `intent.md` §5: trong 30 ngày sau ra mắt, ≥ 1 chat không phải của owner dùng tính năng này và dùng lại sau ngày đầu tiên. FR12 làm cho tiêu chí này đo được.

Nhận định là **thông tin tham khảo, không phải lời khuyên đầu tư**. Mọi tin có nhận định đều kèm câu miễn trừ (FR07).

## 2. Constraints applied

| Source | What it constrains |
|---|---|
| `CLAUDE.md` | Repo không có `CLAUDE.md`; dùng `docs/RULES.md` thay thế (giống EPIC-001/002/003). |
| `docs/RULES.md` | Quy trình thêm lệnh bot (parser → formatter thuần → nhánh trong controller → test bắt buộc); cập nhật bảng lệnh `docs/API.md`; env var chỉ đọc qua `ConfigService`; Conventional Commits; nhánh `feature/*`, merge qua PR có CI xanh. |
| `docs/ARCHITECTURE.md` | Serverless, không có tiến trình chạy lâu, cache in-memory không đáng tin. Bot không bao giờ im lặng, không lộ stack trace, `/webhook` và `/cron/*` trả `200` với lỗi nghiệp vụ. Bản tin xử lý từng subscriber độc lập. Lịch chạy tần suất cao phải do dịch vụ ngoài (cron-job.org) gọi vì Vercel Hobby cron chỉ chạy hằng ngày. |
| Lệnh và định dạng hiện có (`docs/API.md`) | Lệnh tiếng Việt, chấp nhận có dấu/không dấu, không phân biệt hoa thường; giá hiển thị USD kèm `~…₫` theo tỷ giá cố định `USD_TO_VND_RATE`; watchlist tối đa 20 coin; coin hợp lệ là mọi coin `/gia` tra được. |
| `docs/epics/EPIC-001` (subscribers, bản tin 9h) | Chỉ chat đã `/dangky` mới có watchlist và nhận bản tin; `/huy` tắt bản tin. |
| `docs/epics/EPIC-002` và `EPIC-002-FIX` | Đã có cảnh báo giá theo ngưỡng (`/canhbao`); tin chủ động phải có giới hạn tần suất theo **từng loại tin**, không tính chung. Gói miễn phí: Postgres (Neon) trần compute ~100 CU-h/tháng, Redis (Upstash) có trần lệnh. Bài học: log phải ghi cả lỗi, không chỉ thành công. |
| `docs/epics/EPIC-003` | Mọi đường ghi dữ liệu phải có giới hạn kích thước; log không chứa số liệu tài chính cá nhân. |
| `.aidlc/workspace.yaml` (`risk-security-reviewer`) | Epic đưa ra nhận định mua/bán và tự động nhắn cho người dùng, nên áp dụng kiểm tra chống lạm dụng, trách nhiệm nội dung và giới hạn tần suất. |
| Gói Vercel **Hobby**, các gói miễn phí hiện có | Không đòi hỏi gói hay dịch vụ trả phí mới. |

## 3. User scenarios

### 3.1 Primary flow

- **Given** chat đã `/dangky` với watchlist `btc eth sol`, và BTC giảm 16% trong 72 giờ qua, hiện nằm ở 10% dưới cùng của khoảng giá 7 ngày, **when** đến lượt kiểm tra định kỳ, **then** chat nhận **một** tin chủ động: BTC dao động mạnh (nêu % và khoảng thời gian), nhận định **"Cân nhắc mua"** kèm lý do một dòng, và câu miễn trừ.
- **Given** cùng chat, **when** bản tin 9h sáng được gửi, **then** bản tin có thêm phần "Tín hiệu" liệt kê các coin watchlist đang dao động mạnh kèm nhận định; nếu không coin nào dao động mạnh thì phần này ghi một dòng "Không có coin nào dao động mạnh".
- **Given** một coin đang tăng 20% trong 72 giờ và nằm ở 10% trên cùng của khoảng giá 7 ngày, **then** nhận định là **"Cân nhắc bán / chốt lời"**.
- **Given** một coin dao động mạnh nhưng giá đang ở giữa khoảng 7 ngày, **then** nhận định là **"Theo dõi"**, không khuyên mua hay bán.
- **Given** chat gửi `/tinhieu eth`, **then** bot trả tín hiệu hiện tại của ETH: thay đổi 24h, 72h, vị trí trong khoảng giá 7 ngày, có dao động mạnh hay không, nhận định và lý do. Gửi `/tinhieu` không tham số thì trả cho toàn bộ watchlist.
- **Given** chat gửi `/tinhieu backtest btc`, **then** bot trả kết quả áp dụng đúng quy tắc trên vào 90 ngày lịch sử của BTC: số lần đã có tín hiệu mua/bán, và tỉ lệ số lần mà giá 3 ngày sau **đi đúng hướng** nhận định.
- **Given** bot đã đưa nhận định trong 30 ngày qua, **when** chat gửi `/tinhieu thongke`, **then** bot trả bảng điểm thực tế: số nhận định mua/bán đã chấm điểm, tỉ lệ đúng, và số nhận định còn chờ chấm.
- **Given** chat gửi `/tinhieu tat`, **then** chat ngừng nhận tin chủ động; `/tinhieu bat` bật lại. Phần "Tín hiệu" trong bản tin 9h **không** bị tắt bởi lệnh này.

### 3.2 Edge and error paths

- **Chat chưa `/dangky`** (chưa có watchlist): không nhận tin chủ động và không có phần trong bản tin; `/tinhieu` nhắc `/dangky`, còn `/tinhieu <coin>` vẫn dùng được với coin hợp lệ bất kỳ.
- **Coin chưa đủ lịch sử** (ít hơn 7 ngày dữ liệu): bot ghi "chưa đủ dữ liệu", **không** đưa nhận định mua/bán.
- **Nguồn giá lỗi lúc kiểm tra định kỳ**: bỏ lượt đó, không gửi tin sai, không gửi tin "lỗi" cho người dùng; lượt lỗi được ghi log. Lượt kế tiếp chạy bình thường.
- **Nguồn giá lỗi khi người dùng gõ `/tinhieu`**: bot trả thông báo tạm thời không lấy được giá, dùng lại thông báo có sẵn của `/gia`. Không hiện số sai.
- **Nhiều coin cùng dao động mạnh trong một lượt**: gộp thành **một** tin, không gửi nhiều tin.
- **Coin đã báo rồi và vẫn đang dao động cùng chiều**: không báo lặp trong 24 giờ, trừ khi mức thay đổi tăng thêm ≥ 5 điểm phần trăm so với lần báo trước (FR06).
- **Chat đã nhận tin trong vòng 1 giờ qua**: tín hiệu mới **chờ** đến khi hết giờ, rồi gửi ở lượt kế tiếp nếu vẫn còn hiệu lực. Không bị mất, không gửi dồn nhiều tin.
- **Cảnh báo giá `/canhbao` và tín hiệu cùng đến một lúc**: hai loại tin độc lập, giới hạn tần suất của loại này không chặn loại kia.
- **Chat bị Zalo từ chối gửi** (chặn bot, chat không còn): lỗi được ghi log, không ảnh hưởng chat khác trong cùng lượt.
- **Backtest khi lịch sử ngắn hơn 90 ngày**: dùng phần đang có và ghi rõ số ngày thực tế đã dùng. Dưới 14 ngày thì từ chối và giải thích.
- **Chưa có nhận định nào để chấm** khi gõ `/tinhieu thongke`: trả lời trống kèm giải thích.
- **Database hoặc Redis lỗi**: bot trả lời thân thiện, không ghi nửa chừng; bản tin 9h vẫn gửi phần giá watchlist, chỉ bỏ phần "Tín hiệu".
- **Watchlist thay đổi** (`/watchlist`): coin mới bắt đầu được theo dõi từ lúc thêm; tín hiệu tính từ lịch sử sẵn có nếu có, nếu không thì hiện "chưa đủ dữ liệu".

## 4. Functional requirements

| Id | Requirement | Priority | Traces to |
|---|---|---|---|
| `EPIC-004-FR01` | **Dao động mạnh** của một coin được xác định khi một trong hai điều kiện đúng: (a) giá hiện tại chênh ≥ **8%** so với giá 24 giờ trước (tăng hoặc giảm); (b) giá hiện tại chênh ≥ **15%** so với giá 72 giờ trước. Ngưỡng là giá trị mặc định do PO đề xuất, có thể chỉnh qua cấu hình mà không sửa quy tắc. | Must | intent §5 ("dao động mạnh trong vài ngày"); Open Q2 |
| `EPIC-004-FR02` | Mỗi coin dao động mạnh nhận đúng một trong ba nhận định: **"Cân nhắc mua"** khi giá đang trong 25% thấp nhất của khoảng giá 7 ngày gần nhất; **"Cân nhắc bán / chốt lời"** khi giá đang trong 25% cao nhất của khoảng đó; **"Theo dõi"** ở các trường hợp còn lại. Coin không dao động mạnh **không** có nhận định mua/bán. Mỗi nhận định kèm lý do một dòng nêu các con số dùng (thay đổi %, vị trí trong khoảng 7 ngày). Quy tắc là xác định: cùng dữ liệu luôn cho cùng nhận định. | Must | intent §5 (nhận định mua/bán tham khảo) — §8 Concern 2 |
| `EPIC-004-FR03` | Bản tin 9h sáng của chat đã đăng ký có thêm phần "Tín hiệu" cho các coin trong watchlist của chat đó: liệt kê coin đang dao động mạnh kèm nhận định, hoặc một dòng "Không có coin nào dao động mạnh". Chat chưa đăng ký không nhận thêm gì. Phần này không chặn hay làm thay đổi phần giá watchlist hiện có. | Must | intent §5; Open Q3 |
| `EPIC-004-FR04` | Bot kiểm tra định kỳ các coin trong watchlist của mọi chat đang đăng ký. Khi có coin dao động mạnh (FR01) thì gửi **tin chủ động** tới chat có coin đó trong watchlist, trừ chat đã tắt bằng `/tinhieu tat`. Mặc định là **bật** cho mọi chat đã đăng ký. | Must | intent §5 (báo chủ động); Open Q3 — §8 Concern 4 |
| `EPIC-004-FR05` | Mỗi chat nhận **tối đa 1 tin chủ động về tín hiệu mỗi giờ**. Nhiều coin dao động mạnh trong cùng lượt thì gộp vào một tin. Tín hiệu bị chặn bởi giới hạn này được giữ lại và gửi ở lượt kế tiếp sau khi hết giờ, nếu điều kiện còn đúng. Giới hạn chỉ tính cho loại tin tín hiệu, không tính chung với `/canhbao`, bản tin 9h hay tin trả lời lệnh. | Must | Owner, 2026-09-30 ("1 tiếng/lần") |
| `EPIC-004-FR06` | Không báo lặp: một coin đã được báo cùng chiều (tăng hoặc giảm) thì không báo lại trong **24 giờ**, trừ khi mức thay đổi hiện tại lớn hơn mức thay đổi ở lần báo trước thêm ≥ **5 điểm phần trăm**. Coin đổi chiều dao động thì được báo ngay theo FR05. | Must | intent §5; Open Q7 (tránh làm phiền) |
| `EPIC-004-FR07` | Mọi tin có nhận định mua/bán (tin chủ động, bản tin, `/tinhieu`, `/tinhieu backtest`) kèm câu miễn trừ rõ ràng, nêu rằng đây là thông tin tham khảo dựa trên quy tắc đơn giản, không phải lời khuyên đầu tư, và người dùng tự chịu trách nhiệm quyết định. | Must | intent §5 ("thông tin tham khảo") — §8 Concern 3 |
| `EPIC-004-FR08` | `/tinhieu [coin]` trả tín hiệu hiện tại theo §3.1. Không tham số: cho toàn bộ watchlist. Có `<coin>`: cho coin đó nếu `/gia` tra được, nếu không thì dùng thông báo "coin không tồn tại" của `/gia`. Chấp nhận có dấu/không dấu, không phân biệt hoa thường (`/tínhiệu`), cùng alias tiếng Anh `/signal`. | Must | intent §5 |
| `EPIC-004-FR09` | Bot **lưu lịch sử giá** của mọi coin đang nằm trong watchlist của ít nhất một chat: đủ để tính FR01–FR02 (độ phân giải tối thiểu 1 giờ cho 3 ngày gần nhất, tối thiểu 1 ngày cho tối thiểu 90 ngày). Coin không còn ai theo dõi thì ngừng tích luỹ và dữ liệu cũ được dọn theo thời gian giữ ở NFR04. | Must | intent Open Q8 (lưu lịch sử giá) |
| `EPIC-004-FR10` | `/tinhieu backtest <coin>` áp dụng đúng quy tắc FR01–FR02 lên lịch sử giá của coin trong tối đa 90 ngày gần nhất và báo: số ngày dùng, số lần có tín hiệu mua, số lần có tín hiệu bán, và với mỗi loại, tỉ lệ số lần mà giá **3 ngày sau** đi đúng hướng (sau tín hiệu mua giá cao hơn; sau tín hiệu bán giá thấp hơn). Backtest dùng giá theo ngày nên chỉ xấp xỉ quy tắc dùng giá theo giờ; kết quả ghi rõ điều đó. Chỉ tính các tín hiệu đã đủ 3 ngày để chấm. | Must | intent §5; Open Q6 (backtest) |
| `EPIC-004-FR11` | Mỗi nhận định mua/bán mà bot **thực sự gửi** cho một chat (tin chủ động, bản tin, `/tinhieu`) được ghi lại: chat, coin, nhận định, giá lúc đưa ra, thời điểm. Sau 3 ngày, nhận định được chấm đúng/sai theo cùng tiêu chí FR10. `/tinhieu thongke` báo số nhận định đã chấm, tỉ lệ đúng theo từng loại (mua, bán), trong 30 ngày gần nhất, và số nhận định còn chờ chấm. Cùng một coin, cùng nhận định trong cùng ngày chỉ được tính một lần. | Must | intent Open Q8; §5 |
| `EPIC-004-FR12` | Mỗi lần một chat nhận tin tín hiệu hoặc gọi `/tinhieu` đều được ghi lại (chat, loại, thời điểm). Nhờ vậy owner đếm được "số chat không phải owner dùng tính năng và vẫn dùng sau ngày đầu tiên" (intent §5) mà không phải hỏi người dùng. | Must | intent §5 (tiêu chí thành công) |
| `EPIC-004-FR13` | `/tinhieu tat` và `/tinhieu bat` tắt/bật tin chủ động của chat và xác nhận trạng thái mới. Trạng thái được giữ lại giữa các lần dùng. Lệnh không đổi watchlist hay việc đăng ký bản tin. | Must | Open Q3 (không làm phiền) |
| `EPIC-004-FR14` | `/help` liệt kê các lệnh `/tinhieu` kèm ví dụ, và `docs/API.md` được cập nhật. | Should | `docs/RULES.md` |

## 5. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| `EPIC-004-NFR01` | Độ trễ báo chủ động | Sau khi coin vượt ngưỡng dao động mạnh, tin đến chat trong **≤ 30 phút**, nếu giới hạn FR05 cho phép. |
| `EPIC-004-NFR02` | Thời gian phản hồi lệnh | `/tinhieu` cho watchlist 20 coin trả lời **≤ 5 giây p95**; `/tinhieu backtest` và `/tinhieu thongke` **≤ 5 giây p95**. |
| `EPIC-004-NFR03` | Dùng quota nguồn giá | Một lượt kiểm tra định kỳ gọi nguồn giá **≤ 2 lần** cho toàn bộ các coin khác nhau trong mọi watchlist, không phụ thuộc số chat. Việc tích luỹ lịch sử giá dùng lại chính dữ liệu đó, không gọi thêm. Một lần `/tinhieu` gọi nguồn giá **≤ 2 lần**. |
| `EPIC-004-NFR04` | Lưu trữ, trong gói miễn phí | Không đòi hỏi gói hay dịch vụ trả phí mới. Lịch sử giá giữ **90 ngày** rồi dọn; nhận định đã ghi giữ **90 ngày**. Dung lượng lịch sử giá tối đa theo số coin khác nhau × độ phân giải ở FR09; số coin khác nhau được giới hạn bởi watchlist tối đa 20 coin mỗi chat. |
| `EPIC-004-NFR05` | Tải cơ sở dữ liệu | Lượt kiểm tra định kỳ **không** truy vấn Postgres (Neon) mỗi lượt để tránh vượt trần compute miễn phí (bài học EPIC-002). Việc đọc/ghi Postgres chỉ xảy ra khi người dùng gửi lệnh, một lần mỗi ngày cho bản tin, và ở tần suất thấp cho việc lưu lịch sử. Ràng buộc này được kiểm chứng ở bước plan, không chỉ nêu ở đây. |
| `EPIC-004-NFR06` | Chống làm phiền | Không chat nào nhận quá 1 tin tín hiệu chủ động trong bất kỳ khoảng 60 phút nào, kể cả khi lượt kiểm tra chạy trùng hoặc chạy lại. |
| `EPIC-004-NFR07` | Độ tin cậy của lượt kiểm tra | Lỗi ở một chat hoặc một coin không chặn chat/coin khác. Mỗi lượt ghi một dòng log có cấu trúc: số coin đã đánh giá, số chat được báo, số chat lỗi, thời gian. Ghi cả **lỗi**, không chỉ thành công. Nếu lượt kiểm tra ngừng chạy thì owner phải biết (dùng lại cơ chế giám sát của EPIC-002-FIX, không xây cơ chế mới). |
| `EPIC-004-NFR08` | Tính xác định và giải thích được | Cùng lịch sử giá và cùng ngưỡng luôn cho cùng nhận định; nhận định luôn kèm các con số dùng (FR02). Không dùng mô hình học máy hay nguồn dữ liệu không tái lập được. |
| `EPIC-004-NFR09` | Giới hạn input/dữ liệu lưu | `chat.id` tối đa 64 ký tự; ký hiệu coin tối đa 20 ký tự; số nhận định lưu mỗi chat tối đa **1.000** (bản ghi cũ hơn bị dọn trước) . |
| `EPIC-004-NFR10` | Riêng tư và log | Log ứng dụng không ghi nội dung nhận định theo chat; chỉ ghi chat, loại sự kiện và kết quả. Một chat chỉ xem được bảng điểm của chính mình. |
| `EPIC-004-NFR11` | Chống lạm dụng lệnh | `/tinhieu` chịu giới hạn tần suất theo chat hiện có (`UserThrottlerGuard`). |

## 6. Acceptance criteria

| Id | Given / When / Then |
|---|---|
| `EPIC-004-AC01` | **Given** giá BTC hiện tại 84.000 và giá 24 giờ trước 100.000 (giảm 16%), **when** đánh giá, **then** BTC dao động mạnh. **Given** giá hiện tại 100.000 và 24 giờ trước 93.000 (+7,5%) và 72 giờ trước 90.000 (+11,1%), **then** không dao động mạnh. **Given** giá 72 giờ trước 100.000, hiện 115.000 (+15%), 24 giờ trước 112.000 (+2,7%), **then** dao động mạnh (biên bằng ngưỡng tính là mạnh). (FR01) |
| `EPIC-004-AC02` | **Given** BTC dao động mạnh, khoảng giá 7 ngày từ 80.000 đến 120.000, giá hiện tại 84.000 (nằm ở 10% dưới), **then** nhận định "Cân nhắc mua" kèm các con số. **Given** giá hiện tại 116.000 (ở 90%), **then** "Cân nhắc bán / chốt lời". **Given** giá hiện tại 100.000 (ở 50%), **then** "Theo dõi". Giá đúng ở 25% (90.000) tính là thấp nhất 25% → "Cân nhắc mua". (FR02) |
| `EPIC-004-AC03` | **Given** ETH tăng 3% trong 24 giờ và 5% trong 72 giờ, **then** không có nhận định mua/bán cho ETH và không có tin chủ động về ETH. (FR01, FR02) |
| `EPIC-004-AC04` | **Given** chat đã đăng ký, có BTC dao động mạnh, chưa nhận tin tín hiệu trong 60 phút qua, **when** lượt kiểm tra chạy, **then** chat nhận đúng một tin chứa BTC, nhận định, lý do và câu miễn trừ trong ≤ 30 phút kể từ khi vượt ngưỡng. (FR04, FR07, NFR01) |
| `EPIC-004-AC05` | **Given** AC04 vừa xảy ra lúc 10:00 và lúc 10:20 ETH dao động mạnh, **when** lượt kiểm tra chạy lúc 10:20 và 10:50, **then** không có tin nào gửi cho chat trước 11:00; lượt đầu tiên từ 11:00 gửi một tin về ETH nếu ETH vẫn dao động mạnh. Chạy trùng lượt kiểm tra hai lần trong cùng phút cũng không sinh tin thứ hai. (FR05, NFR06) |
| `EPIC-004-AC06` | **Given** BTC, ETH, SOL cùng dao động mạnh trong một lượt, **then** chat nhận **một** tin chứa cả ba coin. (FR05) |
| `EPIC-004-AC07` | **Given** BTC đã được báo giảm 16% lúc 10:00, **when** lượt kiểm tra chạy lúc 15:00 và BTC giảm 18%, **then** không báo lại. Nếu BTC giảm 21% (thêm ≥ 5 điểm) thì báo lại. Nếu BTC đổi chiều và tăng 9% trong 24 giờ thì báo ngay theo giới hạn giờ. Sau 24 giờ kể từ lần báo và vẫn dao động mạnh cùng chiều với mức tương đương thì báo lại. (FR06) |
| `EPIC-004-AC08` | **Given** chat đã `/dangky` và có BTC dao động mạnh, **when** bản tin 9h được gửi, **then** bản tin có phần "Tín hiệu" chứa BTC và nhận định. **Given** không coin nào dao động mạnh, **then** phần này là một dòng "Không có coin nào dao động mạnh". **Given** chat chưa đăng ký, **then** không có bản tin. (FR03) |
| `EPIC-004-AC09` | **Given** lượt bản tin 9h mà việc tính tín hiệu của một chat bị lỗi, **then** phần giá watchlist của chat đó vẫn được gửi, chat khác không bị ảnh hưởng, và lỗi được ghi log. (FR03, NFR07) |
| `EPIC-004-AC10` | **Given** chat gửi `/tinhieu eth`, **then** bot trả thay đổi 24h, 72h, vị trí trong khoảng 7 ngày, có dao động mạnh hay không, nhận định, lý do và câu miễn trừ. **Given** `/tinhieu xyzabc`, **then** thông báo coin không tồn tại của `/gia`. **Given** nguồn giá lỗi, **then** thông báo tạm thời không lấy được giá, không hiện số nào. (FR08, FR07) |
| `EPIC-004-AC11` | **Given** coin có lịch sử 5 ngày, **when** gõ `/tinhieu <coin>`, **then** hiện "chưa đủ dữ liệu" và không có nhận định mua/bán. (FR02, edge path) |
| `EPIC-004-AC12` | **Given** lịch sử BTC đủ 90 ngày trong đó quy tắc phát 6 tín hiệu mua có đủ 3 ngày để chấm, trong đó giá 3 ngày sau cao hơn ở 4 lần, và 5 tín hiệu bán, giá thấp hơn ở 2 lần, **when** gõ `/tinhieu backtest btc`, **then** bot báo 90 ngày, mua 6 lần đúng 4 (66,7%), bán 5 lần đúng 2 (40%), ghi chú xấp xỉ theo giá ngày, và câu miễn trừ. **Given** lịch sử ngắn hơn 14 ngày, **then** từ chối và giải thích. (FR10, FR07) |
| `EPIC-004-AC13` | **Given** bot đã gửi cho chat một nhận định "Cân nhắc mua" BTC ở giá 84.000, **when** 3 ngày sau BTC ở 90.000, **then** nhận định được chấm **đúng**; nếu ở 80.000 thì **sai**; trước 3 ngày thì thuộc số "chờ chấm". `/tinhieu thongke` khớp các con số đó. Cùng nhận định, cùng coin, cùng ngày được tính một lần. (FR11) |
| `EPIC-004-AC14` | **Given** chat gửi `/tinhieu tat`, **then** bot xác nhận và chat không nhận tin chủ động nữa, nhưng bản tin 9h vẫn có phần "Tín hiệu" và watchlist không đổi; `/tinhieu bat` bật lại; trạng thái còn nguyên sau khi bot khởi động lại. (FR13) |
| `EPIC-004-AC15` | **Given** nguồn giá lỗi trong một lượt kiểm tra, **then** không có tin nào gửi và log có một dòng ghi lượt lỗi; lượt kế tiếp chạy bình thường. **Given** một chat gửi tin thất bại, **then** chat khác trong cùng lượt vẫn nhận tin. (NFR07) |
| `EPIC-004-AC16` | **Given** một lượt kiểm tra với 50 chat và tổng 30 coin khác nhau, **then** nguồn giá được gọi ≤ 2 lần và Postgres không bị truy vấn trong lượt đó. (NFR03, NFR05) |
| `EPIC-004-AC17` | **Given** một chat dùng `/tinhieu` hoặc nhận tin tín hiệu, **then** sự kiện được ghi (chat, loại, thời điểm) và owner đếm được số chat ngoài owner dùng lại sau ngày đầu; log ứng dụng không chứa nhận định của chat. (FR12, NFR10) |
| `EPIC-004-AC18` | **Given** `/help`, **then** có liệt kê các lệnh `/tinhieu` kèm ví dụ; `docs/API.md` có các lệnh này. (FR14) |

## 7. Out of scope

- Phí hay gói trả phí; Monetization là phase sau (`intent.md` §6).
- Kênh khác ngoài Zalo (Telegram, Messenger); để cho Initiative 5.
- Coin ngoài watchlist của chat: không có tin chủ động và không có phần bản tin cho coin đó. Riêng `/tinhieu <coin>` do chính người dùng hỏi vẫn trả lời được cho coin hợp lệ bất kỳ.
- Chỉ báo kỹ thuật phức tạp (RSI, MACD, mô hình nến, học máy). Epic này chỉ dùng quy tắc dao động và vị trí trong khoảng giá.
- Tự động đặt lệnh mua/bán, kết nối sàn, mô phỏng lợi nhuận của một chiến lược (backtest chỉ chấm đúng/sai hướng giá sau 3 ngày, không tính lãi/lỗ hay phí).
- Cá nhân hoá ngưỡng theo từng chat (ngưỡng là cấu hình chung).
- Liên kết tín hiệu với danh mục (`/danhmuc`) như "bạn đang giữ coin này".
- Đo kết quả backtest như cam kết hiệu quả: bot không hứa nhận định sẽ đúng.

## 8. Concerns

| # | Concern | Needs | Resolution |
|---|---|---|---|
| 1 | Ngưỡng "dao động mạnh" (8%/24h, 15%/72h), cửa sổ "vài ngày" = 72 giờ và vùng 25% của khoảng 7 ngày do PO tự đề xuất, owner chưa xác nhận. Coin lớn và coin nhỏ có biến động khác nhau; ngưỡng chung có thể quá nhạy với coin nhỏ. | Thach | **Đề xuất, chờ duyệt**: dùng ngưỡng mặc định như FR01–FR02, chỉnh được bằng cấu hình. Backtest (FR10) cho owner dữ liệu để chỉnh sau. Không chặn duyệt spec. |
| 2 | Quy tắc mua khi giảm mạnh và gần đáy, bán khi tăng mạnh và gần đỉnh là chiến lược đảo chiều rất đơn giản. Trong thị trường có xu hướng mạnh, giá tiếp tục giảm/tăng nên nhận định có thể sai nhiều lần liên tiếp. | Thach | **Quyết định**: chấp nhận quy tắc đơn giản này cho epic đầu tiên vì giải thích được và kiểm chứng được. Bảng điểm (FR11) và backtest (FR10) hiển thị công khai độ đúng/sai thực tế thay vì che giấu. Nếu tỉ lệ đúng thấp, quy tắc là việc cải tiến của epic sau, không sửa trong epic này. |
| 3 | Đưa nhận định mua/bán cho người dùng có rủi ro trách nhiệm nội dung. Owner đã cho phép (`intent.md` Open Q1) nhưng chưa nói ai chịu trách nhiệm nếu chat khác dùng. | Thach | **Quyết định**: mọi tin có nhận định kèm câu miễn trừ cố định (FR07), gọi rõ là "tham khảo" và không dùng ngôn từ khẳng định ("nên", "chắc chắn"). Nếu mở cho người dùng ngoài owner mà cần xem xét pháp lý thì owner quyết trước khi ra mắt rộng. |
| 4 | Bật tin chủ động **mặc định** cho mọi chat đã đăng ký nghĩa là người dùng hiện có bỗng nhận tin họ chưa xin. Owner chỉ nói cho bản thân. | Thach | **Quyết định PO**: mặc định bật cho chat đã đăng ký, vì nhu cầu là báo bất thường; có `/tinhieu tat` (FR13) và giới hạn 1 tin/giờ (FR05) để giảm phiền. Chờ owner xác nhận; nếu muốn opt-in thì chỉ đổi mặc định. |
| 5 | Tính khả thi của lưu lịch sử giá (FR09) trong các gói miễn phí: cần độ phân giải theo giờ cho 3 ngày và theo ngày cho 90 ngày, đồng thời NFR05 cấm truy vấn Postgres mỗi lượt. Nguồn giá miễn phí có thể không cung cấp lịch sử sẵn để lấp quá khứ. | Engineer (bước plan) | **Hoãn có chủ**: plan phải chọn nơi lưu và cách lấp lịch sử ban đầu, và chứng minh NFR04–NFR05 giữ được. Nếu không lấp được quá khứ thì backtest chỉ chạy trên dữ liệu đã tích luỹ và ghi rõ số ngày (đã có trong edge path). |
| 6 | Giới hạn "1 tin mỗi giờ" của owner: áp dụng theo chat (spec chọn) hay theo từng coin. | Thach | **Quyết định PO**: theo chat, gộp nhiều coin vào một tin (FR05); thêm quy tắc không báo lặp theo coin (FR06) để cùng một biến động không gây tin mỗi giờ. |
| 7 | Tiêu chí thành công (≥ 1 chat ngoài owner dùng lại sau ngày đầu trong 30 ngày) là đề xuất ở `intent.md`, chưa được xác nhận riêng. | Thach | **Chờ xác nhận** khi duyệt spec; FR12 đo được nếu giữ tiêu chí này. |
| 8 | Backtest dùng giá theo ngày còn quy tắc thật dùng giá theo giờ, nên hai kết quả không hoàn toàn trùng khớp. | Thach | **Quyết định**: chấp nhận xấp xỉ, ghi rõ trong kết quả (FR10). |

---

*No implementation detail: no libraries, tables, endpoints or file layouts.*
