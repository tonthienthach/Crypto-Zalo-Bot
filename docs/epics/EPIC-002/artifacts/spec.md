# Spec — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Owner:** Product Owner
**Status:** Draft
**Created:** 2026-09-23
**Traces to:** `intent.md`

---

## 1. Overview

Cho phép bất kỳ chat Zalo nào đặt cảnh báo khi giá một coin vượt lên trên hoặc
rơi xuống dưới một mức giá USD. Bot kiểm tra giá định kỳ khoảng mỗi phút và gửi
tin nhắn khi giá vượt mức. Sau đó cảnh báo tự bật lại khi giá quay về phía ban
đầu. Mục tiêu là subscriber không còn phải tự hỏi giá liên tục hoặc chờ bản tin
9h sáng mới biết giá đã chạm mức (`intent.md` §1, §2). Tiêu chí thành công là
`intent.md` §5: trong 30 ngày có ít nhất một cảnh báo của chat khác (không phải
chủ dự án) được gửi đúng, và độ trễ nằm trong ngưỡng đã chốt ở §8 Concern 1.

## 2. Constraints applied

| Source | What it constrains |
|---|---|
| `CLAUDE.md` | Repo không có `CLAUDE.md`; dùng `docs/RULES.md` thay thế (giống EPIC-001). |
| `docs/RULES.md` | Quy trình thêm lệnh bot (parser → formatter thuần → nhánh `switch` trong controller → test bắt buộc, gồm e2e khi lệnh chạm dependency mới); cập nhật bảng lệnh trong `docs/API.md`; env var chỉ đọc qua `ConfigService`/`env.validation.ts`; Conventional Commits; làm trên nhánh `feature/*` và merge qua PR. |
| `docs/ARCHITECTURE.md` | Kiến trúc serverless, không có tiến trình chạy lâu và cache in-memory không đáng tin (§"Why serverless", §"best-effort cache"). Triết lý xử lý lỗi: bot không bao giờ im lặng, không bao giờ lộ stack trace, `/webhook*` và `/cron/*` luôn trả `200`. Endpoint do máy gọi phải có guard dùng secret riêng, giống `CronSecretGuard`. Mỗi subscriber được xử lý độc lập để một người lỗi không kéo cả lượt chạy lỗi theo. |
| `docs/API.md` | Cú pháp lệnh hiện có (`/gia`, `/dangky`, `/huy`, `/watchlist`); giá hiển thị bằng USD kèm ước tính VND; nguồn giá CoinGecko, dự phòng CoinPaprika. |
| `docs/ROADMAP.md` Initiative 2 | Phác thảo lệnh `/canhbao btc > 100000` và việc kiểm tra định kỳ; phụ thuộc lớp lưu trữ của Initiative 1. |
| `docs/epics/EPIC-001/artifacts/review.md` | Finding #3: `chat.id` được lưu mà không giới hạn độ dài. Epic này lưu thêm dữ liệu gắn với `chat.id`, nên mọi input người dùng được lưu phải có giới hạn. |
| `docs/epics/EPIC-001/epic-memory.json` | Bài học: phải chạy thử script/driver thật, không chỉ chạy câu SQL; phải chạy đủ bộ unit + e2e + build trước khi coi là xong. |
| `.aidlc/workspace.yaml` (`risk-security-reviewer`) | Epic có dữ liệu lưu trữ mới, một đường ghi mới do người dùng kiểm soát và một endpoint mới do máy gọi, nên áp dụng kiểm tra trust boundary và chống lạm dụng. |
| Gói Vercel **Hobby** (originator xác nhận 2026-09-23) | Vercel Cron trên Hobby không chạy được mỗi phút, còn epic này không được đòi hỏi nâng lên gói trả phí (xem §8 Concern 2). |

## 3. User scenarios

### 3.1 Primary flow

- **Given** một chat bất kỳ, **when** gửi `/canhbao btc > 100000` trong lúc giá
  BTC đang dưới 100.000 USD, **then** bot tạo cảnh báo và trả lời xác nhận kèm
  số thứ tự của cảnh báo, điều kiện và giá hiện tại.
