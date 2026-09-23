# Review Report — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Reviewer:** Reviewer (policy)
**Status:** Draft
**Created:** `2026-09-23`
**Reviewed against:** `docs/RULES.md` (repo không có `CLAUDE.md`; `docs/RULES.md` thay thế, giống EPIC-001), `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `.aidlc/skills/risk-security-reviewer.md`, `.aidlc/skills/code-reviewer.md`, tiền lệ `docs/epics/EPIC-001/artifacts/review.md`

---

## 1. Verdict

**Overall:** ship. Không có blocker. Có 2 should-fix cần owner xử lý hoặc chấp nhận rõ ràng trước lúc merge/deploy (#1 secret dùng chung với bên thứ ba, #2 thứ tự deploy Upstash), cùng một số note.

## 2. Scope reviewed

| | |
|---|---|
| Base | `master` (merge-base của `git diff master...HEAD`) |
| Head | `ee22d23` (`feature/epic-002-price-alerts`, PR #3) |
| Files changed | 45 file, +3537/−36 (22 file trong `src/`, +1722/−4). 15 commit, `e9f01af`..`ee22d23` |
| Read in full | file-by-file: mọi file trong `src/`, `test/`, `scripts/`, `package.json`, `.env.example`; docs đọc qua diff (`API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `CHANGELOG.md`, `ROADMAP.md`, `.aidlc/workspace.yaml`). Artifact của epic (`intent`/`spec`/`plan`/`implement`/`verify`, `state.json`) đọc làm ngữ cảnh, không review như code. |

**Ghi chú phạm vi:** commit đầu `e9f01af` (`docs(roadmap): mark EPIC-001 deployed to production`) thuộc nhánh `docs/mark-epic-001-deployed`, đã push nhưng chưa merge vào `master`. Branch này được tách từ nhánh đó, nên commit này đi kèm trong PR #3. Mình không review nó như code của EPIC-002 (nó chạm `docs/ROADMAP.md` phần Initiative 1 và `docs/epics/EPIC-001/epic-memory.json`); xem note #8.

**Kiểm tra cơ học (reviewer tự chạy trên `ee22d23`, 2026-09-23):**

```
npm run lint      -> exit 0 (git status vẫn sạch sau --fix)
npm test          -> Test Suites: 10 passed / Tests: 131 passed, 131 total
npm run test:e2e  -> Test Suites: 1 skipped, 1 passed / Tests: 5 skipped, 20 passed, 25 total
npm run build     -> exit 0
```

5 test bị skip là `test/price-alerts.redis.e2e-spec.ts`, spec integration opt-in cần `REDIS_INT_URL`. Mình không chạy Docker; kết quả integration với Redis thật lấy từ `verify.md` rev 2. Không xem được trạng thái CI của PR #3 (máy không có `gh`). Các e2e tự đặt `KV_REST_API_*` trong `test/webhook.e2e-spec.ts:17-18`, nên block env trong `.github/workflows/ci.yml` không cần thêm gì.

## 3. Policy checklist

