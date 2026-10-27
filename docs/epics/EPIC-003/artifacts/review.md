# Review Report — Theo dõi danh mục (portfolio)

**Epic ID:** `EPIC-003`
**Reviewer:** Reviewer (policy)
**Status:** Draft
**Created:** `2026-09-29`
**Reviewed against:** `docs/RULES.md` (repo không có `CLAUDE.md`; giống EPIC-001/002), `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `.aidlc/workspace.yaml` (`risk-security-reviewer`), tiền lệ `docs/epics/EPIC-002/artifacts/review.md`

---

## 1. Verdict

**Overall:** ship with follow-ups. Không có blocker. Có 1 should-fix (branch hygiene, #1) và các follow-up mà `verify.md` đã tự nhận là untested (AC17, AC19 qua driver Neon thật, AC20) — owner phải đóng sau deploy, đúng như plan/verify đã vạch ra; đây không phải điều gì review phát hiện mới, nhưng review xác nhận đường đóng chúng là hợp lý và không có defect code nào che giấu phía sau.

## 2. Scope reviewed

| | |
|---|---|
| Base | `feature/epic-002-fix-alert-monitoring` (nhánh này rẽ từ đó, không từ `master` — xem finding #1) |
| Head | `a7ae9b1` (`feature/epic-003-portfolio-tracking`) |
| Files changed | 41 file, +4532/−106. Commit riêng của EPIC-003: `6d0e596..96576cc` (18 commit feat/fix/docs/test/chore), cộng 3 commit merge/chore đưa EPIC-002-FIX vào (`a0f8c04`, `63c616b`, `a7ae9b1`) không thuộc nội dung epic này |
| Read in full | file-by-file: mọi file trong `src/portfolio/`, `src/command-parser/`, `src/webhook/webhook.controller.ts`, `src/digest/digest.controller.ts`, `src/utils/format-message.util.ts`, `db/migrations/0002_create_portfolio.sql`, `scripts/db-migrate.js`, `scripts/portfolio-usage-report*.js`, và toàn bộ diff docs (`API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `ROADMAP.md`). Artifact epic (`intent`–`verify`, `epic-memory.json`, `state.json`) đọc làm ngữ cảnh, không review như code |

**Ghi chú phạm vi:** `implement.md` đã ghi rõ nhánh này chứa cả code EPIC-002-FIX vì "làm lần lượt" theo quyết định owner; review chỉ chấm phần EPIC-003 (commit ở trên), phần EPIC-002-FIX là nội dung của review riêng cho epic đó.

## 3. Policy checklist