- **Given** cảnh báo đó đang bật, **when** một lượt kiểm tra thấy giá BTC
  ≥ 100.000 USD, **then** chat nhận được tin báo gồm coin, điều kiện, mức giá và
  giá hiện tại. Cảnh báo chuyển sang trạng thái "đã báo" và không báo lại trong
  lúc giá còn ở phía trên.
- **Given** cảnh báo đang ở trạng thái "đã báo", **when** giá quay về dưới mức
  và vượt khỏi vùng đệm chống nhiễu (§4 FR06), **then** cảnh báo tự bật lại mà
  không gửi tin. Lần sau giá vượt lên, chat lại được báo.
- **Given** một chat có cảnh báo, **when** gửi `/canhbao`, **then** bot trả về
  danh sách cảnh báo của chat đó, mỗi dòng gồm số thứ tự, coin, điều kiện và
  trạng thái (đang canh / đã báo).
- **Given** một chat có cảnh báo số 2, **when** gửi `/canhbao xoa 2`, **then**
  cảnh báo đó bị xoá và bot xác nhận.

### 3.2 Edge and error paths

- **Điều kiện đã đúng ngay lúc đặt**: đặt `btc > 100000` khi BTC đang ở
  110.000. Bot từ chối tạo cảnh báo và trả lời rằng điều kiện đã thoả, kèm giá
  hiện tại. Không báo ngay rồi gây nhầm lẫn.
- **Coin không hỗ trợ** (cả CoinGecko lẫn CoinPaprika không nhận ra): từ chối
  với cùng thông báo "coin không tồn tại" mà `/gia` đang dùng.
- **Sai cú pháp** (thiếu toán tử, mức giá không phải số, giá ≤ 0, quá nhiều số
  lẻ): từ chối và trả lời kèm một ví dụ cú pháp đúng. Không trả lời lỗi chung
  chung.
- **Vượt giới hạn**: chat đã có 10 cảnh báo mà đặt thêm cái thứ 11 thì bị từ
  chối, bot nói rõ giới hạn là 10 và cách xoá bớt.
- **Xoá số không tồn tại** (`/canhbao xoa 99`): trả lời không tìm thấy, không
  xoá gì.
- **`/canhbao` khi chưa có cảnh báo nào**: trả lời danh sách trống kèm ví dụ
  cách đặt.
- **Nguồn giá lỗi hoặc timeout trong một lượt kiểm tra**: bỏ qua lượt đó, không
  gửi cảnh báo sai và không đổi trạng thái cảnh báo nào. Lượt sau thử lại.
- **Nguồn giá chỉ trả về một phần coin**: coin nào có giá thì xử lý bình
  thường, coin nào thiếu giá thì giữ nguyên trạng thái.
- **Gửi tin Zalo thất bại**: cảnh báo không bị đánh dấu "đã báo", để lượt kiểm
  tra sau thử gửi lại nếu điều kiện vẫn đúng.
- **Database lỗi khi người dùng gửi lệnh**: bot vẫn trả `200` và trả lời thân
  thiện, theo triết lý xử lý lỗi hiện có.
- **Hai lượt kiểm tra chạy chồng nhau** (lượt trước chưa xong thì lượt sau đã
  tới): một lần vượt mức chỉ được báo tối đa một lần.
- **Chat hủy digest bằng `/huy`**: cảnh báo của chat đó không bị ảnh hưởng, vì
  cảnh báo độc lập với việc đăng ký digest.

## 4. Functional requirements

