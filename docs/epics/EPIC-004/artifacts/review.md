# Review Report — Tín hiệu đơn giản (biến động / nhận định tham khảo)

**Epic ID:** `EPIC-004`
**Reviewer:** Reviewer (policy)
**Status:** Complete
**Created:** `2026-10-08`
**Reviewed against:** `docs/RULES.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`, `CHANGELOG.md`, `.aidlc/workspace.yaml` (`risk-security-reviewer`), tiền lệ `docs/epics/EPIC-003/artifacts/review.md` và `docs/epics/EPIC-002/artifacts/review.md`

---

## 1. Verdict

**Overall:** ship with follow-ups. Không có blocker. Không có should-fix chặn merge. Mọi tiêu chuẩn chính sách về code, commit, cấu trúc lệnh, kiến trúc lưu trữ và bảo mật đều đạt (`yes`). Một mục duy nhất chưa kiểm tra (`EPIC-004-AC04` phần "≤ 30 phút" cùng các NFR kèm theo: NFR01, NFR02, NFR04, ngân sách lệnh Upstash) đã được xác định rõ là phụ thuộc vào môi trường production thật (lịch cron-job.org và Upstash Redis thật) và được chuyển giao cho owner theo dõi sau deploy theo đúng kế hoạch.

Finding #12 và #14 của `verify.md` rev 2 (chặn lưu giá ≤ 0 vào lịch sử, làm sai khoảng 7 ngày; cập nhật số lượng test 487 pass) đã được xử lý triệt để trong commit `a657a08`.

---

## 2. Scope reviewed

