# Spec — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Owner:** Product Owner
**Status:** Approved (Thach, 2026-09-25)
**Created:** 2026-09-25
**Traces to:** `intent.md`

---

## 1. Overview

Cho phép một chat Zalo riêng (1-1 với bot) ghi lại từng lần mua/bán coin (số lượng, giá USD mỗi coin). Từ các giao dịch đó, bot cho biết danh mục đang giữ gồm những gì: tổng giá trị hiện tại (USD kèm ước tính VND), lãi/lỗ so với giá vốn, lãi/lỗ đã chốt từ các lần bán, và biến động giá trị danh mục trong 24 giờ. Người dùng xem khi tự hỏi, và nếu đã đăng ký bản tin thì cũng thấy trong bản tin 9h sáng. Mục tiêu là owner trả lời được câu "hôm nay mình đang thế nào" ngay trong Zalo, không phải mở 2–3 app sàn/ví rồi cộng nhẩm (`intent.md` §1, §2, §5). Tiêu chí thành công là `intent.md` §5: trong 30 ngày kể từ khi ra mắt, ≥ 1 chat không phải của owner ghi danh mục và vẫn dùng sau ngày đầu tiên. FR13 làm cho tiêu chí này đo được.

Dữ liệu được **người dùng tự nhập**. Việc tự lấy số dư hay lịch sử giao dịch từ sàn/ví nằm ngoài epic này. Đây là quyết định PO đưa ra thay owner theo `intent.md` Open Q1, chờ owner duyệt (§8 Concern 1).

## 2. Constraints applied

| Source | What it constrains |
|---|---|
| `CLAUDE.md` | Repo không có `CLAUDE.md`; dùng `docs/RULES.md` thay thế (giống EPIC-001/002). |
| `docs/RULES.md` | Quy trình thêm lệnh bot (parser → formatter thuần → nhánh xử lý trong controller → test bắt buộc, có e2e khi chạm dependency mới); cập nhật bảng lệnh trong `docs/API.md`; env var chỉ đọc qua `ConfigService`/`env.validation.ts`; Conventional Commits; nhánh `feature/*`, merge qua PR có CI xanh. |
| `docs/ARCHITECTURE.md` | Serverless: không có tiến trình chạy lâu, cache in-memory không đáng tin. Triết lý lỗi: bot không bao giờ im lặng, không lộ stack trace, `/webhook` và `/cron/*` trả `200` với lỗi nghiệp vụ. Bản tin xử lý từng subscriber độc lập, một người lỗi không kéo cả lượt lỗi theo. |
| `docs/API.md` + code hiện có (`command-parser.service.ts`, `format-message.util.ts`) | Cú pháp lệnh tiếng Việt, chấp nhận có dấu/không dấu, không phân biệt hoa thường (`/gia`, `/dangky`, `/canhbao`, `/canhbao xoa 2`). Giá hiển thị USD kèm `~…₫` theo **tỷ giá cố định** `USD_TO_VND_RATE`. Quy tắc số của `/canhbao`: `.` là dấu thập phân, `,` là phân cách hàng nghìn, không có hậu tố `100k`. Coin hợp lệ là mọi coin mà `/gia` tra được (CoinGecko, dự phòng CoinPaprika). Nguồn giá trả giá USD và % thay đổi 24h cho từng coin. |
| `docs/epics/EPIC-001` (subscribers, bản tin 9h) | Bản tin chạy một lần mỗi ngày cho các chat đã `/dangky`; `/huy` chỉ tắt bản tin. Watchlist tối đa 20 coin. |
| `docs/epics/EPIC-002/epic-memory.json` | Gói miễn phí của Postgres (Neon) có trần compute ~100 CU-h/tháng, nên truy vấn liên tục (mỗi phút) sẽ vượt trần. `chat.id` tối đa 64 ký tự; mọi input người dùng được lưu phải có giới hạn. Bài học: log chỉ ghi thành công thì không phân biệt được "không chạy" với "chạy mà hỏng". |
| `docs/epics/EPIC-001/artifacts/review.md` finding #3 | Giới hạn độ dài/kích thước cho mọi đường ghi mới. |
| `.aidlc/workspace.yaml` (`risk-security-reviewer`) | Epic có dữ liệu mới là **dữ liệu tài chính cá nhân**, và có đường ghi do người dùng kiểm soát, nên áp dụng kiểm tra trust boundary, quyền riêng tư và chống lạm dụng. |
| Gói Vercel **Hobby** | Không đòi hỏi gói hay dịch vụ trả phí mới. |
| Webhook payload (`zalo-webhook.interface.ts`) | Payload có `chat.chat_type` (`PRIVATE` / `GROUP`) nhưng là trường tuỳ chọn (xem §8 Concern 4). |