| Id | Requirement | Priority | Traces to |
|---|---|---|---|
| `EPIC-002-FR01` | `/canhbao <coin> > <giá>` và `/canhbao <coin> < <giá>` tạo cảnh báo "vượt lên trên" / "rơi xuống dưới" mức `<giá>` USD cho chat gửi lệnh. Tên lệnh chấp nhận cả dạng có dấu (`/cảnhbáo`) lẫn không dấu, không phân biệt hoa thường, giống `/gia`. | Must | intent §1, §2 |
| `EPIC-002-FR02` | Mức giá là số dương. `.` là dấu thập phân, `,` là dấu phân cách hàng nghìn và được bỏ qua (`100,000` = `100000`; `0.35` hợp lệ). Hậu tố kiểu `100k` không được hỗ trợ và bị từ chối kèm ví dụ đúng. | Must | intent §2 |
| `EPIC-002-FR03` | Coin hợp lệ là mọi coin mà `/gia` tra được, không bắt buộc nằm trong watchlist và chat không cần đăng ký digest (xem §8 Concern 4). | Must | intent §2, Open Q5 |
| `EPIC-002-FR04` | Mỗi chat có tối đa **10** cảnh báo. Đặt thêm khi đã đủ 10 thì bị từ chối kèm thông báo giới hạn. | Must | intent Open Q4 |
| `EPIC-002-FR05` | Hệ thống kiểm tra mọi cảnh báo đang canh theo chu kỳ đã chốt ở NFR01. Khi giá hiện tại thoả điều kiện ("≥ mức" cho `>`, "≤ mức" cho `<`), hệ thống gửi đúng một tin tới đúng chat rồi chuyển cảnh báo sang "đã báo". | Must | intent §5 |
| `EPIC-002-FR06` | Cảnh báo "đã báo" tự bật lại, không gửi tin, khi một lượt kiểm tra thấy giá đã quay về phía ban đầu và cách mức ít nhất **0,5%** (vùng đệm chống nhiễu). Ví dụ với `btc > 100000`: bật lại khi giá ≤ 99.500. | Must | intent Open Q3 (originator chọn "tự bật lại") |
| `EPIC-002-FR07` | Không có cảnh báo nào gửi quá 1 tin trong 15 phút, kể cả khi giá dao động mạnh quanh mức và vượt cả vùng đệm. | Must | intent §5 ("mỗi lần vượt mức chỉ gửi một lần") |
| `EPIC-002-FR08` | `/canhbao` không kèm tham số trả về danh sách cảnh báo của chat: số thứ tự, coin, điều kiện, trạng thái. Danh sách trống thì kèm ví dụ cú pháp. | Must | intent §2 |
| `EPIC-002-FR09` | `/canhbao xoa <số>` xoá cảnh báo theo số thứ tự hiển thị trong danh sách, và chỉ xoá được cảnh báo của chính chat đó. | Must | intent §2 |
| `EPIC-002-FR10` | Từ chối tạo cảnh báo nếu điều kiện đã thoả ở giá hiện tại, và trả lời kèm giá hiện tại. | Should | intent §5 ("gửi đúng") |
| `EPIC-002-FR11` | Tin cảnh báo gồm: coin, điều kiện, mức giá, giá hiện tại (USD kèm ước tính VND, cùng định dạng với `/gia`), và dòng nhắc rằng cảnh báo sẽ tự bật lại. | Must | intent §1 |
| `EPIC-002-FR12` | Mỗi lần gửi cảnh báo được ghi lại gồm chat, coin, điều kiện, thời điểm và kết quả gửi. Nhờ vậy chủ dự án kiểm tra được tiêu chí thành công ở intent §5 (có cảnh báo của chat khác được gửi thành công) mà không phải hỏi người dùng. | Must | intent §5 |
| `EPIC-002-FR13` | `/help` liệt kê lệnh `/canhbao` cùng ví dụ, và `docs/API.md` được cập nhật. | Should | `docs/RULES.md` |