| Source | Rule | Honored |
|---|---|---|
| `docs/RULES.md` "Adding a new bot command" | Parser → formatter thuần → nhánh xử lý → test bắt buộc + e2e khi có dependency mới → cập nhật `docs/API.md` | yes: `command-parser.service.ts` (+spec), 16 formatter thuần mới trong `format-message.util.ts` (+spec riêng `format-portfolio.util.spec.ts`), `replyToPortfolioCommand` trong `webhook.controller.ts`, e2e đầy đủ, `docs/API.md` có bảng lệnh `/danhmuc` khớp đúng luật số cuối cùng |
| `docs/RULES.md` "Env vars chỉ qua `ConfigService`" | Không có env mới thêm ngoài quy trình | yes: không đổi `env.validation.ts`/`configuration.ts` (đúng plan §7) |
| `docs/RULES.md` "Commit messages — Conventional Commits" | `<type>(<scope>): <summary>` | yes: toàn bộ 18 commit EPIC-003 đúng dạng (`feat(portfolio)`, `fix(command-parser)`, `docs(epic-003)`, `test(portfolio)`, `chore(epic-003)`) |
| `docs/RULES.md` "Branching" | `feature/<desc>` **tách từ `master`**, merge qua PR khi CI xanh | **no** — xem finding #1 |
| `docs/ARCHITECTURE.md` "Error handling": `/webhook` luôn `200`, không lộ stack | yes: `handleReplyError` bọc lỗi portfolio; `PortfolioUnavailableError` chỉ chứa tên lỗi + SQLSTATE, không ghép chuỗi lỗi gốc (`portfolio.service.ts`) |
| Trust boundary mới: chỉ chat riêng (spec FR12, Concern 3/4) | Mọi giá trị `chat_type` khác `PRIVATE`, **kể cả thiếu trường**, bị từ chối trước khi chạm store/nguồn giá | yes: `webhook.controller.ts:249` `(chatType ?? '').toUpperCase() !== 'PRIVATE'` — an toàn theo hướng chặn nhầm hơn là lộ nhầm, đúng risk decision trong `plan.md` §"Risks" |
| NFR06 "không log số liệu tài chính" | Log chỉ có chat, loại lệnh, kết quả, thời gian | yes: `portfolio-view` log chỉ có `chatId, coins (đếm), durationMs`; log từ chối nhóm chỉ có `chat_type`; lỗi DB log tên lỗi + SQLSTATE. AC16 có e2e quét toàn bộ output `Logger` |
| Money/precision (NFR01, NFR07) | Giá vốn trung bình gia quyền, không lệch tích luỹ, số dương/giới hạn chữ số | yes: `computeHoldings()` dùng `bigint` đơn vị 10⁻⁸ cho số lượng, tính lại giá vốn từ đầu mỗi lần replay (không trừ dồn); `NUMERIC(21,8)` đủ cho 10¹² × 8 chữ số lẻ (plan đã tự sửa từ (20,8) sang (21,8), đúng) |
| Migration safety | `ALTER TABLE … IF NOT EXISTS` cho bảng đã tồn tại trước | yes: `0002_create_portfolio.sql` dùng toàn `IF NOT EXISTS`; cột `source_message_id` thêm sau bằng `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (dòng 29-31) cho DB đã chạy bản 0002 cũ (trước rev 2). `verify.md` §2/§3 đã tự chạy migrate 2 lần trên DB mới lẫn DB cũ (PGlite), xác nhận đúng 1 CHECK, không trùng |
| Rollback / deploy ordering (`DEPLOYMENT.md`) | Có đường lùi; migration chạy trước code | yes: `DEPLOYMENT.md` mục "Portfolio tables" nói rõ `npm run db:migrate` **trước** deploy, `vercel rollback` an toàn vì code cũ không đọc bảng mới, và có lệnh `DROP TABLE` (mất dữ liệu, chỉ khi owner quyết) cho gỡ hẳn |
| Doc drift (API.md/ARCHITECTURE.md/DEPLOYMENT.md khớp code và luật comma cuối) | | yes: `API.md` đã ghi đúng luật rev 4 ("quantity takes no comma at all … refused"), khớp `PLAIN_NUMBER_PATTERN` trong code và spec FR02 hiện hành; `ARCHITECTURE.md` có mục "Portfolio" mô tả đúng khoá advisory, 1 round-trip, cách bản tin gộp giá, không log số tiền |
| Abuse vector (NFR10) | `/danhmuc` chịu rate-limit chung | yes: `UserThrottlerGuard` là `APP_GUARD` toàn cục (`app.module.ts:47`), áp cho mọi route kể cả `/webhook`, cộng NFR05 (200 giao dịch/20 coin) |
| Concern 5/8 (spec) — không tăng số lần gọi nguồn giá định kỳ | Bản tin chỉ +1 truy vấn DB mỗi ngày, vẫn 1 lần gọi giá/subscriber | yes: `DigestController` tải trades bằng 1 truy vấn trước vòng lặp, gộp watchlist ∪ held coins vào 1 lần `getPricesBySymbols` |

## 4. Findings

| # | Severity | Location | Finding | Policy |
|---|---|---|---|---|
| 1 | should-fix | `implement.md` §1; lịch sử nhánh | Nhánh `feature/epic-003-portfolio-tracking` tách từ `feature/epic-002-fix-alert-monitoring`, không từ `master`. `implement.md` đã tự ghi nhận và giải thích lý do (làm tuần tự theo quyết định owner), và PR cho nhánh này **chưa mở** — đúng hướng dẫn của chính `implement.md` là merge EPIC-002-FIX vào `master` trước rồi mới mở PR để diff EPIC-003 gọn. Việc cần làm trước khi merge: xác nhận `feature/epic-002-fix-alert-monitoring` đã vào `master`, rồi mở PR `feature/epic-003-portfolio-tracking -> master` để CI chạy trên diff thật (hiện diff mang theo cả EPIC-002-FIX). Không phải sai sót ẩn — engineer đã tự khai — nhưng vẫn là điều kiện RULES.md yêu cầu trước merge | `docs/RULES.md` "Branching" ("branched from `master`", "merged back … via PR once CI passes") |
| 2 | note | `verify.md` §1, §6 finding #12; `test/portfolio.postgres.e2e-spec.ts` | AC19 (tranh chấp khoá thật qua driver Neon HTTP) và AC17 (p95 production) vẫn untested trước merge — do hạn chế máy verifier (không Docker/Neon branch), không phải do code thiếu proof. Bằng chứng gián tiếp đã đủ thuyết phục: `pg_advisory_xact_lock` + `WHERE`/`HAVING` cùng câu ghi, 18 kịch bản PGlite (Postgres thật bản WASM) pass, kể cả rollback giữa chừng. Owner đã duyệt deferred sang post-deploy (state.json rev 2 approval note), nên đây là follow-up đã có chủ, không phải gap mới do review tìm ra | `verify.md` §7 "Shortest path to pass" bước 1 (đã ghi), nhắc lại vì đây là điều kiện cần đóng, không phải tuỳ chọn |
| 3 | note | `docs/epics/EPIC-003/artifacts/verify.md` §4 (cuối) | `implement.md` ghi số unit test **288** ở một chỗ và **313** ở chỗ khác (sau rev 4), còn `verify.md` rev 2 đếm **309** trên HEAD trước rev 4 (`8f8fa27`) — mỗi số ứng với một mốc rebase/rev khác nhau nên không mâu thuẫn, nhưng dễ gây nhầm khi đọc lướt vì không có bảng đối chiếu HEAD ↔ số test. Không chặn gì, chỉ nên gộp một dòng "N test tại HEAD X" trong lần chỉnh sửa tiếp theo của `implement.md` | `opinion` (rõ ràng tài liệu) |
| 4 | note | `command-parser.service.ts:39-46`; `spec.md` FR02 (rev 2026-09-29) | Luật số lượng cuối cùng ("không dấu phẩy dưới bất kỳ hình thức nào") đã nhất quán giữa `spec.md`, `implement.md` rev 4, `verify.md` rev 2, `docs/API.md` và code (`PLAIN_NUMBER_PATTERN`) — khớp đúng yêu cầu review đối chiếu 3 tài liệu + code. Ghi lại để xác nhận, không phải finding | `opinion` |
| 5 | note | `implement.md` §6 "Known gaps"; `portfolio.service.ts` (dedup) | Hai rủi ro được owner chấp nhận rõ ràng (tin gửi lại sau khi giao dịch gốc đã bị xoá vẫn ghi lại; `message_id` > 128 ký tự bỏ qua chống lặp) đã có test và đúng như spec chấp nhận ở FR16 (không cấm 2 giao dịch giống hệt, chỉ cảnh báo). Không phải defect, chỉ nhắc để reviewer sau này không lặp lại việc điều tra | `opinion` |
| 6 | note | `docs/ROADMAP.md`, `CHANGELOG.md` | Chưa cập nhật cho EPIC-003 (chỉ EPIC-002 được cập nhật trong diff này). Đúng theo `plan.md` §2 ("cập nhật khi ship") — không phải doc drift, chỉ là việc còn treo tới lúc deploy | `opinion` |

## 5. Always-in-scope checks

| Check | Result |
|---|---|
| Secrets in code / fixtures / logs | clean: không có env/secret mới; không log số lượng/giá/lãi-lỗ ở bất kỳ nhánh log nào đã đọc |
| Data handling (PII, retention, boundaries) | clean: dữ liệu tài chính chỉ gắn theo `chat_id`, đọc/sửa/xoá giới hạn trong chính chat (`WHERE chat_id = …` ở mọi câu SQL); giới hạn 64 ký tự chat id, 20 ký tự symbol, 200 giao dịch/20 coin (NFR05) đều có `CHECK` ở DB lẫn kiểm tra ở service, không chỉ ở tầng ứng dụng |
| Silent failure (swallowed errors, ignored codes) | clean: lỗi DB luôn được bọc `PortfolioUnavailableError` và trả lời thân thiện + `200`; lỗi tính danh mục trong bản tin có `try/catch` riêng và ghi log (`daily-digest-run` có `portfolioFailures`), không rơi im lặng |
| Newly reachable surface (API, route, permission) | Không có route HTTP mới (chỉ thêm nhánh lệnh trong `/webhook` hiện có); trust boundary mới là "chat riêng" cho một tập lệnh, được chặn ở một điểm duy nhất (`replyToPortfolioCommand`) trước khi chạm store hay nguồn giá — xem checklist §3 |

## 6. Not re-checked

Đã được `verify.md` rev 2 (HEAD `8f8fa27` + rev 3/4 tiếp theo) kiểm, ở đây chỉ trích lại:

- AC01–AC16, AC18, AC21 pass với bằng chứng chạy thật (unit, e2e, PGlite trên đúng code HEAD).
- AC17 (thời gian) và AC20 (đối chiếu app sàn) untested vì cần dữ liệu production — owner đã duyệt deferred (`state.json`).
- AC19 phần đồng thời qua driver Neon HTTP thật untested vì máy verify không có Docker/Neon branch — cùng lý do deferred.
- Regressions: verify đã tự chạy lint/unit/e2e/build trên HEAD gần nhất và không thấy hồi quy từ các bản sửa rev 2–4.
- Out-of-scope check của verify (§5): sạch, không ship nhầm gì ngoài spec.

## 7. Shortest path to ship

Verdict là ship with follow-ups; không có gì bắt buộc sửa code trước khi merge:

1. **Trước khi mở PR:** xác nhận `feature/epic-002-fix-alert-monitoring` đã merge vào `master`, rồi mở PR `feature/epic-003-portfolio-tracking -> master` để CI chạy trên diff gọn của riêng EPIC-003 (finding #1).
2. **Trước/trong lúc deploy** (đã ghi trong `implement.md` §6 và `DEPLOYMENT.md`): chạy `npm run db:migrate` (0002) trên production **trước** `vercel deploy --prod`; smoke test `/danhmuc` từ chat riêng thật để xác nhận `chat_type` nhận đúng `PRIVATE`.
3. **Sau deploy (owner, theo dõi 7 ngày):** đo p95 `portfolio-view.durationMs` để đóng AC17; đối chiếu `/danhmuc` với app sàn để đóng AC20; nếu có điều kiện, chạy `test/portfolio.postgres.e2e-spec.ts` qua một Neon branch tạm để đóng AC19 phần đồng thời.
4. Tuỳ chọn: gộp con số test trong `implement.md` (#3), cập nhật `ROADMAP.md`/`CHANGELOG.md` khi ship (#6).

## 8. Policy amendments

Không có. Không thấy rule nào bị vi phạm lặp lại hay thiếu rule cần viết mới — finding #1 (branch hygiene) là lần thứ hai xuất hiện dạng "nhánh rẽ từ nhánh khác thay vì `master`" (EPIC-002 review §4 finding #8 từng ghi trường hợp tương tự với một nhánh docs), nhưng ở đây engineer đã tự khai rõ trong `implement.md` và nêu đúng cách xử lý (merge trước, PR sau), nên chưa cần đề xuất luật mới — chỉ cần nhắc lại kỷ luật đã có.