## 3. User scenarios

### 3.1 Primary flow

- **Given** một chat riêng chưa có giao dịch nào, **when** gửi `/danhmuc mua btc 0.5 60000`, **then** bot ghi giao dịch mua 0,5 BTC giá 60.000 USD/BTC và xác nhận: số thứ tự giao dịch, coin, số lượng, giá, số BTC đang giữ và giá vốn trung bình mới.
- **Given** chat đó mua thêm `/danhmuc mua btc 0.5 70000`, **then** chat giữ 1 BTC với giá vốn trung bình 65.000 USD.
- **Given** chat đó bán `/danhmuc ban btc 0.4 80000`, **then** bot ghi giao dịch bán, số BTC còn 0,6, giá vốn trung bình vẫn 65.000, và lãi đã chốt là 0,4 × (80.000 − 65.000) = 6.000 USD.
- **Given** chat có danh mục, **when** gửi `/danhmuc`, **then** bot trả về:
  - mỗi coin đang giữ một dòng: số lượng, giá hiện tại, giá trị (USD và ~VND), lãi/lỗ chưa chốt (số tiền và %);
  - tổng giá trị danh mục (USD và ~VND);
  - tổng lãi/lỗ chưa chốt (số tiền và % trên giá vốn còn giữ);
  - tổng lãi/lỗ đã chốt;
  - biến động giá trị danh mục trong 24h (số tiền và %).
- **Given** chat có danh mục và đã `/dangky`, **when** bản tin 9h sáng được gửi, **then** bản tin có thêm một phần tóm tắt danh mục: tổng giá trị, lãi/lỗ chưa chốt, biến động 24h.
- **Given** chat có giao dịch, **when** gửi `/danhmuc lichsu`, **then** bot liệt kê các giao dịch (số thứ tự, mua/bán, coin, số lượng, giá, ngày ghi), mới nhất trước.
- **Given** giao dịch số 3 bị nhập sai, **when** gửi `/danhmuc xoa 3`, **then** giao dịch đó bị xoá, danh mục được tính lại từ các giao dịch còn lại, và bot xác nhận kèm danh mục của coin đó sau khi xoá.

### 3.2 Edge and error paths

- **Danh mục trống**: `/danhmuc` khi chưa có giao dịch thì trả lời trống, kèm ví dụ cách ghi giao dịch mua.
- **Bán nhiều hơn số đang giữ**: `/danhmuc ban btc 2 80000` khi chỉ giữ 0,6 BTC thì bị từ chối, bot nói rõ số đang giữ. Không ghi gì.
- **Xoá một giao dịch mua làm số dư âm**: nếu xoá giao dịch mua khiến một lần bán sau đó thành bán quá số đang giữ, bot từ chối xoá và giải thích (xoá giao dịch bán trước).
- **Bán hết**: coin có số lượng 0 không hiện trong danh sách đang giữ, nhưng lãi/lỗ đã chốt của coin đó vẫn được tính vào tổng.
- **Coin không hỗ trợ**: `/danhmuc mua xyzabc 10 1` bị từ chối với cùng thông báo "coin không tồn tại" mà `/gia` đang dùng.
- **Sai cú pháp**: thiếu số lượng hoặc giá, số âm hoặc bằng 0, quá nhiều số lẻ, hậu tố `k`. Bot từ chối kèm ví dụ cú pháp đúng, không trả lời lỗi chung chung.
- **Nguồn giá lỗi khi xem `/danhmuc`**: bot trả lời rằng tạm thời không lấy được giá, dùng thông báo đang có của `/gia`. Không hiện con số sai, không hiện 0.
- **Nguồn giá chỉ trả về một phần coin**: coin có giá thì tính bình thường. Coin thiếu giá hiện "không có giá lúc này" và **không** được cộng vào tổng; tổng ghi rõ là đã loại trừ các coin đó.
- **Không có % 24h cho một coin** (nguồn giá trả `null`): biến động 24h của danh mục chỉ tính trên các coin có số liệu và ghi chú như trên.
- **Vượt giới hạn**: quá 200 giao dịch hoặc quá 20 coin khác nhau đang giữ trong một chat thì từ chối ghi thêm, kèm giới hạn.
- **Lệnh danh mục trong nhóm chat**: bot từ chối và hướng dẫn nhắn riêng cho bot, để số liệu tài chính không hiện cho cả nhóm (§8 Concern 3).
- **Database lỗi khi người dùng gửi lệnh**: bot vẫn trả `200` và trả lời thân thiện theo triết lý lỗi hiện có; không có giao dịch "ghi một nửa".
- **Bản tin 9h khi danh mục lỗi** (nguồn giá hoặc database): phần giá watchlist vẫn được gửi bình thường, phần danh mục bị bỏ hoặc ghi "tạm thời không có số liệu". Lỗi của một chat không chặn chat khác.
- **Chat gửi `/huy`**: bản tin tắt, danh mục và giao dịch vẫn còn nguyên, `/danhmuc` vẫn dùng được.
- **Hai lệnh ghi gần như đồng thời từ cùng một chat** (ví dụ gửi hai lần vì mạng chậm): mỗi lệnh là một giao dịch riêng, danh mục luôn bằng tổng của các giao dịch đã ghi, không có số lượng bị tính sai.

