# Intent — Tín hiệu đơn giản (biến động / chỉ báo cơ bản)

**Epic ID:** `EPIC-004`
**Originator:** Thach (chủ dự án), từ nhu cầu của chính mình; Initiative 4 trong `docs/ROADMAP.md`
**Status:** Approved (Thach, 2026-09-30)
**Created:** 2026-09-30

---

## 1. Problem

Bot báo được giá hiện tại của từng coin (tra giá, bản tin 9h sáng, cảnh báo ngưỡng giá, danh mục), nhưng một con số giá đứng riêng không cho owner biết **xu hướng**: giá đang đi lên hay đi xuống trong những ngày gần đây, và mức hiện tại nằm ở đâu so với mặt bằng gần đây. Khi owner cân nhắc mua hoặc bán một coin, bot không giúp được phần "nên nhìn nó thế nào", nên bot chỉ là công cụ tra giá chứ chưa phải nơi owner tham khảo để ra quyết định.

## 2. Who hurts

- **Owner (Thach)**, đang cân nhắc mua/bán các coin mình theo dõi hoặc đang giữ, và muốn nắm xu hướng của coin đó ngay trong Zalo.
- **Nếu mở ra cho mọi người:** các chat khác cũng có thể cần điều này. Đây mới là **giả định**, chưa ai ngoài owner yêu cầu.

## 3. Cost

| Dimension | Today | Notes |
|---|---|---|
| Thiếu bối cảnh khi quyết định | Bot chỉ cho giá hiện tại, không cho xu hướng | Owner phải mở app khác để xem xu hướng, mất khá nhiều thời gian và bất tiện (số phút, số lần mỗi ngày: chưa có dữ liệu) |
| Giữ chân người dùng | Roadmap cho rằng tín hiệu giúp bot khác biệt với "chỉ tra giá" | Giả định từ `docs/ROADMAP.md` Initiative 4; chưa đo |

## 4. Evidence

- Owner xác nhận ngày 2026-09-30: vấn đề là "không biết xu hướng", và tín hiệu dùng để **quyết định mua/bán**.
- Owner xác nhận ngày 2026-09-30: xem xu hướng ở nơi khác "mất khá nhiều thời gian", thường phải mở app nên bất tiện. Chưa có số phút/số lần cụ thể.
- Chưa có chat nào khác yêu cầu tính năng này.

## 5. Done looks like

- Owner biết được coin trong watchlist của mình có **dao động mạnh trong vài ngày gần đây** hay không, cùng một nhận định tham khảo nên mua hay bán, **ngay trong Zalo** ở bản tin 9h sáng.
- Khi một coin trong watchlist có biến động mạnh, owner được **báo chủ động** mà không cần tự hỏi.
- Owner không còn phải mở app khác chỉ để xem xu hướng.
- Kiểm tra được bằng cách: owner so nhận định của bot với biểu đồ ở nguồn khác cho cùng coin, cùng khoảng thời gian, và thấy khớp.
- Nhận định mua/bán được trình bày là **thông tin tham khảo**, không phải cam kết.
- **Tiêu chí thành công (đề xuất, chờ Thach xác nhận):** trong 30 ngày sau ra mắt, có ≥ 1 chat không phải của owner dùng tính năng này và dùng lại sau ngày đầu tiên.

## 6. Not this

- Phí hay gói trả phí (free/paid tier). Monetization là phase sau.
- Kênh khác ngoài Zalo (Telegram, Messenger). Để cho Initiative 5.
- Coin ngoài watchlist của chat (theo trả lời của owner).

## 7. Open questions

| # | Question | Who can answer |
|---|---|---|
| 1 | ~~Chỉ hiển thị số liệu hay khuyên mua/bán?~~ Đã trả lời 2026-09-30: **được phép khuyên mua/bán để tham khảo**. Còn lại: cách nêu miễn trừ trách nhiệm và độ tin cậy để spec quyết | Thach; spec |
| 2 | ~~Khoảng thời gian?~~ Đã trả lời 2026-09-30: **dao động mạnh trong vài ngày**. Ngưỡng "mạnh" và số ngày cụ thể để spec quyết | Thach; spec |
| 3 | ~~Xem khi nào?~~ Đã trả lời 2026-09-30: **trong bản tin sáng và báo chủ động** khi có biến động mạnh | Thach |
| 4 | ~~Coin nào?~~ Đã trả lời 2026-09-30: **coin trong watchlist** | Thach |
| 5 | ~~Mất bao lâu?~~ Đã trả lời 2026-09-30 định tính: khá nhiều thời gian, phải mở app. Chưa có số phút/số lần; nếu cần đo hiệu quả thì cần con số này | Thach |
| 6 | ~~Backtest?~~ Đã trả lời 2026-09-30: **có**. Owner muốn biết nhận định như vậy trong quá khứ đúng hay sai đến đâu; phạm vi và cách trình bày để spec quyết | Thach; spec |
| 7 | ~~Tần suất báo chủ động?~~ Đã trả lời 2026-09-30: **tối đa 1 lần/giờ** khi có dao động mạnh (mỗi coin hay mỗi chat: spec quyết). Còn lại: có gộp với cảnh báo giá hiện có không | Thach; spec |
| 8 | Owner hỏi (2026-09-30): có lưu lại lịch sử giá để đánh giá độ đúng của đề xuất được không. Nhu cầu: đối chiếu đề xuất đã đưa với diễn biến giá thực sau đó. Nguồn/cách lưu và thời gian giữ để spec quyết | Spec |

---

*No solution language in this document. No components, endpoints, screens,
libraries or schemas — those belong in `spec.md` and `plan.md`.*