## 5. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| `EPIC-002-NFR01` | Chu kỳ kiểm tra giá | Mỗi **≤ 60 giây** trên danh nghĩa. Trễ đầu-cuối (từ lúc nguồn giá phản ánh việc vượt mức đến lúc tin tới chat) **≤ 2 phút p95**, theo mức originator chấp nhận ngày 2026-09-23 (§8 Concern 1). |
| `EPIC-002-NFR02` | Thời gian một lượt kiểm tra | Xong trong **≤ 15 giây** với tối đa 1.000 cảnh báo đang canh. |
| `EPIC-002-NFR03` | Dùng quota nguồn giá | Số lần gọi nguồn giá mỗi lượt kiểm tra không tăng theo số cảnh báo, chỉ theo số coin khác nhau, và ≤ **2 lần gọi mỗi lượt** khi có ≤ 100 coin khác nhau. Việc kiểm tra định kỳ không được làm `/gia` lỗi vì hết quota. |
| `EPIC-002-NFR04` | Chi phí | Không yêu cầu gói trả phí hay dịch vụ trả phí mới; chạy được trên Vercel **Hobby** và các gói miễn phí hiện dùng (§8 Concern 2). |
| `EPIC-002-NFR05` | Bảo mật endpoint kiểm tra | Chỉ bộ lập lịch có secret mới kích hoạt được lượt kiểm tra; gọi không có secret đúng trả `401`. Không lộ stack trace, và mọi lỗi nghiệp vụ vẫn trả `200`, giống `/cron/daily-digest`. |
| `EPIC-002-NFR06` | Giới hạn input được lưu | `chat.id` tối đa **64 ký tự**, ký hiệu coin tối đa **20 ký tự**, mức giá trong khoảng (0, 10^12] với tối đa **8 chữ số thập phân**; ngoài khoảng này thì từ chối. Đồng thời giải quyết finding #3 của EPIC-001 cho đường ghi mới. |
| `EPIC-002-NFR07` | Cô lập lỗi | Lỗi của một cảnh báo hoặc một chat (gửi thất bại, coin bị gỡ) không chặn các cảnh báo khác trong cùng lượt kiểm tra. |
| `EPIC-002-NFR08` | Khả năng quan sát | Mỗi lượt kiểm tra ghi một dòng log có cấu trúc: số cảnh báo được đánh giá, số đã gửi, số gửi lỗi, thời gian chạy, và độ lệch so với lịch dự kiến. Nhờ vậy NFR01/NFR02 đo được thay vì đoán. |
| `EPIC-002-NFR09` | Chống lạm dụng lệnh | `/canhbao` chịu giới hạn tần suất theo chat hiện có (`UserThrottlerGuard`); không cần cơ chế riêng (xem §8 Concern 5). |

## 6. Acceptance criteria