| Source | Rule | Honored |
|---|---|---|
| `docs/RULES.md` "Naming conventions" | File kebab-case theo vai trò; class/interface PascalCase, không tiền tố `I`; hằng UPPER_SNAKE_CASE | yes: `price-alerts.controller.ts`, `price-alert-evaluator.ts`, `PriceAlertsService`, `PriceAlert`, `MAX_ALERTS_PER_CHAT`, `REDIS_KEYS`, `KV_REST_API_URL` |
| `docs/RULES.md` "Env vars … never `process.env.X` outside of `src/config/`" | Env chỉ đọc qua `ConfigService`/`configuration.ts` | yes: trong `src/` chỉ `configuration.ts` đọc `KV_REST_API_*`; `PriceAlertsService` lấy qua `ConfigService.get('redis.*')`. `scripts/price-alerts-report.js` đọc `process.env`, giống tiền lệ `scripts/db-migrate.js` (script ngoài `src/`) |
| `docs/RULES.md` "Code style": `env.validation.ts` là nguồn duy nhất | Env mới khai báo trong Joi schema | yes: `src/config/env.validation.ts:49-50` (`uri().required()`, `required()`); xem should-fix #2 về hệ quả của `required` khi deploy |
| `docs/RULES.md` "Adding a new module" | Hình dạng `*.module.ts`/`*.service.ts`/`interfaces/`; chỉ export thứ cần; import hẹp nhất | yes: `PriceAlertsModule` chỉ export `PriceAlertsService`; import vào `WebhookModule` (cần service) và `AppModule` (để đăng ký controller cron), đúng như plan nêu |
| `docs/RULES.md` "Adding a new module" bước 3 | Có `.spec.ts` cạnh mọi service có logic không tầm thường | yes: `price-alerts.service.spec.ts`, `price-alerts.controller.spec.ts`, `price-alert-evaluator.spec.ts`, và `zalo.service.spec.ts` mới (trước đây service này chưa có spec) |
| `docs/RULES.md` "Adding a new bot command" 1–5 | Parser → formatter thuần → nhánh `switch` → test (parser, formatter, e2e khi có dependency mới) → `docs/API.md` | yes: `command-parser.service.ts` (+ spec), 8 formatter thuần trong `format-message.util.ts` (+ spec), 4 `case ALERT_*` trong `webhook.controller.ts`, e2e `/canhbao` và `/cron/price-alerts`, bảng lệnh và endpoint trong `docs/API.md` |
| `docs/RULES.md` "Testing requirements" | Tính năng mới có test; controller wiring có e2e với override provider | yes: e2e override `PriceAlertsService`; suite unit 63 → 131 |
| `docs/RULES.md` "Code style": không `any` không lý do | | yes: không thấy `any` mới trong diff |
| `docs/RULES.md` "Commit messages — Conventional Commits" | `<type>(<scope>): <summary>` | yes: cả 15 commit (`feat(price-alerts)`, `feat(webhook)`, `fix(price-alerts)`, `docs(epic-002)`, `chore(epic-002)`, …) |
| `docs/RULES.md` "Branching" | `feature/<desc>` từ `master`, merge qua PR khi CI xanh | partial: tên nhánh và PR #3 đúng; nhánh tách từ một nhánh docs chưa merge chứ không từ `master` (note #8) |
| `docs/ARCHITECTURE.md` "Error handling philosophy" | Không im lặng, không lộ stack trace, `/webhook*` và `/cron/*` luôn `200` | yes: `PriceAlertsController.checkPriceAlerts` bọc toàn bộ lượt chạy trong try/catch/finally và luôn trả `{ ok: true }` (`price-alerts.controller.ts:39-63`); stack chỉ ghi log phía server; lỗi mới trong webhook có câu trả lời riêng, lỗi còn lại rơi vào reply chung và được log. `401` của guard vẫn giữ, theo `docs/API.md` |
| `docs/ARCHITECTURE.md` `zalo/`: "Never throws" | Đổi kiểu trả về không phá đảm bảo này | yes: `zalo.service.ts` trả `false` ở cả hai nhánh lỗi, không throw; caller cũ bỏ qua giá trị trả về |
| `risk-security-reviewer.md` §1 "New data at rest" | Chỉ lưu trường cần thiết, không PII thừa | yes: `chatId`, symbol, direction, threshold, state, timestamp; delivery log lưu thêm giá; không lưu tên hay nội dung tin nhắn |
| `risk-security-reviewer.md` §2 "New trust boundary" | Endpoint mới được guard chặt như guard hiện có | yes cho guard (`CronSecretGuard`, e2e AC16); **partial** cho secret: xem should-fix #1 |
| `risk-security-reviewer.md` §3 "Abuse vectors" | Chặn chi phí/spam không giới hạn | yes ở mức từng chat: tối đa 10 cảnh báo, `UserThrottlerGuard`, input bị giới hạn (`chat.id` ≤ 64, symbol ≤ 20, threshold (0, 10^12], ≤ 8 số lẻ), cooldown 15 phút, khoá lượt; không có trần tổng (note #9) |
| `risk-security-reviewer.md` §4 "Secrets handling" | Env mới theo pattern Joi fail-fast, không bao giờ log | yes: không log token Redis; URL Zalo chứa bot token không xuất hiện trong log vì chỉ log `error.message` |
| `risk-security-reviewer.md` §5 "Failure/leak check" | Không lộ dữ liệu chat khác | yes: `deleteByIndex` chỉ tìm trong list của chính `chatId`; lượt kiểm tra gửi tới `alert.chatId` của từng cảnh báo |
| `code-reviewer.md` "mechanical checks" | lint, build, test phải qua | yes (§2) |
| Rollback (`docs/DEPLOYMENT.md` §7, §8a) | Có đường lùi | yes: tắt job cron-job.org, rồi `vercel rollback` về bản trước (bản đó không cần `KV_REST_API_*`). Không có migration Postgres; dữ liệu Redis tách riêng |

## 4. Findings

| # | Severity | Location | Finding | Policy |
|---|---|---|---|---|
| 1 | should-fix | `docs/DEPLOYMENT.md` §8a bước 2 ("same secret as the digest cron"); `src/price-alerts/price-alerts.controller.ts:33` | `/cron/price-alerts` dùng chung `CRON_SECRET_TOKEN` với `/cron/daily-digest`, và secret này giờ được lưu ở một bên thứ ba (cron-job.org). Trước epic này, secret chỉ nằm trên Vercel. Nếu tài khoản cron-job.org bị lộ, kẻ tấn công có thể gọi `/cron/daily-digest` bao nhiêu lần cũng được. Endpoint đó không có khoá hay cơ chế chống gọi lặp, nên mỗi lần gọi sẽ gửi bản tin tới **mọi** subscriber và tốn Neon compute. Riêng `/cron/price-alerts` thì an toàn khi bị gọi lặp (khoá lượt, cooldown). Cách sửa: dùng một secret riêng cho endpoint mới (vd. `PRICE_ALERTS_CRON_SECRET`, khai báo trong `env.validation.ts`), hoặc owner chấp nhận rủi ro bằng văn bản. So sánh `!==` trong `CronSecretGuard` không chạy trong thời gian cố định; lỗi này có từ trước và thực tế khó khai thác, chỉ ghi lại. | `.aidlc/skills/risk-security-reviewer.md` §2 "New trust boundary" và §4 "Secrets handling"; `spec.md` §2 (dòng `docs/ARCHITECTURE.md`: "Endpoint do máy gọi phải có guard dùng secret riêng") |
| 2 | should-fix | `src/config/env.validation.ts:49-50`; `docs/DEPLOYMENT.md` §3b, §9 | `KV_REST_API_URL`/`KV_REST_API_TOKEN` là `required`, nên thiếu chúng thì **cả ứng dụng** không khởi động được, kể cả `/gia`, `/dangky` và bản tin 9h. `DEPLOYMENT.md` §9 nói Git integration tự deploy production mỗi khi có push lên nhánh chính. Nghĩa là merge PR #3 trước khi gắn Upstash vào môi trường **Production** sẽ làm bot sập toàn bộ. §3b có mô tả bước gắn Upstash, nhưng chưa nói rõ bước đó phải xong **trước khi merge**. Hiện chỉ có câu cảnh báo cho Preview. Cách sửa: thêm một dòng cảnh báo thứ tự vào §3b/§8a (tốn ít nhất). Cách khác là để Redis không bắt buộc lúc boot, nhưng việc đó lớn hơn và không cần thiết. | `docs/ARCHITECTURE.md` "Error handling philosophy" ("never go silent"); `docs/RULES.md` "Branching" (`master` "always deployable") |
| 3 | note | `docs/DEPLOYMENT.md` §3b bước 2 và §8a bước 4 | Hai chỗ mâu thuẫn nhau: §3b bảo kết nối Upstash cho "Production, Preview and Development", còn §8a nói "Upstash is attached to Production + Preview only". Nên thống nhất một cách. | `opinion` (độ chính xác của docs) |
| 4 | note | `docs/ROADMAP.md` (Initiative 1, đoạn "Tracked as") | Đoạn này vẫn ghi "`chat.id` has no max length before being persisted — not yet fixed", trong khi chính PR này đã sửa bằng `@MaxLength(64)` (`src/webhook/dto/zalo-webhook.dto.ts`, commit `3e51687`; `CHANGELOG.md` có ghi). Dòng này đến từ `e9f01af`, nhưng merge PR #3 thì nó thành sai. Cũng nên cập nhật `docs/ARCHITECTURE.md` mục "best-effort cache", chỗ ghi "no Redis": câu đó vẫn đúng với cache, nhưng giờ dễ gây hiểu lầm. | `opinion` (độ chính xác của docs) |
| 5 | note | `src/price-alerts/price-alerts.controller.ts:87-90`; `src/coingecko/coingecko.service.ts:70-71` | Cảnh báo nào không có giá trong lượt chạy thì bị `continue` bỏ qua mà không log, không đếm vào summary. Điều này đúng spec (giữ nguyên trạng thái), nhưng một coin bị gỡ khỏi nguồn giá sẽ khiến cảnh báo "chết" lặng lẽ mãi mãi. Ngoài ra `matic` và `pol` cùng map sang `matic-network`. Khi tra giá gộp, `idToSymbol` bị ghi đè, nên một trong hai symbol rơi sang CoinPaprika (hoặc không có giá). Lỗi này có từ trước với `/gia matic pol`, nhưng giờ dễ gặp hơn vì lượt kiểm tra gộp symbol của mọi chat vào một lần gọi. Gợi ý: thêm trường `unpriced` vào `AlertRunSummary`. | `opinion`; liên quan `docs/ARCHITECTURE.md` "never go silent" |
| 6 | note | `docs/DEPLOYMENT.md` §8a bước 4 | `vercel env pull .env --environment=production` ghi **mọi** secret production (`ZALO_BOT_TOKEN`, `WEBHOOK_SECRET_TOKEN`, `POSTGRES_URL`, `CRON_SECRET_TOKEN`) ra đĩa máy local chỉ để đọc hai biến `KV_*`. `.env` có trong `.gitignore`, nên không lộ qua git. Nên pull ra file riêng rồi xoá sau khi dùng, hoặc chỉ export hai biến `KV_*` trong shell. Script báo cáo còn in `chatId` của mọi chat ra terminal; ở mức công cụ admin thì chấp nhận được. | `.aidlc/skills/risk-security-reviewer.md` §4 "Secrets handling" (một phần `opinion`) |
| 7 | note | `src/price-alerts/price-alerts.controller.ts:32` | `@All('price-alerts')` nhận mọi HTTP method cho một endpoint có ghi trạng thái. Hành vi này nhất quán với `DigestController`, đã ghi trong `docs/API.md`, và có guard bảo vệ. Chỉ ghi lại để biết. | `opinion` |
| 8 | note | lịch sử nhánh (`e9f01af`) | Nhánh được tách từ `docs/mark-epic-001-deployed`, một nhánh chưa merge, nên PR #3 mang theo `e9f01af`. Nên merge PR của nhánh docs trước (khi đó `e9f01af` biến khỏi diff), hoặc ghi rõ trong mô tả PR #3 là nó đi kèm. Commit đó không có vấn đề gì về nội dung, ngoài note #4. | `docs/RULES.md` "Branching" ("`feature/<short-description>` — branched from `master`") |
| 9 | note | `src/price-alerts/price-alerts.service.ts:154-157` (`listAll` → `MGET` mọi cảnh báo) | Không có trần tổng số cảnh báo. Nhiều chat, mỗi chat 10 cảnh báo, sẽ đẩy băng thông Upstash và CPU Vercel lên; trần khoảng 1.000 cảnh báo đã ghi trong `docs/ARCHITECTURE.md` "Budgets to watch". Spec Concern 5 đã chấp nhận ở quy mô hiện tại, nên ở đây chỉ trích lại, không bàn lại. | `.aidlc/skills/risk-security-reviewer.md` §3 (đã chấp nhận ở `spec.md` §8 Concern 5) |

## 5. Always-in-scope checks

| Check | Result |
|---|---|
| Secrets in code / fixtures / logs | clean trong code: `.env.example` chỉ có placeholder; token trong test là giá trị giả; không log token Redis hay bot token (`ZaloService` chỉ log `error.message`, không log URL). Có finding #1 (secret dùng chung với bên thứ ba) và #6 (pull secret production ra đĩa) |
| Data handling (PII, retention, boundaries) | clean: chỉ lưu `chatId` và tham số cảnh báo; delivery/run log bị giới hạn bằng `LTRIM` (1.000 / 1.000 / 1.440 mục); set rỗng của chat tự biến mất khi xoá hết; không có đường nào lộ dữ liệu sang chat khác. Cảnh báo của chat đã chặn bot tồn tại mãi (spec §7 cho là out of scope) |
| Silent failure (swallowed errors, ignored codes) | clean ở mức lỗi: mọi catch mới đều log (`price-alerts.controller.ts:49-57, 94-101, 118-124`), và `ZaloService` log trước khi trả `false`. Có note #5 (cảnh báo không có giá bị bỏ qua mà không log) |
| Newly reachable surface (API, route, permission) | finding #1: route mới `/cron/price-alerts` (mọi method), có `CronSecretGuard`, cộng throttler toàn cục theo IP; `401` khi thiếu hoặc sai secret (e2e AC16). Các lệnh `/canhbao` đi qua `POST /webhook` sẵn có (`WebhookSecretGuard` + `UserThrottlerGuard`) |

## 6. Not re-checked

Đã được `verify.md` rev 3 (HEAD `f1d81cb`) kiểm, ở đây chỉ trích lại, không làm lại:

- AC01–AC17 và AC19 pass; **AC18 untested** vì cần 24 giờ quan sát production (`verify.md` §2, §7). Owner phải chạy sau deploy.
- Integration với Redis thật (`SET NX`/`XX`, `EVAL` compare-and-delete, `LTRIM`) chạy 5/5 ở rev 2; service không đổi kể từ đó.
- Các vấn đề còn mở mà verify đã chấp nhận: NFR02 không bị chặn cứng khi nguồn giá chậm (`verify.md` §6 #1, theo dõi `durationMs` p95); gửi trùng hiếm gặp nếu `updateState` lỗi ngay sau khi gửi thành công; `chat.id` > 64 ký tự trả `400` (§6 #5); giới hạn 10 cảnh báo không atomic (`implement.md` §6).
- Out-of-scope leak check: sạch (`verify.md` §5).
- Từ `f1d81cb` tới `ee22d23` chỉ có commit docs/chore (`88b95c8`, `ee22d23`). Mình đã chạy lại lint/unit/e2e/build trên `ee22d23` (§2), kết quả giống verify.

## 7. Shortest path to ship

Verdict là ship; mục này chỉ liệt kê việc owner cần làm, không phải điều kiện để lật verdict:

1. **Trước khi merge PR #3:** gắn Upstash vào môi trường **Production** (và Preview) theo `docs/DEPLOYMENT.md` §3b, rồi kiểm tra `KV_REST_API_URL`/`KV_REST_API_TOKEN` đã có trên Vercel. Nếu không, lần auto-deploy sẽ làm cả bot sập (#2). Nên thêm câu cảnh báo này vào §3b.
2. Quyết định #1: tách secret cho `/cron/price-alerts` (một thay đổi nhỏ qua engineer), hoặc ghi rõ là chấp nhận việc dùng chung `CRON_SECRET_TOKEN` với cron-job.org.
3. Sau deploy: tạo job cron-job.org (§8a), `curl` thử một lần, sau 24 giờ chạy `npm run alerts:report` để đóng AC18, và theo dõi Vercel Usage/Upstash trong 48 giờ.
4. Tuỳ chọn: sửa các note về docs (#3, #4); merge nhánh `docs/mark-epic-001-deployed` trước (#8).

## 8. Policy amendments

| Proposed rule | Where it belongs | Why |
|---|---|---|
| "Mỗi endpoint do máy gọi dùng một secret riêng. Secret được giao cho bên thứ ba (scheduler ngoài) không được dùng lại cho endpoint khác, nhất là endpoint gửi tin hàng loạt." | `docs/RULES.md` "Code style" (đoạn secrets) hoặc mục mới "Machine-triggered endpoints" | Finding #1. Spec có ý này ("secret riêng"), nhưng RULES chưa ghi thành luật nên plan chọn dùng chung |
| "PR thêm một env var `required` vào `env.validation.ts` phải ghi trong `docs/DEPLOYMENT.md` rằng biến đó phải có trên Production **trước khi merge**, vì merge vào `master` sẽ tự deploy production." | `docs/RULES.md` (bổ sung cho đề xuất "Changing env.validation.ts" của EPIC-001 review §8) | Finding #2. Lần thứ hai một env `required` mới gây rủi ro (EPIC-001 là e2e vỡ, lần này là production không boot được) |

**Verdict: ship.** Không có blocker. Hai should-fix (#1, #2) cần owner làm hoặc chấp nhận rõ ràng trước khi merge.
