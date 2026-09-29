# Review Report — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Reviewer:** Reviewer (policy)
**Status:** Draft
**Created:** `2026-09-29`
**Reviewed against:** `docs/RULES.md` (repo không có `CLAUDE.md`), `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/epics/EPIC-002-FIX/artifacts/{intent,spec,plan,implement,verify}.md`, tiền lệ `docs/epics/EPIC-002/artifacts/review.md`

> **Ghi chú của operator (không phải nội dung reviewer):** file này được dựng lại từ báo cáo bàn giao của reviewer sau khi worktree của agent bị xoá trước khi commit — xem phần cuối. Nội dung dưới đây là nguyên văn phát hiện của reviewer, chỉ khác cách trình bày.

---

## 1. Verdict

**Overall:** ship với follow-up. Không có blocker. 3 should-fix nên xử lý trước/khi merge, không bắt buộc để ship.

## 2. Scope reviewed

| | |
|---|---|
| Base | `c9b7292` (approved spec + build plan) |
| Head | `5618180` (`feature/epic-002-fix-alert-monitoring`, verify approved) |
| Files changed | 37 file, +3489/−122, 20 commit |
| Read in full | file-by-file trong `src/price-alerts/`, `src/common/guards/`, `scripts/`, `test/`; artifact của epic đọc làm ngữ cảnh |

**Kiểm tra cơ học (reviewer tự chạy trên `5618180`):** lint, unit (211/211), e2e (23 pass, 9 skip — bộ Redis thật opt-in cần `REDIS_INT_URL`, không có Docker trên máy), build — tất cả xanh, khớp mô tả của `implement.md`.

**Ghi chú phạm vi quan trọng:** 2 commit cuối trước đầu review (`0aba0b4`, `a7287d2`) được viết **sau** lần verify độc lập gần nhất (rev 2, tại `63a2af9`), để sửa đúng finding verify rev 2 tìm ra. Reviewer đã đọc code và chạy test, thấy khớp với mô tả, nhưng **hai commit này chưa qua một lượt verify độc lập riêng** — verify.md hiện tại (rev 2) không nói gì về chúng. Phần còn lại của defect (NFR04 số Upstash thật, 9 test Redis thật, AC16/17/19) đã được owner chủ động hoãn sang sau deploy, không tính là finding mới.

## 3. Should-fix

1. `src/price-alerts/price-alerts-monitor.service.ts:88-129` — rev 3 (`0aba0b4`) đổi hold chống-spam sang theo từng loại tin. Khi Redis chập chờn, owner có thể nhận **2 tin/giờ** thay vì ≤ 1 như `spec.md` NFR05 viết. Engineer tự diễn giải "ưu tiên NFR01 (báo ngừng ≤ 20 phút) hơn NFR05", nhưng chưa có owner chốt bằng văn bản kiểu "Đã chốt" như các mục khác của spec. **Cần owner quyết định**: chấp nhận đánh đổi này, hay giới hạn lại còn ≤ 1 tin/giờ bằng cách khác.
2. `docs/ARCHITECTURE.md:327-330` — vẫn mô tả chống lặp tin là "instance memory", trong khi code từ rev 2/3 đã chuyển sang hold trong Redis theo loại tin, xuyên instance (FR11). Doc trôi khỏi code — sửa một đoạn mô tả.
3. `plan.md` §4 rủi ro R1 (QStash và Redis cùng do Upstash cung cấp — một điểm lỗi chung) tự yêu cầu "owner chấp nhận bằng văn bản ở review", nhưng chưa thấy xác nhận đó được ghi lại ở đâu ngoài chính plan.

## 4. Always-in-scope checks

| Check | Result |
|---|---|
| Secrets in code / fixtures / logs | clean — 3 secret tách biệt (`CRON_SECRET_TOKEN`, `PRICE_ALERTS_CRON_SECRET`, `PRICE_ALERTS_WATCH_SECRET`), so sánh hằng thời gian (`secret-equals.ts`), không log giá trị secret |
| Data handling | clean — không có dữ liệu cá nhân mới |
| Silent failure | clean — mọi lượt canh giá đều được phân loại và ghi lại (rev implement chính là để sửa việc này) |
| Newly reachable surface | `/cron/price-alerts-watch` — có guard riêng, secret riêng, đã kiểm |

## 5. Not re-checked

Toàn bộ danh sách AC01–AC20 và các defect rev 1/rev 2 đã sửa: xem `verify.md` rev 1 + rev 2. Không làm lại ở đây.

## 6. Follow-up cần verify thêm trước merge — ĐÃ ĐÓNG (2026-09-29)

Verify độc lập riêng cho `0aba0b4` và `a7287d2`, sau khi review viết xong ở trên: **pass**, cả hai đúng 2 kịch bản verify rev 2 nêu (test `price-alerts-monitor.service.spec.ts` dòng ~230–325), không thấy race giữa các hold key hay lệch thứ tự ghi/đọc Redis. Hai điểm còn lại, không chặn merge:

1. Should-fix #1 ở trên (2 tin/giờ khi Redis chập chờn) — verifier xác nhận đây là đánh đổi NFR01 vs NFR05 có thật, không phải lỗi code. Vẫn cần owner chốt bằng văn bản.
2. **Mới (Low):** hold của trạng thái "không đọc được" dùng chung TTL 1 giờ (`STATE_UNREADABLE_NOTICE_MS`, `price-alerts.constants.ts`). Nếu Redis ghi lỗi **liên tục quá 1 giờ**, hold hết hạn trước khi `withUnrecordedOutage` (`price-alerts-monitor.service.ts:130-153`) kịp dựng lại đợt ngừng — hồi phục có thể vẫn mất im lặng, chỉ dịch ngưỡng từ "1 lần lỗi" sang "lỗi liên tục > 1 giờ". Cùng nhóm rủi ro với finding #4 rev 2 (residual đã chấp nhận: Redis hỏng hẳn thì owner im lặng tới 1 giờ). Không có test riêng cho case này — ghi vào Known gaps của `implement.md`, không chặn merge.

---

*Ghi chú bàn giao: reviewer viết report này trong một git worktree riêng, dự định để tại đường dẫn tương đối trong worktree đó rồi copy ra ngoài. Operator đã xoá worktree (`git worktree remove --force`) trước khi kiểm tra nó còn giữ nội dung chưa commit nào — mất bản gốc. File này được dựng lại nguyên văn nội dung từ báo cáo bàn giao của reviewer (bảng should-fix, always-in-scope, ghi chú phạm vi), không phải reviewer tự viết lại.*