| Id | Given / When / Then |
|---|---|
| `EPIC-002-AC01` | **Given** BTC = 95.000 USD, **when** chat gửi `/canhbao btc > 100000`, **then** cảnh báo được tạo và bot xác nhận kèm số thứ tự, điều kiện và giá hiện tại. (FR01) |
| `EPIC-002-AC02` | **Given** cảnh báo `btc > 100000` đang canh, **when** lượt kiểm tra thấy BTC = 100.200, **then** chat nhận đúng 1 tin chứa BTC, `> 100,000` và giá hiện tại, và cảnh báo chuyển sang "đã báo". (FR05, FR11) |
| `EPIC-002-AC03` | **Given** cảnh báo "đã báo" với `btc > 100000`, **when** các lượt kiểm tra tiếp theo thấy BTC = 100.500 và 101.000, **then** không gửi thêm tin nào. (FR05) |
| `EPIC-002-AC04` | **Given** cảnh báo "đã báo" với `btc > 100000`, **when** giá xuống 99.800 (vẫn trong vùng đệm 0,5%), **then** cảnh báo chưa bật lại; **when** giá xuống 99.400, **then** cảnh báo bật lại và không gửi tin; **when** giá lên lại 100.100 sau hơn 15 phút kể từ lần báo trước, **then** chat được báo lần thứ hai. (FR06, FR07) |
| `EPIC-002-AC05` | **Given** cảnh báo vừa báo lúc T, **when** giá quay về dưới vùng đệm rồi vượt mức lại lúc T+5 phút, **then** không gửi tin. Tin tiếp theo chỉ được gửi từ T+15 phút nếu điều kiện vẫn đúng. (FR07) |
| `EPIC-002-AC06` | **Given** cảnh báo `eth < 2000` đang canh, **when** ETH = 1.990, **then** chat được báo. Chiều "<" hoạt động đối xứng với ">". (FR01, FR05) |
| `EPIC-002-AC07` | **Given** BTC = 110.000, **when** chat gửi `/canhbao btc > 100000`, **then** không tạo cảnh báo, và bot trả lời rằng điều kiện đã thoả kèm giá hiện tại. (FR10) |
| `EPIC-002-AC08` | **When** gửi `/canhbao btc > 100k`, `/canhbao btc 100000`, `/canhbao btc > -5` hoặc `/canhbao btc > 1.123456789`, **then** mỗi lệnh bị từ chối kèm ví dụ cú pháp đúng, và không cảnh báo nào được tạo. **When** gửi `/canhbao btc > 100,000`, **then** được hiểu là 100000. (FR02, NFR06) |
| `EPIC-002-AC09` | **When** gửi `/canhbao xyzabc > 1`, **then** bị từ chối với thông báo coin không tồn tại giống `/gia`. (FR03) |
| `EPIC-002-AC10` | **Given** chat đã có 10 cảnh báo, **when** đặt cái thứ 11, **then** bị từ chối và bot nêu giới hạn 10 cùng cách xoá. (FR04) |
| `EPIC-002-AC11` | **Given** chat A có 2 cảnh báo và chat B có 1, **when** A gửi `/canhbao`, **then** A thấy đúng 2 cảnh báo của mình; **when** A gửi `/canhbao xoa 2`, **then** cảnh báo số 2 của A bị xoá, còn cảnh báo của B không bị ảnh hưởng; **when** A gửi `/canhbao xoa 99`, **then** bot trả lời không tìm thấy. (FR08, FR09) |
| `EPIC-002-AC12` | **Given** nguồn giá lỗi hoặc timeout trong một lượt kiểm tra, **then** không gửi tin nào, không đổi trạng thái cảnh báo nào, và endpoint vẫn trả `200`. (edge path, NFR05) |
| `EPIC-002-AC13` | **Given** 2 chat có cảnh báo đều thoả điều kiện nhưng gửi tin tới chat thứ nhất thất bại, **then** chat thứ hai vẫn nhận được tin; cảnh báo của chat thứ nhất vẫn đang canh và lượt sau thử gửi lại. (NFR07, edge path) |
| `EPIC-002-AC14` | **Given** 2 lượt kiểm tra chạy đồng thời cùng thấy một cảnh báo thoả điều kiện, **then** chat nhận tối đa 1 tin. (edge path, FR05) |
| `EPIC-002-AC15` | **Given** 50 cảnh báo trên 5 coin khác nhau, **when** một lượt kiểm tra chạy, **then** nguồn giá được gọi ≤ 2 lần. (NFR03) |
| `EPIC-002-AC16` | **When** endpoint kích hoạt lượt kiểm tra được gọi mà không có secret hoặc sai secret, **then** trả `401`, và không đánh giá cảnh báo nào. (NFR05) |
| `EPIC-002-AC17` | **Given** một cảnh báo được gửi thành công, **then** bản ghi lần gửi (chat, coin, điều kiện, thời điểm, kết quả) truy vấn được, và mỗi lượt kiểm tra có một dòng log với các số liệu ở NFR08. (FR12, NFR08) |
| `EPIC-002-AC18` | **Given** hệ thống đã deploy production, **when** quan sát log các lượt kiểm tra trong 24 giờ, **then** khoảng cách giữa hai lượt liền nhau ≤ 90 giây ở p95. (NFR01) |
| `EPIC-002-AC19` | **Given** một chat có cảnh báo, **when** chat gửi `/huy`, **then** cảnh báo của chat vẫn còn và vẫn hoạt động. (edge path) |

## 7. Out of scope

- Cảnh báo theo % thay đổi, theo chỉ báo kỹ thuật hay theo độ biến động
  (Initiative 4).
- Mức giá theo VND hoặc đơn vị khác ngoài USD.
- Hậu tố rút gọn kiểu `100k`, `1m`.
- Sửa một cảnh báo có sẵn: muốn đổi thì xoá rồi đặt lại.
- Cảnh báo chỉ báo một lần rồi tự tắt (originator đã chọn chế độ tự bật lại);
  có thể thêm sau nếu người dùng yêu cầu.