## 4. Functional requirements

| Id | Requirement | Priority | Traces to |
|---|---|---|---|
| `EPIC-003-FR01` | `/danhmuc mua <coin> <số lượng> <giá>` và `/danhmuc ban <coin> <số lượng> <giá>` ghi một giao dịch mua/bán cho chat gửi lệnh. `<giá>` là giá USD của **một** coin. Tên lệnh và từ khoá chấp nhận có dấu/không dấu và không phân biệt hoa thường (`/danhmục`, `mua`, `bán`/`ban`), cùng alias tiếng Anh `/portfolio buy|sell`. | Must | intent §1; Open Q2 (theo từng lần mua/bán) |
| `EPIC-003-FR02` | Số lượng và giá là số dương, theo đúng quy tắc số của `/canhbao`: `.` là dấu thập phân, `,` là phân cách hàng nghìn, không có hậu tố `k`/`m`. Số lượng tối đa 8 chữ số thập phân; giá tuân theo cùng khoảng và độ chính xác của mức giá `/canhbao`. | Must | intent §5 (con số phải khớp) |
| `EPIC-003-FR03` | Coin hợp lệ là mọi coin mà `/gia` tra được tại thời điểm ghi. Coin khác bị từ chối với thông báo coin không tồn tại của `/gia`. | Must | intent Open Q7 |
| `EPIC-003-FR04` | Lệnh bán bị từ chối nếu số lượng bán lớn hơn số đang giữ của coin đó trong chat. | Must | intent §5 |
| `EPIC-003-FR05` | Giá vốn tính theo phương pháp **giá vốn trung bình gia quyền**. Mua: giá vốn trung bình = (giá trị vốn đang giữ + số lượng × giá) / số lượng mới. Bán: giá vốn trung bình không đổi; lãi/lỗ đã chốt += số lượng bán × (giá bán − giá vốn trung bình). Khi số dư về 0 thì giá vốn đặt lại. Kết quả không phụ thuộc thời điểm tính: xoá hay thêm giao dịch thì danh mục được tính lại từ đầu, theo thứ tự ghi. | Must | intent Open Q2 (cách suy ra giá vốn để spec quyết) — §8 Concern 2 |
| `EPIC-003-FR06` | `/danhmuc` (không tham số) trả về danh mục như §3.1: từng coin đang giữ (số lượng, giá hiện tại, giá trị USD + ~VND, lãi/lỗ chưa chốt số tiền + %), tổng giá trị, tổng lãi/lỗ chưa chốt (số tiền và % trên giá vốn còn giữ), tổng lãi/lỗ đã chốt, và biến động 24h của danh mục. Danh mục trống thì trả lời trống kèm ví dụ. | Must | intent §1, §5 |
| `EPIC-003-FR07` | Biến động 24h của danh mục = giá trị hiện tại − giá trị các coin đang giữ tính theo giá 24 giờ trước. Giá 24 giờ trước suy từ % thay đổi 24h của nguồn giá. Hiển thị số tiền (USD + ~VND) và %. Số lượng đang giữ lấy theo hiện tại, tức không tính ảnh hưởng của giao dịch ghi trong 24h qua. | Must | intent §1 ("tăng hay giảm bao nhiêu so với hôm qua") — §8 Concern 5 |
| `EPIC-003-FR08` | Mọi số tiền hiển thị bằng USD kèm ước tính VND (`~…₫`) theo cùng tỷ giá và cùng định dạng số mà `/gia` đang dùng. Lãi/lỗ có dấu `+`/`−` và biểu tượng tăng/giảm giống `/gia`. | Must | intent Open Q4 (VND và USD) |
| `EPIC-003-FR09` | `/danhmuc lichsu` liệt kê giao dịch của chat, mới nhất trước: số thứ tự, mua/bán, coin, số lượng, giá, ngày ghi (giờ Việt Nam). Tối đa 20 giao dịch mỗi tin; `/danhmuc lichsu <trang>` xem trang tiếp. Số thứ tự ổn định: không đổi khi thêm giao dịch mới. | Must | intent §5 (owner đối chiếu được) |
| `EPIC-003-FR10` | `/danhmuc xoa <số>` xoá giao dịch theo số thứ tự trong `lichsu`, chỉ xoá được giao dịch của chính chat đó. Bị từ chối nếu sau khi xoá, một lần bán nào đó thành bán quá số đang giữ (FR04). | Must | intent §5 (sửa khi nhập sai) |
| `EPIC-003-FR11` | Chat đang đăng ký bản tin và có ít nhất một coin đang giữ nhận thêm một phần danh mục trong bản tin 9h: tổng giá trị, lãi/lỗ chưa chốt, biến động 24h. Chat chưa đăng ký không nhận thêm tin nào. Chat đã đăng ký nhưng danh mục trống thì nhận bản tin như hiện nay. | Must | intent Open Q3 (khi tự hỏi và trong bản tin 9h) |
| `EPIC-003-FR12` | Các lệnh danh mục chỉ dùng được trong chat riêng với bot. Trong nhóm chat, bot từ chối kèm hướng dẫn nhắn riêng, và phần danh mục không được thêm vào bản tin của nhóm. | Must | intent Open Q6 — §8 Concern 3 |
| `EPIC-003-FR13` | Mỗi lần một chat ghi giao dịch hoặc xem danh mục đều được ghi lại, gồm chat và thời điểm, không gồm số liệu tài chính. Nhờ vậy owner đếm được "số chat không phải owner có danh mục và vẫn dùng sau ngày đầu tiên" (intent §5) mà không phải hỏi người dùng. | Must | intent §5 (tiêu chí thành công) |
| `EPIC-003-FR14` | `/danhmuc xoahet` xoá toàn bộ giao dịch của chat, sau khi chat xác nhận bằng `/danhmuc xoahet xacnhan`. Không xác nhận thì không xoá gì. | Should | intent Open Q6 (dữ liệu tài chính cá nhân — người dùng tự xoá được) |
| `EPIC-003-FR15` | `/help` liệt kê lệnh `/danhmuc` kèm ví dụ, và `docs/API.md` được cập nhật. | Should | `docs/RULES.md` |

