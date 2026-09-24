# Intent — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Originator:** Thach (chủ dự án), từ nhu cầu của chính mình; Initiative 3 trong `docs/ROADMAP.md`
**Status:** Draft
**Created:** 2026-09-24

---

## 1. Problem

Owner giữ dưới 20 coin, nằm rải rác ở 2–3 nơi (sàn và ví). Muốn biết danh mục đang đáng bao nhiêu, owner phải mở lần lượt từng app, xem số dư rồi tự cộng nhẩm. Ngay cả khi làm vậy, owner vẫn không biết mình đang lãi hay lỗ so với lúc mua, và không biết cả danh mục đã tăng hay giảm bao nhiêu so với hôm qua. Bot đã báo được giá từng coin (tra giá, bản tin 9h sáng, cảnh báo giá), nhưng không nói được giá đó có ý nghĩa gì với **số coin owner đang giữ**. Vấn đề xảy ra mỗi lần owner muốn trả lời câu "hôm nay mình đang thế nào": câu trả lời nằm ở nhiều nơi, và không nơi nào có phần lãi/lỗ.

## 2. Who hurts

- **Owner (Thach)** là người nắm giữ crypto ở 2–3 nơi. Owner muốn nhanh chóng biết tổng giá trị, lãi/lỗ và biến động trong ngày của toàn bộ danh mục, mà không phải mở từng app sàn/ví.
- **Nếu tính năng mở ra cho mọi người:** các chat khác dùng bot có thể có cùng nhu cầu. Đây mới là **giả định**, vì chưa có ai ngoài owner yêu cầu (xem mục 4).

## 3. Cost

| Dimension | Today | Notes |
|---|---|---|
| Thời gian | Mỗi lần kiểm tra phải mở 2–3 app và cộng nhẩm | Số phút mỗi lần và số lần mỗi ngày: chưa có dữ liệu |
| Không biết lãi/lỗ | Không có nơi nào gộp giá vốn với giá hiện tại của toàn danh mục | Owner phải tự nhớ hoặc tự tính |
| Không biết biến động trong ngày | Bản tin 9h sáng chỉ cho biết giá từng coin, không cho biết danh mục thay đổi bao nhiêu | |
| Sai sót | Cộng nhẩm từ nhiều nơi dễ sai | Chưa có dữ liệu |
| Giữ chân người dùng | Roadmap cho rằng tính năng này biến bot từ công cụ tra giá thành thói quen hằng ngày | Giả định từ `docs/ROADMAP.md` Initiative 3; chưa đo |

## 4. Evidence

- Owner đang tự gặp vấn đề này, xác nhận ngày 2026-09-24: phải mở từng app sàn/ví, danh mục dưới 20 coin ở 2–3 nơi.
- Chưa có subscriber hay chat nào khác yêu cầu tính năng này. Chưa có dữ liệu.
- Nhu cầu của người dùng ngoài owner vẫn là giả định. Xem thêm tiêu chí thành công ở mục 5.

## 5. Done looks like

- Owner biết được tổng giá trị hiện tại, lãi/lỗ so với giá vốn và biến động trong ngày của toàn bộ danh mục **ngay trong Zalo**, không phải mở app sàn/ví nào.
- Kiểm tra được bằng cách: owner so con số bot đưa ra với con số tự cộng từ các app sàn/ví tại cùng thời điểm, và hai con số khớp nhau.
- **Tiêu chí thành công:** trong 30 ngày kể từ khi ra mắt, có ≥ 1 chat không phải của owner ghi lại danh mục của mình và vẫn dùng sau ngày đầu tiên.

## 6. Not this

- Phí hay gói trả phí (free/paid tier). Monetization là phase sau, theo `docs/ROADMAP.md`.
- Kênh khác ngoài Zalo (Telegram, Messenger). Để cho Initiative 5.
- Tư vấn đầu tư hoặc khuyến nghị mua/bán. Tín hiệu là Initiative 4.

## 7. Open questions

| # | Question | Who can answer |
|---|---|---|
| 1 | Danh mục được đưa vào bằng cách nào: người dùng tự khai số lượng và giá vốn, hay bot tự lấy số dư/lịch sử giao dịch từ sàn/ví? Owner giao việc này cho spec quyết. Lưu ý: chỉ tự lấy dữ liệu mới giải quyết triệt để vấn đề "phải mở nhiều nơi", nhưng cách đó đòi người dùng giao quyền truy cập tài khoản | Spec (product owner), Thach duyệt |
| 2 | Lãi/lỗ tính theo cách nào khi mua cùng một coin nhiều lần ở nhiều giá? Có cần theo dõi từng lần mua/bán không? | Thach |
| 3 | Owner muốn thấy số liệu danh mục khi nào: khi tự hỏi, trong bản tin 9h sáng, hay cả hai? | Thach |
| 4 | Đơn vị hiển thị: VND, USD hay cả hai (bot hiện đổi giá theo tỷ giá cố định)? | Thach |
| 5 | Mỗi lần kiểm tra hôm nay mất bao nhiêu phút, bao nhiêu lần một ngày? Cần con số để đo xem tính năng có đỡ thời gian không | Thach |
| 6 | Danh mục là dữ liệu tài chính cá nhân. Có yêu cầu gì về quyền riêng tư không, chẳng hạn trong nhóm chat thì ai được xem? | Thach |
| 7 | Các coin không có trên nguồn giá hiện tại (token nhỏ, token trên chain khác) thì xử lý thế nào? | Spec |

---

*No solution language in this document. No components, endpoints, screens,
libraries or schemas — those belong in `spec.md` and `plan.md`.*
