# Intent — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Originator:** Thach (chủ dự án), chuyển tiếp yêu cầu từ các subscriber hiện có của bản tin hằng ngày
**Status:** Draft
**Created:** 2026-09-23

---

## 1. Problem

Subscriber chỉ nhận tin từ bot mỗi ngày một lần, qua bản tin lúc 9h sáng (giờ
Việt Nam). Nếu một coin họ quan tâm vượt qua một mức giá quan trọng với họ vào
bất kỳ giờ nào khác trong ngày, sẽ không có gì báo cho họ. Hiện tại cách duy
nhất để biết là tự hỏi giá bot hết lần này đến lần khác. Vấn đề xảy ra đúng
lúc giá vượt mức của họ giữa hai lần tự kiểm tra. Họ biết muộn, thường là khi
đợt biến động đã qua.

## 2. Who hurts

Các subscriber hiện có của bản tin hằng ngày: những chat đã đăng ký nhận bản
tin và theo dõi một watchlist nhỏ. Họ có sẵn một mức giá cụ thể cho một coin,
ví dụ mức để mua, bán hoặc cắt lỗ, và muốn hành động khi giá chạm mức đó. Đây
không phải người dùng `/gia` thỉnh thoảng, chỉ cần tra giá nhanh.

## 3. Cost

| Dimension | Today | Notes |
|---|---|---|
| Bỏ lỡ biến động | Subscriber chỉ biết giá đã vượt mức ở lần tự kiểm tra tiếp theo hoặc bản tin 9h sáng hôm sau (muộn tới ~24 giờ) | Tần suất: chưa có dữ liệu |
| Công sức thủ công | Subscriber phải tự hỏi giá liên tục để canh một mức | Số lần tự kiểm tra mỗi ngày: chưa có dữ liệu |
| Rủi ro giữ chân người dùng | Giá trị của bot chỉ gói gọn trong một tin mỗi ngày, nên subscriber có ít lý do để tiếp tục dùng | Giả định, lấy từ Initiative 2 trong `docs/ROADMAP.md`; chưa đo |

## 4. Evidence

- Các subscriber hiện có đã trực tiếp đề nghị tính năng này với chủ dự án
  (originator cho biết ngày 2026-09-23). Chưa ghi lại có bao nhiêu yêu cầu, ai
  gửi và nguyên văn họ nói gì.
- Initiative 2 trong `docs/ROADMAP.md` xếp cảnh báo là tính năng giữ chân
  người dùng crypto tốt nhất. Đó là giả định, chưa có dữ liệu đo.
- Chưa có số liệu sử dụng về tần suất subscriber tự hỏi giá.

## 5. Done looks like

- Trong vòng **30 ngày sau khi deploy production**, có ít nhất **một cảnh báo
  do một chat khác (không phải của chủ dự án) đặt** được kích hoạt và gửi đi
  đúng. "Đúng" nghĩa là đúng coin, đúng mức giá, đúng chat, và mỗi lần giá vượt
  mức chỉ gửi một lần.
- Tin đến **dưới 1 phút** sau khi giá vượt mức. Theo originator, cảnh báo đến
  muộn vài phút là mất giá trị.

## 6. Not this

- Theo dõi danh mục / lãi lỗ (Initiative 3).
- Tín hiệu dựa trên chỉ báo hoặc độ biến động, như % thay đổi, RSI, v.v.
  (Initiative 4).
- Giới hạn theo gói trả phí hoặc kiếm tiền từ cảnh báo (giai đoạn
  Monetization).
- Các kênh khác ngoài Zalo (Initiative 5).
- Thay đổi bản tin hằng ngày lúc 9h sáng hiện có.

## 7. Open questions

| # | Question | Who can answer |
|---|---|---|
| 1 | "Dưới 1 phút" là yêu cầu bắt buộc hay chỉ là mục tiêu? Nếu nền tảng hosting hiện tại không kiểm tra giá thường xuyên như vậy một cách ổn định được, thì mức tối thiểu vẫn còn hữu ích là bao nhiêu (ví dụ ~1 phút có chấp nhận được không)? | Originator (Thach) |
| 2 | Bao nhiêu subscriber đã yêu cầu, và chính xác họ muốn gì: giá vượt lên hay rơi xuống, báo một lần hay lặp lại? | Originator (Thach), từ tin nhắn của subscriber |
| 3 | Cảnh báo nên kích hoạt một lần rồi dừng, hay kích hoạt lại mỗi lần giá vượt mức? | Originator / subscriber |
| 4 | Có giới hạn số cảnh báo mỗi chat được đặt không, để bảo vệ quota dữ liệu giá miễn phí và chống lạm dụng? | Originator, cùng góp ý từ spec/plan về giới hạn nguồn dữ liệu |
| 5 | Chỉ cho đặt cảnh báo với coin trong watchlist của chat, hay mọi coin được hỗ trợ? | Originator |

---

*No solution language in this document. No components, endpoints, screens,
libraries or schemas — those belong in `spec.md` and `plan.md`.*