## 5. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| `EPIC-003-NFR01` | Độ chính xác tính toán | Tổng giá trị, giá vốn và lãi/lỗ khớp với tính tay bằng cùng giá nguồn tới **0,01 USD** trên danh mục ≤ 20 coin / 200 giao dịch. Không có sai số tích luỹ khi thêm/xoá giao dịch. |
| `EPIC-003-NFR02` | Thời gian phản hồi | `/danhmuc` trả lời trong **≤ 5 giây p95** (tính cả gọi nguồn giá) với danh mục 20 coin / 200 giao dịch. |
| `EPIC-003-NFR03` | Dùng quota nguồn giá | Một lần xem `/danhmuc` gọi nguồn giá **≤ 2 lần**, không phụ thuộc số giao dịch. Bản tin 9h không gọi thêm lần nào cho danh mục mỗi chat, ngoài các lần đã gọi cho watchlist và các coin đang giữ của chat đó. |
| `EPIC-003-NFR04` | Chi phí / tải cơ sở dữ liệu | Không yêu cầu gói hay dịch vụ trả phí mới. Dữ liệu danh mục chỉ được đọc/ghi khi người dùng gửi lệnh và một lần mỗi ngày cho bản tin. **Không** có truy vấn định kỳ nào khác, để giữ trong trần compute miễn phí của cơ sở dữ liệu (xem §2). |
| `EPIC-003-NFR05` | Giới hạn input được lưu | `chat.id` tối đa **64 ký tự**; ký hiệu coin tối đa **20 ký tự**; tối đa **200 giao dịch** và **20 coin khác nhau đang giữ** mỗi chat; số lượng trong khoảng (0, 10^12] với tối đa 8 chữ số thập phân. Ngoài giới hạn thì từ chối. |
| `EPIC-003-NFR06` | Quyền riêng tư | Một chat chỉ đọc, sửa, xoá được giao dịch của chính mình. Số lượng, giá và lãi/lỗ **không** được ghi vào log ứng dụng. Log chỉ ghi chat, loại lệnh và kết quả. Dữ liệu danh mục không được dùng cho mục đích nào khác ngoài trả lời chính chat đó. |
| `EPIC-003-NFR07` | Tính toàn vẹn | Một lệnh ghi hoặc xoá hoặc thành công trọn vẹn, hoặc không thay đổi gì. Các lệnh đồng thời của cùng một chat không làm sai số dư (§3.2). |
| `EPIC-003-NFR08` | Cô lập lỗi trong bản tin | Lỗi tính danh mục của một chat, dù do nguồn giá hay dữ liệu, không làm hỏng phần giá watchlist của chat đó, và không chặn chat khác trong cùng lượt bản tin. |
| `EPIC-003-NFR09` | Khả năng quan sát | Mỗi lượt bản tin ghi một dòng log có cấu trúc gồm số chat có phần danh mục, số chat phần danh mục lỗi, và thời gian. Ghi cả **lỗi**, không chỉ thành công (bài học từ EPIC-002). |
| `EPIC-003-NFR10` | Chống lạm dụng lệnh | `/danhmuc` chịu giới hạn tần suất theo chat hiện có (`UserThrottlerGuard`); cùng với NFR05 là đủ ở quy mô hiện tại. |

