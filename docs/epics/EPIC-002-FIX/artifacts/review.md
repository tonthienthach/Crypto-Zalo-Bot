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

## 6. Follow-up cần verify thêm trước merge

- Verify độc lập nhanh cho 2 commit `0aba0b4` và `a7287d2` (chưa qua verify rev nào), trước khi coi verify là đã đóng hoàn toàn.

---

*Ghi chú bàn giao: reviewer viết report này trong một git worktree riêng, dự định để tại đường dẫn tương đối trong worktree đó rồi copy ra ngoài. Operator đã xoá worktree (`git worktree remove --force`) trước khi kiểm tra nó còn giữ nội dung chưa commit nào — mất bản gốc. File này được dựng lại nguyên văn nội dung từ báo cáo bàn giao của reviewer (bảng should-fix, always-in-scope, ghi chú phạm vi), không phải reviewer tự viết lại.*
