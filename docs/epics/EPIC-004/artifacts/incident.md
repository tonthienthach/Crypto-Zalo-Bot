# Incident — Chưa có tín hiệu production cho EPIC-004

**Epic ID:** `EPIC-004`
**Operator:** Operator (stage 6)
**Status:** Draft
**Created:** `2026-10-27`

---

## 1. Signal

Không có tín hiệu. Cả `docs/epics/EPIC-004/signal.json` lẫn đường dẫn tín hiệu truyền kèm lệnh đều không tồn tại, và epic chưa ở trạng thái có thể phát ra tín hiệu: nhánh `feature/epic-004-simple-signals` chưa merge vào `master`, chưa deploy, chưa đặt `SIGNALS_CRON_SECRET` trên Vercel, chưa có job cron-job.org gọi `/cron/signals` (xem `implement.md` §1 và §6, `review.md` finding 4). Không có log, báo cáo hay cảnh báo nào của production để trích dẫn.

Theo quy tắc của bước này ("Never invent evidence"), tệp này không dựng triệu chứng, nguyên nhân hay mức độ nào.

| Trường | Giá trị |
|---|---|
| `source` | không có |
| `observedAt` | không có |
| `symptom` | không có |
| `scope` | không có |
| `evidence` | không có |

## 2. What happened

Chưa có gì xảy ra trên production để mô tả. Trạng thái của epic tại ngày ghi tệp này, đều lấy từ artifact đã có:
- `verify.md` rev 3: 17/18 tiêu chí pass, 0 fail, 1 untested (`EPIC-004-AC04`, vế "trong ≤ 30 phút"). NFR01, NFR02, NFR04, ngân sách lệnh Upstash và script Lua trên Upstash thật chưa kiểm được trước deploy.
- `review.md`: ship with follow-ups, không blocker.
- Các sửa sau review (`implement.md` §7.1 và §7.2) đã đẩy lên nhánh sau khi `review.md` được viết.

## 3. Why it happened

**Confidence:** không áp dụng. Không có sự cố để chẩn đoán, nên không có nguyên nhân nào được gắn nhãn `confirmed` hay `hypothesis`.

## 4. Blast radius

Chưa có ảnh hưởng thực tế. Phạm vi rủi ro nếu epic được deploy đã được nêu ở `plan.md` §4 và `implement.md` §6: mọi chat đã `/dangky` sẽ nhận tin tín hiệu chủ động (mặc định bật), và Upstash Redis dùng thêm khoảng 30k lệnh mỗi tháng (ước tính theo code, chưa đo).

## 5. What would have caught this

Không có sự cố nên không có lời đáp "đã có thể bắt được". Phần hữu ích duy nhất là danh sách **các điều chưa kiểm được và phải đọc ngay sau deploy**, vì chúng chính là chỗ một tín hiệu thật dễ xuất hiện:

1. `signals-run` của lượt gọi tay đầu tiên phải có `outcome: healthy`; hai lượt healthy mỗi giờ sau khi tạo job (`npm run signals:report`). Đo `NFR01` (≤ 30 phút) và `NFR02` (≤ 5 giây p95) bằng log.
2. Script Lua lần đầu chạy trên Upstash thật (cho tới nay chỉ chạy trên Redis 7 qua proxy REST cục bộ) và kích thước phản hồi đọc lịch sử cho 30–50 coin.
3. Số lệnh Upstash sau 48 giờ so với mục tiêu 400k/tháng, cộng với cảnh báo giá đang dùng ~295k–339k.
4. Lượt lấp lịch sử đầu tiên: CoinGecko không key đã trả 429 sau khoảng 4 lệnh trong lúc verify. Một chuỗi lượt `failed` quá 90 phút sẽ làm watcher báo owner.
5. Chỉ số thành công: ít nhất một chat ngoài owner dùng `/tinhieu` ở hai ngày khác nhau trong 30 ngày (`npm run signals:report`). Quyết định của owner về ngưỡng 8%/15% sau khi xem backtest (với coin lớn tín hiệu rất thưa: BTC 0 lần mua, 1 lần bán trong 90 ngày).

## 6. Decision

**closed — không có tín hiệu để xử lý.**

Không mở epic mới, vì không có vấn đề nào để diễn đạt thành intent. Bước này chạy lại khi có tín hiệu thật: ghi một `signal.json` (năm trường ở §1) vào `docs/epics/EPIC-004/` hoặc truyền đường dẫn của nó, rồi chạy `/maintain EPIC-004`.

## 7. Follow-up intent

Không có. Không chạy `aidlc maintain follow-up`.

Câu hỏi mở cho owner (không chặn gì ở bước này, ghi lại để không mất): có deploy `EPIC-004` cùng lúc với `EPIC-002-FIX` và `EPIC-003` (cả ba đang chờ deploy, xem `docs/ROADMAP.md`), hay lần lượt từng epic để mỗi tín hiệu production quy được về một thay đổi?