## 6. Acceptance criteria

| Id | Given / When / Then |
|---|---|
| `EPIC-003-AC01` | **Given** chat riêng chưa có giao dịch, **when** gửi `/danhmuc mua btc 0.5 60000`, **then** giao dịch được ghi, và bot xác nhận kèm số thứ tự, 0,5 BTC, giá 60.000, số đang giữ 0,5 và giá vốn trung bình 60.000. (FR01) |
| `EPIC-003-AC02` | **Given** AC01, **when** gửi `/danhmuc mua btc 0.5 70000`, **then** số đang giữ là 1 BTC với giá vốn trung bình 65.000; **when** gửi `/danhmuc ban btc 0.4 80000`, **then** số đang giữ là 0,6 BTC, giá vốn trung bình vẫn 65.000 và lãi đã chốt là +6.000 USD. (FR05) |
| `EPIC-003-AC03` | **Given** chat giữ 0,6 BTC (giá vốn 65.000) và 10 ETH (giá vốn 2.000), đã chốt +6.000 USD, BTC hiện 70.000 (+2% 24h), ETH hiện 2.500 (−5% 24h), **when** gửi `/danhmuc`, **then** tổng giá trị = 42.000 + 25.000 = **67.000 USD**, lãi chưa chốt = +3.000 + 5.000 = **+8.000 USD (+13,56%** trên giá vốn 59.000), đã chốt **+6.000 USD**, biến động 24h ≈ (42.000 − 42.000/1,02) + (25.000 − 25.000/0,95) ≈ +823,53 − 1.315,79 = **−492,26 USD**. Mọi số tiền có kèm ~VND theo `USD_TO_VND_RATE`. (FR06, FR07, FR08, NFR01) |
| `EPIC-003-AC04` | **Given** chat giữ 0,6 BTC, **when** gửi `/danhmuc ban btc 2 80000`, **then** bị từ chối, bot nêu số đang giữ 0,6, và không có giao dịch nào được ghi. (FR04) |
| `EPIC-003-AC05` | **When** gửi `/danhmuc mua btc 0.5`, `/danhmuc mua btc -1 60000`, `/danhmuc mua btc 0.5 60k`, `/danhmuc mua btc 0.123456789 60000` hoặc `/danhmuc mua btc 0.5 0`, **then** mỗi lệnh bị từ chối kèm ví dụ cú pháp đúng, không ghi gì. **When** gửi `/danhmuc mua btc 1 60,000.5`, **then** được hiểu là giá 60000,5. (FR02, NFR05) |
| `EPIC-003-AC06` | **When** gửi `/danhmuc mua xyzabc 10 1`, **then** bị từ chối với thông báo coin không tồn tại giống `/gia`. (FR03) |
| `EPIC-003-AC07` | **Given** chat chưa có giao dịch, **when** gửi `/danhmuc`, **then** bot trả lời danh mục trống kèm ví dụ `/danhmuc mua btc 0.5 60000`. (FR06) |
| `EPIC-003-AC08` | **Given** chat có 3 giao dịch, **when** gửi `/danhmuc lichsu`, **then** thấy đủ 3 giao dịch, mới nhất trước, mỗi dòng có số thứ tự, mua/bán, coin, số lượng, giá, ngày; **when** ghi thêm giao dịch thứ 4, **then** số thứ tự của 3 giao dịch cũ không đổi. (FR09) |
| `EPIC-003-AC09` | **Given** chat A (mua 1 BTC = #1, bán 0,5 BTC = #2) và chat B có giao dịch, **when** A gửi `/danhmuc xoa 1`, **then** bị từ chối vì #2 sẽ thành bán quá số giữ; **when** A gửi `/danhmuc xoa 2`, **then** #2 bị xoá, A giữ lại 1 BTC, và giao dịch của B không bị ảnh hưởng; **when** A gửi `/danhmuc xoa 99`, **then** bot trả lời không tìm thấy. (FR10, NFR06) |
| `EPIC-003-AC10` | **Given** chat A đã `/dangky` và giữ BTC, chat B đã `/dangky` nhưng danh mục trống, chat C có danh mục nhưng chưa `/dangky`, **when** bản tin 9h chạy, **then** A nhận bản tin kèm phần danh mục (tổng giá trị, lãi/lỗ chưa chốt, biến động 24h), B nhận bản tin như hiện nay, C không nhận tin nào. (FR11) |
| `EPIC-003-AC11` | **Given** bản tin 9h chạy mà việc tính danh mục của chat A lỗi, **then** A vẫn nhận phần giá watchlist, chat khác vẫn nhận bản tin đầy đủ, và lượt bản tin ghi log có số chat phần danh mục bị lỗi. (NFR08, NFR09) |
| `EPIC-003-AC12` | **Given** một nhóm chat (`chat_type` là nhóm), **when** thành viên gửi `/danhmuc` hoặc `/danhmuc mua btc 1 60000`, **then** bot từ chối kèm hướng dẫn nhắn riêng, và không ghi gì. (FR12) |
| `EPIC-003-AC13` | **Given** nguồn giá lỗi hoặc timeout, **when** chat gửi `/danhmuc`, **then** bot trả lời "tạm thời không lấy được giá", không hiện số 0 hay số sai, và webhook vẫn trả `200`. **Given** nguồn giá chỉ trả về BTC mà không có ETH, **then** dòng ETH ghi "không có giá lúc này", còn tổng chỉ gồm BTC và ghi chú rõ đã loại trừ ETH. (edge path) |
| `EPIC-003-AC14` | **Given** chat có 200 giao dịch, **when** ghi giao dịch thứ 201, **then** bị từ chối kèm giới hạn. **Given** chat đang giữ 20 coin khác nhau, **when** mua một coin thứ 21, **then** bị từ chối kèm giới hạn. (NFR05) |
| `EPIC-003-AC15` | **Given** chat có giao dịch, **when** gửi `/danhmuc xoahet`, **then** không xoá gì, và bot yêu cầu xác nhận bằng `/danhmuc xoahet xacnhan`; **when** gửi lệnh xác nhận, **then** mọi giao dịch của chat bị xoá và `/danhmuc` trả về trống. (FR14) |
| `EPIC-003-AC16` | **Given** các lệnh `/danhmuc` đã chạy (ghi, xem, xoá), **when** đọc log ứng dụng, **then** log không chứa số lượng, giá hay lãi/lỗ nào. Bản ghi sử dụng (FR13) có chat và thời điểm, và đếm được số chat khác owner đã dùng sau ngày đầu tiên. (NFR06, FR13) |
| `EPIC-003-AC17` | **Given** danh mục 20 coin / 200 giao dịch, **when** gửi `/danhmuc`, **then** nguồn giá được gọi ≤ 2 lần và trả lời trong ≤ 5 giây p95 (đo trên production hoặc môi trường tương đương). (NFR02, NFR03) |
| `EPIC-003-AC18` | **Given** chat có danh mục, **when** gửi `/huy`, **then** `/danhmuc` vẫn trả về danh mục đầy đủ, và bản tin 9h không còn gửi tới chat đó. (edge path) |
| `EPIC-003-AC19` | **Given** cùng một chat gửi hai lệnh `/danhmuc mua btc 1 60000` gần như cùng lúc, **then** có đúng 2 giao dịch được ghi và số đang giữ là 2 BTC. **Given** database lỗi giữa chừng một lệnh ghi, **then** không có giao dịch dở dang nào, và bot trả lời lỗi thân thiện. (NFR07) |
| `EPIC-003-AC20` | **Given** bản deploy production, **when** owner so tổng giá trị `/danhmuc` với tổng tự cộng từ các app sàn/ví tại cùng thời điểm, **then** hai số lệch nhau không quá chênh lệch giá giữa nguồn giá của bot và giá của sàn (owner chấp nhận khi duyệt; kiểm tra thủ công, `intent.md` §5). |

## 7. Out of scope

- **Tự động lấy số dư hoặc lịch sử giao dịch từ sàn/ví** (khoá API, địa chỉ ví, đọc chain). Có thể làm ở epic sau, nếu dữ liệu sử dụng cho thấy việc nhập tay là rào cản (§8 Concern 1).
- Phí giao dịch, phí rút, thuế, và báo cáo thuế.
- Nhập giá hoặc số lượng theo VND hay đơn vị khác ngoài USD.
- Ghi ngày giao dịch trong quá khứ. Ngày của giao dịch là ngày ghi.
- Phương pháp giá vốn khác (FIFO, LIFO) hoặc cho người dùng tự chọn phương pháp.
- Sửa một giao dịch có sẵn: muốn đổi thì xoá rồi ghi lại.
- Tỷ giá USD/VND thời gian thực. Vẫn dùng tỷ giá cố định hiện có.
- Danh mục chung cho nhóm chat; danh mục theo từng thành viên trong nhóm.
- Nhập hoặc xuất file (CSV, Excel).
- Biểu đồ, lịch sử giá trị danh mục theo ngày, và so sánh với "giá trị lúc 9h hôm qua" (FR07 dùng cửa sổ 24h trượt).
- Cảnh báo theo giá trị danh mục ("báo khi danh mục giảm 10%"). Có thể là phần mở rộng của cảnh báo giá.
- Tư vấn đầu tư, khuyến nghị mua/bán (intent §6; Initiative 4).
- Gói trả phí và giới hạn theo gói (intent §6).
- Kênh khác ngoài Zalo (intent §6; Initiative 5).
- Coin không có trên nguồn giá của bot (token nhỏ, token trên chain khác): không ghi được (FR03).

## 8. Concerns

| # | Concern | Needs | Resolution |
|---|---|---|---|
| 1 | `intent.md` Open Q1: nhập tay hay tự lấy dữ liệu từ sàn/ví. Intent ghi rằng chỉ tự lấy mới giải quyết triệt để "phải mở nhiều nơi". Nhưng tự lấy thì phải giữ khoá API hoặc quyền đọc tài khoản sàn, tức một trust boundary mới với rủi ro mất tiền nếu lộ. Nó còn cần tích hợp riêng cho từng sàn/ví, và một tiến trình đồng bộ định kỳ, đi ngược NFR04. | Originator (Thach) | **Quyết định PO, chờ owner duyệt:** epic này dùng **nhập tay** từng giao dịch (FR01). Owner vẫn phải nhập khi có giao dịch, nhưng không phải mở app để *xem*, nên vẫn giải quyết được §1 cho quy mô dưới 20 coin, 2–3 nơi. Tự đồng bộ để epic sau (§7), và chỉ làm khi FR13 cho thấy có người dùng thật. Owner có thể đảo quyết định này khi duyệt spec. |
| 2 | `intent.md` Open Q2 để spec chọn cách suy ra giá vốn. FIFO chính xác hơn về thuế, nhưng khó giải thích trong một tin chat. Ngoài ra kết quả của FIFO phụ thuộc lô, nên xoá một giao dịch có thể làm đổi lãi/lỗ đã chốt của nhiều lần bán. | Product Owner | **Đã chốt:** giá vốn trung bình gia quyền (FR05). Đây là cách các app sàn thường hiển thị ("giá trung bình"), nên AC20 (owner đối chiếu với app sàn) dễ đạt hơn. FIFO nằm trong §7. |
| 3 | `intent.md` Open Q6 (quyền riêng tư trong nhóm chat) chưa có câu trả lời. Dữ liệu gắn theo chat, nên trong nhóm thì ai cũng thấy và sửa được danh mục chung, và số liệu tài chính của một người sẽ hiện cho cả nhóm. | Originator (Thach) | **Mặc định PO, chờ owner duyệt:** chỉ chat riêng (FR12, AC12), cộng với việc log không chứa số liệu tài chính (NFR06) và có lệnh tự xoá hết (FR14). Nếu owner muốn cho nhóm dùng thì đảo FR12 ở lần duyệt spec. |
| 4 | FR12 dựa vào việc biết chat là riêng hay nhóm. Trường `chat.chat_type` trong payload Zalo là tuỳ chọn, và chưa được kiểm chứng với tin nhắn nhóm thật (API.md chỉ ghi nhận `PRIVATE`). | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** `plan.md` phải nêu cách xác định chat nhóm và hành vi khi không xác định được. Mặc định an toàn là coi như nhóm và từ chối, nhưng phải kiểm chứng rằng chat riêng thật luôn được nhận ra, để owner không bị chặn. |
| 5 | Intent §1 nói "so với hôm qua". Nguồn giá chỉ cho % thay đổi 24h trượt, và bot không lưu lịch sử giá trị danh mục. FR07 cũng bỏ qua giao dịch trong 24h qua. | Product Owner | **Đã chốt:** "hôm qua" = 24h trượt, tính trên số lượng đang giữ hiện tại (FR07). Cách này khớp với cột % 24h mà `/gia` và bản tin đang hiển thị, và không cần lưu thêm dữ liệu định kỳ (NFR04). So với mốc 9h hôm qua nằm trong §7. |
| 6 | VND là ước tính theo tỷ giá cố định (`USD_TO_VND_RATE`). Lãi/lỗ theo VND vì thế không phản ánh biến động tỷ giá, trong khi owner có thể nghĩ về vốn bằng VND. | Originator (Thach) | **Đã chốt theo hành vi hiện có:** VND luôn hiện dưới dạng ước tính `~…₫`, giống `/gia` (FR08). Nếu owner cần lãi/lỗ theo VND thực, đó là một epic riêng về tỷ giá (§7). |
| 7 | Nơi lưu dữ liệu. Postgres hiện có bị giới hạn compute miễn phí; Redis hiện có thì có quota lệnh. Epic này thêm dữ liệu quan trọng, lâu dài, cần tính toàn vẹn (NFR07). | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Ràng buộc bằng NFR04 (chỉ đọc/ghi theo lệnh và một lần mỗi ngày) và NFR07. `plan.md` phải ước tính tải mỗi tháng so với trần miễn phí của store được chọn. |
| 8 | Bản tin 9h hiện tính giá theo watchlist của từng chat. Phần danh mục cần giá cả của các coin đang giữ nằm ngoài watchlist, nên có thể làm tăng số lần gọi nguồn giá trong lượt bản tin. | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Ràng buộc bằng NFR03 và NFR08. |
| 9 | `intent.md` Open Q5 (mỗi lần kiểm tra danh mục hôm nay mất bao nhiêu phút) chưa có số liệu, nên chưa đo được "đỡ thời gian". | Originator (Thach) | **Hoãn, owner: originator.** Không chặn spec, vì tiêu chí thành công đã chốt ở intent §5 là việc sử dụng (FR13), không phải thời gian. Nên ghi con số này vào `intent.md` §3 trước khi ra mắt để có mốc so sánh. |
| 10 | `intent.md` Open Q7 (coin không có nguồn giá) giao cho spec. | Product Owner | **Đã chốt:** không ghi được coin mà `/gia` không tra được (FR03). Coin từng có giá nhưng tạm thời thiếu giá thì hiện "không có giá lúc này" và bị loại khỏi tổng kèm ghi chú (AC13). Token ngoài nguồn giá nằm trong §7. |

---

*No implementation detail: no libraries, tables, endpoints or file layouts.*