- Độ trễ dưới 1 phút / thời gian thực (originator đã chấp nhận 1–2 phút).
- Giới hạn theo gói trả phí hay kiếm tiền từ cảnh báo (giai đoạn Monetization).
- Các kênh khác ngoài Zalo (Initiative 5).
- Thay đổi bản tin hằng ngày 9h sáng.
- Tự dọn cảnh báo của chat đã chặn bot hoặc không còn tồn tại. Các lần gửi
  thất bại chỉ được ghi log.

## 8. Concerns

| # | Concern | Needs | Resolution |
|---|---|---|---|
| 1 | `intent.md` §5 yêu cầu "dưới 1 phút", nhưng kiến trúc serverless không có tiến trình chạy liên tục, nên dưới 1 phút đòi hạ tầng khác và tốn thêm chi phí. | Originator | **Đã chốt 2026-09-23:** originator chấp nhận trễ khoảng 1–2 phút, chu kỳ kiểm tra ≤ 60 giây (NFR01). Mục §5 của `intent.md` được hiểu theo quyết định này. |
| 2 | Dự án đang ở gói Vercel **Hobby**, mà Vercel Cron trên Hobby không kích hoạt được mỗi phút, nên cơ chế lập lịch cho daily digest không dùng lại được cho cảnh báo. | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Spec chỉ ràng buộc hành vi: chu kỳ ≤ 60 giây (NFR01), không thêm chi phí trả phí (NFR04), có secret (NFR05). `plan.md` phải chọn cơ chế kích hoạt thoả cả ba ràng buộc, hoặc quay lại originator nếu không có cách nào. |
| 3 | Chế độ "tự bật lại" có thể spam khi giá dao động quanh mức. | Product Owner | **Đã chốt:** thêm vùng đệm 0,5% (FR06) và tối đa 1 tin mỗi cảnh báo trong 15 phút (FR07). Originator có thể chỉnh hai con số này khi duyệt spec. |
| 4 | `intent.md` §2 nhắm tới subscriber, nhưng bắt buộc `/dangky` trước khi đặt cảnh báo sẽ thêm bước thừa. Tương tự, giới hạn coin trong watchlist sẽ chặn người muốn canh coin không có trong watchlist. | Product Owner | **Đã chốt:** mọi chat đặt được cảnh báo, với mọi coin mà `/gia` hỗ trợ (FR03). Subscriber vẫn là nhóm đối tượng chính. Originator có thể đảo quyết định này khi duyệt. |
| 5 | Có cần cơ chế chống lạm dụng riêng cho đường ghi mới hay không (câu hỏi còn mở từ Initiative 1). | Product Owner | **Đã chốt:** giới hạn cứng 10 cảnh báo mỗi chat (FR04), giới hạn input (NFR06) và `UserThrottlerGuard` hiện có (NFR09) là đủ ở quy mô hiện tại. `risk-security-reviewer` có thể xem lại ở phase review. |
| 6 | `ZaloService.sendTextMessage` hiện nuốt lỗi và không báo cho bên gọi biết gửi thành công hay thất bại, trong khi FR05, FR12 và AC13 cần biết kết quả gửi. | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Hành vi bắt buộc đã nêu ở AC13; cách đưa kết quả gửi ra ngoài là chuyện triển khai. Việc này không được làm hỏng đảm bảo "không throw" mà webhook đang dựa vào. |
| 7 | Nguồn giá miễn phí (CoinGecko) có giới hạn tần suất; nếu kiểm tra mỗi phút mà ăn hết quota thì `/gia` có thể lỗi. | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Ràng buộc bằng NFR03 và AC15. `plan.md` phải nêu số lần gọi ước tính mỗi phút so với giới hạn của nguồn giá. |
| 8 | Intent Open Q2 (bao nhiêu subscriber đã yêu cầu, họ muốn gì cụ thể) chưa có câu trả lời. | Originator | **Hoãn, owner: originator.** Không chặn spec, vì các lựa chọn hành vi đã được originator chốt trực tiếp (Q1, Q3, Q4) hoặc PO chốt (Q5). Nên ghi lại tin nhắn yêu cầu gốc vào `intent.md` §4 khi có. |

---

*No implementation detail: no libraries, tables, endpoints or file layouts.*
