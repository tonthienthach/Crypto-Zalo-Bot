# Intent — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Originator:** Operator (stage 6), mở từ `docs/epics/EPIC-002/artifacts/incident.md`; chờ Thach (chủ dự án) duyệt ở stage 1
**Status:** Draft
**Created:** 2026-09-24

---

## 1. Problem

Một chat đặt cảnh báo giá và từ đó tin rằng bot đang canh giá giúp mình. Nhưng việc canh giá có thể ngừng hẳn mà không ai biết. Người đặt cảnh báo không được báo gì, owner cũng không thấy dấu hiệu nào. Cảnh báo vẫn "còn đó" trong danh sách của họ, chỉ là không còn ai canh. Lần này việc canh giá gần như không chạy suốt ~32 giờ ngay sau khi ra mắt. Chuyện chỉ lộ ra khi owner tự tay đi đo, và kể cả lúc đó, dữ liệu hiện có vẫn không cho biết nó không chạy vì không được gọi, vì bị từ chối hay vì bị lỗi.

## 2. Who hurts

- **Chat đã đặt cảnh báo giá**: đang chờ được nhắn khi một coin vượt mức giá của họ để kịp mua, bán hoặc cắt lỗ. Vì tin là bot đang canh, họ đã thôi tự kiểm tra giá.
- **Owner (Thach) vận hành bot một mình**: cần biết tính năng chính còn chạy hay không mà không phải định kỳ tự chạy lệnh đo, và khi có sự cố thì cần biết ngay nguyên nhân thuộc loại nào.

## 3. Cost

| Dimension | Today | Notes |
|---|---|---|
| Thời gian không được canh | ~32 giờ liên tục kể từ ra mắt (2026-09-23 → 2026-09-24) | Chỉ có 2 lượt canh hoàn tất, đáng lẽ phải khoảng 1.900 lượt |
| Cảnh báo bị ảnh hưởng | 100% cảnh báo đang có (2 cảnh báo) | Số chat sở hữu: chưa có dữ liệu |
| Lần vượt ngưỡng bị bỏ lỡ | Không biết | Không có lượt canh nào để đối chiếu |
| Thời gian để phát hiện | ~32 giờ, và chỉ vì owner tự đi đo | Không có gì giới hạn thời gian này; lần sau có thể lâu hơn |
| Niềm tin vào tính năng | Người dùng dựa vào một lời hứa ngầm mà bot không giữ | Chưa đo |

## 4. Evidence

- `docs/epics/EPIC-002/signal.json`: owner chạy report chỉ đọc trên production ngày 2026-09-24: "Runs logged: 2 (2026-09-23T06:55:42.247Z -> 2026-09-24T15:01:56.664Z)", "Gap between runs: p50 115574.4s, p95 115574.4s, max 115574.4s  [AC18: p95 <= 90s]", "Active alerts: 2", "Deliveries logged: 0 delivered, 0 failed".
- `docs/epics/EPIC-002/artifacts/incident.md` §3 (confirmed): hệ thống chỉ ghi lại lượt canh thành công. Lượt không được phép, lượt bị bỏ qua và lượt lỗi đều không để lại dấu vết mà owner xem được, nên không thể biết nguyên nhân từ dữ liệu của chính hệ thống.
- Nguyên nhân gốc lần này (owner xác nhận 2026-09-24): lịch gọi bên ngoài bị cấu hình sai địa chỉ. Đó là một lỗi thao tác tay, và hệ thống không có gì phát hiện ra nó suốt ~32 giờ.

## 5. Done looks like

- Khi việc canh giá ngừng hoặc liên tục thất bại quá một khoảng thời gian ngắn đã thống nhất, **owner được báo mà không phải tự đi kiểm tra**. Có thể thử bằng cách cố ý làm việc canh giá ngừng rồi xem owner có được báo trong khoảng thời gian đó không.
- Xem lại một khoảng thời gian bất kỳ, owner biết được lượt canh nào bị thiếu và vì sao: không được gọi, bị từ chối hay bị lỗi.
- Owner làm theo được hướng dẫn đo sức khoẻ tính năng sau deploy từ đầu đến cuối mà không phải tự tìm cách lấy thông tin đăng nhập.

## 6. Not this

- Sửa sự cố hiện tại (bật hoặc sửa lịch gọi bên ngoài). Việc này là cấu hình, owner làm ngay theo incident.md §6, không chờ epic này.
- Thay đổi cách cảnh báo được đặt, kích hoạt hay re-arm (hành vi của EPIC-002 giữ nguyên).
- Giám sát chung cho mọi phần của bot (bản tin hằng ngày, webhook), trừ khi stage 1 quyết định mở rộng. Xem câu hỏi 4.
- Chuyển gói hosting hay đổi nhà cung cấp.

## 7. Open questions

| # | Question | Who can answer |
|---|---|---|
| 1 | Việc canh giá ngừng bao lâu thì owner phải được báo: 5 phút, 15 phút hay 1 giờ? | Thach |
| 2 | Báo owner qua kênh nào để chắc chắn tới tay, kể cả khi chính kênh gửi tin của bot đang hỏng? | Thach |
| 3 | Chat có cảnh báo có nên được biết khi việc canh giá tạm dừng không, hay chỉ owner? | Thach |
| 4 | Có áp dụng cùng yêu cầu "biết khi ngừng chạy" cho bản tin 9h sáng không? (Initiative 1 cũng chưa xác nhận lần gửi đầu tiên) | Thach |
| 5 | ~~Nguyên nhân lần này?~~ Đã trả lời 2026-09-24: lịch gọi bên ngoài được cấu hình sai địa chỉ | Thach |
| 6 | Sửa hướng dẫn đo AC18 (thông tin đăng nhập Sensitive không pull được) trong epic này, hay tách thành một thay đổi tài liệu nhỏ? | Thach |

---

*No solution language in this document. No components, endpoints, screens,
libraries or schemas — those belong in `spec.md` and `plan.md`.*