| | |
|---|---|
| Base | `master` (commit `4f14000`, đã tích hợp EPIC-002-FIX và EPIC-003) |
| Head | `a657a08` (`feature/epic-004-simple-signals`) |
| Files changed | 65 file, +6275/−10. Toàn bộ 19 commit thuộc EPIC-004 (`35cfef4..a657a08`). Nhánh rẽ trực tiếp từ `master`, không bị lệch nhánh như finding #1 của EPIC-003 |
| Read in full | Toàn bộ code trong `src/signals/`, `src/coingecko/`, `src/command-parser/`, `src/webhook/webhook.controller.ts`, `src/digest/digest.controller.ts`, `src/price-alerts/price-alerts-watch.controller.ts`, `src/utils/format-signals.util.ts`, `scripts/signals-report*.js`, `test/signals.redis.e2e-spec.ts`, cùng toàn bộ diff docs (`API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `ROADMAP.md`, `CHANGELOG.md`, `.env.example`). Artifact epic (`intent`–`verify`, `epic-memory.json`, `state.json`) đọc làm ngữ cảnh |

---

## 3. Policy checklist

| Source | Rule | Honored | Ghi chú |
|---|---|---|---|
| `docs/RULES.md` "Adding a new bot command" | Parser → formatter thuần → nhánh xử lý → test bắt buộc + e2e → cập nhật `docs/API.md` | **yes** | Thêm nhóm lệnh `/tinhieu`: parser (`CommandType.SIGNAL_*` trong `command-parser.service.ts`), 7 hàm format thuần trong `format-signals.util.ts` (+spec 303 dòng), xử lý tại `webhook.controller.ts`, spec e2e đầy đủ, `docs/API.md` cập nhật chi tiết |
| `docs/RULES.md` "Env vars chỉ qua `ConfigService`" | Khai báo trong `env.validation.ts` và `configuration.ts` | **yes** | `SIGNALS_CRON_SECRET` (bắt buộc, secret), `SIGNAL_SWING_24H_PCT`, `SIGNAL_SWING_72H_PCT`, `SIGNAL_BAND_PCT` (tuỳ chọn) được validate qua `Joi` và nạp vào `ConfigService`. Không gọi `process.env` trực tiếp ngoài config |
| `docs/RULES.md` "Commit messages — Conventional Commits" | `<type>(<scope>): <summary>` | **yes** | Toàn bộ 19 commit đúng định dạng chuẩn (`feat(signals)`, `feat(coingecko)`, `feat(digest)`, `feat(price-alerts)`, `fix(signals)`, `docs(signals)`, `test(signals)`) |
| `docs/RULES.md` "Branching" | `feature/<desc>` tách từ `master`, merge qua PR | **yes** | Nhánh `feature/epic-004-simple-signals` tạo trực tiếp từ `master` (`4f14000`). Merge base sạch |
| `docs/ARCHITECTURE.md` "Error handling" | `/webhook` luôn `200`, không lộ stack trace | **yes** | Webhook bọc `try/catch` an toàn, trả lời thông báo thân thiện khi CoinGecko bận/lỗi nguồn giá |
| `docs/ARCHITECTURE.md` "Storage boundaries" | Không đánh thức Neon compute không cần thiết | **yes** | Toàn bộ dữ liệu tín hiệu, lịch sử giá và trạng thái lưu trên Upstash Redis qua HTTP REST (`automaticDeserialization: false`). Endpoint cron và webhook tín hiệu không chạm Postgres. Watchlist được đồng bộ 1 chiều sang Redis |
| Quy tắc chống spam & cooldown | Giới hạn tần suất tin chủ động | **yes** | Tối đa 1 tin/giờ/chat, không gửi lại cùng coin trong 24h trừ khi biến động vượt thêm ≥ 5 điểm phần trăm hoặc đổi chiều; hỗ trợ `/tinhieu tat` / `/tinhieu bat` lưu bền vững trên Redis |
| Khuyến cáo miễn trừ trách nhiệm | Bắt buộc có thông báo rủi ro | **yes** | Mọi tin nhắn có nhận định mua/bán đều kèm câu: `⚠️ Chỉ là thông tin tham khảo, không phải lời khuyên đầu tư.` |
| Doc drift | Tài liệu khớp code | **yes** | `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` (bước 8c), `docs/ROADMAP.md`, `CHANGELOG.md` và `.env.example` đều đồng bộ chính xác với code hiện tại |

---

## 4. Findings

| # | Severity | Location | Finding | Trạng thái / Đánh giá |
|---|---|---|---|---|
| 1 | note | `verify.md` §1, §2 (AC04); `DEPLOYMENT.md` bước 8c | `EPIC-004-AC04` (tin chủ động đến trong ≤ 30 phút kể từ khi vượt ngưỡng) cùng NFR01, NFR02, NFR04 và ngân sách lệnh Upstash là các tiêu chí chỉ đo được trên production thực tế qua cron-job.org. | **Accepted post-deploy follow-up** (đúng tiền lệ AC18 của EPIC-002 và AC17 của EPIC-003; owner sẽ theo dõi trong 48h sau deploy). |
| 2 | note (closed) | `src/signals/`, `verify.md` Finding #12 | Giá ≤ 0 hoặc không hữu hạn từng có nguy cơ lọt vào `snapshot` lịch sử làm sai khoảng giá 7 ngày. | **Đã sửa:** Commit `a657a08` đã lọc giá `> 0 && Number.isFinite` tại `snapshot`, `rangePrices`, `parseMembers` và `evaluateWithPrices`, bổ sung unit test xác nhận. |
| 3 | note | `src/coingecko/coingecko.service.ts:166-175`, `verify.md` Finding #4 | Lấp lịch sử qua `market_chart` keyless của CoinGecko có thể gặp HTTP 429 nếu một chat thêm nhiều coin mới cùng lúc trong ngày đầu. | **Mitigated:** Code đã có cơ chế `signals:bf-fail:<coin>` tạm dừng 2 giờ và nuốt lỗi để không chặn luồng cron chính. Sau ngày đầu, dữ liệu đã lấp đầy đủ. |
| 4 | note | `implement.md` §1 | PR trên GitHub chưa mở do môi trường chưa cấu hình GitHub CLI (`gh`). | **Action required before merge:** Owner mở PR trên GitHub theo đường dẫn `https://github.com/tonthienthach/Crypto-Zalo-Bot/pull/new/feature/epic-004-simple-signals` để CI chạy và merge vào `master`. |

---

## 5. Always-in-scope checks

| Check | Result |
|---|---|
| Secrets in code / fixtures / logs | **Clean:** Không commit secret nào; `SIGNALS_CRON_SECRET` bảo vệ qua header `Bearer`; log `signals-run` chỉ ghi số lượng (`coins`, `chatsAlerted`, `failures`), không ghi nhận định hay thông tin nhạy cảm |
| Data handling (PII, retention, boundaries) | **Clean:** Dữ liệu gắn theo `chatId`; lịch sử giá cắt tỉa tự động (8 ngày theo giờ, 90 ngày theo ngày); không lưu dữ liệu tài sản/giao dịch |
| Silent failure | **Clean:** Lỗi gọi giá hoặc gửi tin được ghi log chi tiết; lỗi tính tín hiệu cho 1 chat trong bản tin không ảnh hưởng đến phần giá và các chat khác |
| Newly reachable surface | Route mới `GET/POST /cron/signals` được bảo vệ bằng `SignalsCronSecretGuard`; các lệnh `/tinhieu` được bảo vệ bởi rate limiter toàn cục `UserThrottlerGuard` |

---

## 6. Not re-checked

Kế thừa kết quả xác minh độc lập từ `verify.md` rev 2:
- **17/18 Acceptance Criteria pass** (AC01–AC03, AC05–AC18).
- **Unit test:** 33/33 test suites, 487/487 tests pass (`npm test`).
- **E2E test:** 84 pass, 18 skip (chỉ skip các test opt-in cần Postgres URL).
- **Static analysis:** `eslint` 0 error, `tsc --noEmit` 0 error.

---

## 7. Shortest path to ship

1. **Mở PR và Merge:** Mở PR từ nhánh `feature/epic-004-simple-signals` vào `master`. Sau khi CI xanh, tiến hành merge.
2. **Cấu hình môi trường (trước deploy):** Thiết lập biến môi trường trên Vercel:
   - `SIGNALS_CRON_SECRET` = `<chuỗi ngẫu nhiên bí mật>`
3. **Deploy:** Chạy `vercel deploy --prod` (không có migration cơ sở dữ liệu vì EPIC-004 hoàn toàn dùng Redis).
4. **Kích hoạt lịch Cron (sau deploy):**
   - Chạy thử nghiệm thủ công 1 lần: `curl -H "Authorization: Bearer <SIGNALS_CRON_SECRET>" https://<domain>/cron/signals`
   - Tạo cron job trên **cron-job.org**: gọi `GET https://<domain>/cron/signals` mỗi 30 phút, kèm header `Authorization: Bearer <SIGNALS_CRON_SECRET>`.
5. **Theo dõi sau deploy (owner, 48 giờ):**
   - Kiểm tra log `signals-run` để hoàn tất nghiệm thu AC04.
   - Chạy `npm run signals:report` để kiểm tra thống kê sử dụng và độ trễ NFR01/NFR02.

---

## 8. Policy amendments

Không có đề xuất sửa đổi chính sách mới. EPIC-004 tuân thủ đầy đủ quy trình branching từ `master`, conventional commits, phân tách tầng lưu trữ không chạm Postgres compute, và áp dụng chặt chẽ quy định về disclaimers tài chính.
