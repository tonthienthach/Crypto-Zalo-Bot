# Implementation Plan — Cảnh báo giá

**Epic ID:** `EPIC-002`
**Author:** Engineer
**Status:** Draft
**Created:** 2026-09-23
**Traces to:** `spec.md`

---

## 1. Approach

Lưu cảnh báo ở **Upstash Redis** (gói free, gắn qua Vercel Marketplace), không
dùng Postgres. Việc kiểm tra giá được kích hoạt mỗi phút bởi **cron-job.org**,
gọi `GET /cron/price-alerts` có secret. Cả hai lựa chọn đã được originator
duyệt ngày 2026-09-23. Endpoint này dựa theo `DigestController`: guard bằng
`CronSecretGuard`, luôn trả `200`, và lỗi của cảnh báo nào chỉ ảnh hưởng cảnh
báo đó. Lệnh `/canhbao` đi theo đúng quy trình thêm lệnh của `docs/RULES.md`:
parser, rồi formatter thuần, rồi thêm nhánh vào `switch` của
`WebhookController`. Quy tắc bắn / bật lại / cooldown (FR05–FR07) là một hàm
thuần `evaluateAlert()`, test được mà không cần mock.

**Phương án bị loại: lưu cảnh báo trong bảng Postgres cạnh `subscribers`.**
Nhất quán hơn về mặt kiến trúc, nhưng một truy vấn mỗi phút sẽ giữ compute
Neon luôn thức, vì Neon chỉ ngủ sau 5 phút không có truy vấn. Như vậy tốn
khoảng 720 giờ × 0,25 CU = 180 CU-giờ/tháng, trong khi gói Free chỉ có 100
CU-giờ ([Neon free plan](https://neon.com/faqs/free-plan-limits-and-quotas)).
Khi hết quota, compute bị tạm ngưng, kéo theo cả `/dangky` và bản tin 9h, tức
là phạm NFR04 và làm hỏng tính năng đang chạy. Với Redis, Neon vẫn chỉ thức khi
có lệnh `/dangky`/`/watchlist` hoặc bản tin 9h, giống như trước epic này.
**Cũng bị loại:** Vercel Cron, vì gói Hobby chỉ cho chạy mỗi ngày một lần
([Vercel docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)); GitHub
Actions `schedule`, vì cadence tối thiểu 5 phút và từng trễ 4 giờ (xem
`docs/ARCHITECTURE.md`); nâng lên Vercel Pro, vì phạm NFR04.

Chống chạy chồng (AC14) bằng một khoá cho mỗi lượt (`SET … NX EX`), nên hai
lượt không bao giờ đánh giá cùng lúc và không cần Lua. Chống "hồi sinh" cảnh
báo vừa bị người dùng xoá giữa một lượt bằng cách mỗi cảnh báo là một key riêng
và mọi cập nhật trạng thái dùng `SET … XX`, tức là chỉ ghi khi key còn tồn tại.
`ZaloService.sendTextMessage` đổi từ `Promise<void>` sang `Promise<boolean>`.
Hàm vẫn không bao giờ throw, nên mọi caller hiện tại không phải sửa gì, nhưng
bộ kiểm tra biết được việc gửi thành công hay không (spec §8 Concern 6).

## 2. Files

| Path | Change | Why |
|---|---|---|
| `package.json` / `package-lock.json` | Thêm dependency `@upstash/redis` | Client REST/HTTP, hợp với serverless: không có kết nối dài, cùng lý do đã chọn Neon HTTP driver |
| `src/config/env.validation.ts` | Thêm `KV_REST_API_URL` (uri, required) và `KV_REST_API_TOKEN` (required) | Đây là tên env mà Upstash Marketplace tự đưa vào Vercel; `docs/RULES.md` yêu cầu env phải khai báo ở đây |
| `src/config/configuration.ts` | Thêm nhóm `redis: { restUrl, restToken }` | Chỉ đọc env qua `ConfigService` |
| `src/zalo/zalo.service.ts` | `sendTextMessage` trả `Promise<boolean>`; trả `false` khi HTTP lỗi hoặc body có `ok: false`; vẫn không throw | Concern 6, FR05, FR12, AC13 |
| `src/zalo/zalo.service.spec.ts` | **Mới.** Test trả true/false, không throw | Hiện chưa có spec nào cho service này |
| `src/webhook/dto/zalo-webhook.dto.ts` | `@MaxLength(64)` cho `ZaloWebhookChatDto.id` | NFR06; đóng finding #3 của EPIC-001 |
| `src/command-parser/interfaces/parsed-command.interface.ts` | Thêm `ALERT_CREATE`, `ALERT_LIST`, `ALERT_DELETE`, `ALERT_INVALID` vào `CommandType`, và trường tuỳ chọn `alert?: AlertCommandArgs` (`direction`, `threshold`, `index`) | FR01, FR08, FR09 |
| `src/command-parser/command-parser.service.ts` (+ `.spec.ts`) | Parse `/canhbao` (và `/cảnhbáo`, `/alert`); chấp nhận `btc > 100000`, `btc>100000`, `btc > 100,000`; `xoa`/`xóa`/`delete <n>`; từ chối `100k`, số âm, mức > 10^12, quá 8 chữ số thập phân, symbol dài quá 20 ký tự | FR01, FR02, NFR06, AC08 |
| `src/price-alerts/price-alerts.constants.ts` | **Mới.** `MAX_ALERTS_PER_CHAT = 10`, `REARM_BUFFER_RATIO = 0.005`, `ALERT_COOLDOWN_MS = 15 * 60_000`, `MAX_ALERT_THRESHOLD = 1e12`, tên các key Redis, TTL khoá lượt, độ dài tối đa của log | Mỗi con số trong spec chỉ khai báo ở một chỗ |
| `src/price-alerts/interfaces/price-alert.interface.ts` | **Mới.** `PriceAlert` (`id`, `chatId`, `symbol`, `direction: 'above' \| 'below'`, `threshold`, `state: 'armed' \| 'fired'`, `lastFiredAt`, `createdAt`), `AlertDelivery`, `AlertRunSummary` | |
| `src/price-alerts/price-alert-evaluator.ts` (+ `.spec.ts`) | **Mới, hàm thuần.** `isConditionMet()` và `evaluateAlert(alert, priceUsd, now) → 'fire' \| 'rearm' \| 'none'` | FR05–FR07, FR10; AC02–AC07 |
| `src/price-alerts/price-alerts.service.ts` (+ `.spec.ts`) | **Mới.** CRUD trên Redis: `create` (kiểm tra giới hạn, giá hiện tại và điều kiện đã thoả chưa), `listByChat`, `deleteByIndex`, `listAll`, `updateState` (`SET XX`), `recordDelivery`/`recordRun` (`LPUSH` + `LTRIM`), `acquireRunLock`/`releaseRunLock`. Các lỗi `AlertLimitReachedError`, `AlertConditionAlreadyMetError`, `AlertNotFoundError` | FR01, FR03, FR04, FR08–FR10, FR12 |
| `src/price-alerts/price-alerts.controller.ts` (+ `.spec.ts`) | **Mới.** `@Controller('cron')` `@All('price-alerts')` `@UseGuards(CronSecretGuard)`; một lượt: khoá → tải cảnh báo → **một** lần `getPricesBySymbols` cho các coin khác nhau → đánh giá → gửi/cập nhật → ghi summary → mở khoá; luôn trả `200` | FR05, NFR01–NFR03, NFR05, NFR07, NFR08 |
| `src/price-alerts/price-alerts.module.ts` | **Mới.** Imports `ConfigModule`, `CoingeckoModule`, `ZaloModule`; exports `PriceAlertsService` | Hình dạng module theo `docs/RULES.md` |
| `src/utils/format-message.util.ts` (+ `.spec.ts`) | Thêm `formatAlertCreatedReply`, `formatAlertListReply`, `formatAlertDeletedReply`, `formatAlertNotFoundReply`, `formatAlertLimitReply`, `formatAlertAlreadyMetReply`, `formatAlertInvalidReply`, `formatAlertTriggeredMessage`; cập nhật `formatHelpReply` | FR11, FR13; formatter thuần theo `docs/RULES.md` |
| `src/webhook/webhook.controller.ts` | Thêm 4 nhánh `case ALERT_*`; map 3 lỗi mới trong `handleReplyError` | FR01, FR08, FR09 |
| `src/webhook/webhook.module.ts` | Import `PriceAlertsModule` | Import hẹp nhất có thể theo `docs/RULES.md` |
| `src/app.module.ts` | Import `PriceAlertsModule` để đăng ký controller cron | |
| `test/webhook.e2e-spec.ts` | Thêm env `KV_REST_API_*` giả; override `PriceAlertsService`; thêm các case `/canhbao` và case `/cron/price-alerts` trả 401 | Bài học EPIC-001: e2e từng vỡ vì thiếu env; `docs/RULES.md` yêu cầu e2e khi thêm dependency ngoài mới |
| `test/price-alerts.redis.e2e-spec.ts` | **Mới, opt-in.** Chạy `PriceAlertsService` thật với `@upstash/redis` thật, trỏ vào Redis scratch; tự `describe.skip` nếu không có `REDIS_INT_URL` | Bài học EPIC-001: phải kiểm tra bằng driver thật, không chỉ bằng mock |
| `docs/API.md` | Thêm các lệnh `/canhbao` vào bảng lệnh và mô tả endpoint `/cron/price-alerts` | FR13, `docs/RULES.md` |
| `docs/ARCHITECTURE.md` | Thêm mục "Price alerts": vì sao dùng Redis thay Postgres (quota Neon), bộ lập lịch ngoài, khoá lượt, `SET XX`; cập nhật bảng module | |
| `docs/DEPLOYMENT.md` | Gắn Upstash qua Vercel Marketplace; tạo job cron-job.org (mỗi phút, `GET`, header `X-Cron-Secret-Token`); các lệnh kiểm tra sau deploy | |
| `docs/ROADMAP.md`, `CHANGELOG.md` | Cập nhật trạng thái / thêm mục khi ship | |

## 3. Order

1. **Nền tảng: config + Zalo trả kết quả + giới hạn `chat.id`.** Thêm env và
   config Redis, sửa `ZaloService` trả `boolean` kèm spec mới, thêm
   `@MaxLength(64)`, cập nhật env giả trong e2e. *Sau bước này:* ứng dụng
   khởi động với cấu hình Redis, bộ test cũ vẫn xanh vì caller bỏ qua giá trị
   trả về, và `chat.id` dài hơn 64 ký tự bị chặn.
2. **Evaluator thuần.** `price-alert-evaluator.ts` cùng constants, interfaces
   và spec. *Sau bước này:* luật bắn / bật lại / cooldown được chứng minh bằng
   unit test (AC02–AC07), chưa có I/O nào.
3. **Parser.** Thêm `CommandType` mới và parse `/canhbao` kèm spec. *Sau bước
   này:* mọi cú pháp hợp lệ và không hợp lệ của AC08 được parse đúng; bot chưa
   trả lời gì mới.
4. **Store.** `PriceAlertsService` trên Redis, kèm spec mock `@upstash/redis`
   và integration spec opt-in chạy với Redis scratch. *Sau bước này:*
   tạo/list/xoá/giới hạn/`SET XX`/khoá lượt chạy thật trên driver thật.
5. **Formatter + webhook.** Thêm các formatter, 4 nhánh `case` và map lỗi, rồi
   e2e cho `/canhbao`. *Sau bước này:* người dùng đặt, xem và xoá được cảnh
   báo, nhưng chưa có gì kiểm tra giá.
6. **Endpoint kiểm tra.** `PriceAlertsController` kèm spec và e2e 401. *Sau
   bước này:* một lần gọi `/cron/price-alerts` đánh giá và gửi cảnh báo đầu
   cuối (AC02, AC12–AC17).
7. **Docs.** `API.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`. Chạy đủ
   `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`. Mở PR vào
   `master`.
8. **Deploy (owner làm, có mình hướng dẫn).** Gắn Upstash → deploy → tạo job
   cron-job.org → theo dõi 24–48 giờ: khoảng cách giữa các lượt (AC18), usage
   Vercel (CPU, memory) và số lệnh Upstash. Chỉ sau đó mới cập nhật
   `ROADMAP.md`/`CHANGELOG.md` là Shipped.

Mỗi bước là một commit Conventional Commits trên
`feature/epic-002-price-alerts`.

## 4. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| **Vượt 4 giờ Active CPU/tháng của Vercel Hobby.** Có khoảng 43.200 lượt/tháng, nên ngân sách chỉ khoảng 330 ms CPU mỗi lượt, và còn phải chia với webhook. Nest cold start tốn CPU. ([Vercel pricing](https://vercel.com/docs/functions/usage-and-pricing)) | Trung bình, **ít chắc chắn nhất** | Chạy mỗi phút giúp instance thường ấm, và thời gian chờ I/O không tính vào CPU. Khi không có cảnh báo nào, lượt chạy thoát sớm sau 1–2 lệnh Redis. Bước 8 đo usage thật sau 48 giờ rồi nhân ra cả tháng. Nếu vượt, quay lại originator với hai lựa chọn: giãn chu kỳ lúc không có cảnh báo, hoặc chấp nhận trả phí. |
| **Vượt "Provisioned Memory" 360 GB-giờ của Vercel Hobby** nếu instance được giữ sống liên tục | Thấp–trung bình | Theo dõi cùng lúc với rủi ro CPU ở bước 8. |
| **Quota Upstash** (500k lệnh/tháng, 10 GB băng thông) | Thấp | Khoảng 6 lệnh mỗi lượt × 43.200 ≈ 260k lệnh/tháng. Băng thông tăng theo số cảnh báo (`MGET` mỗi lượt): khoảng 50 cảnh báo thì chưa tới 0,5 GB/tháng, nhưng khoảng 1.000 cảnh báo sẽ chạm trần 10 GB. Ghi vào `ARCHITECTURE.md` là ngưỡng cần xem lại. |
| **Đổi kiểu trả về của `ZaloService.sendTextMessage`**. Blast radius: `webhook.controller.ts` (12 chỗ gọi), `digest.controller.ts:76`, mock trong `digest.controller.spec.ts` và `test/webhook.e2e-spec.ts` | Thấp | Hàm vẫn không throw, caller hiện tại chỉ `await` và bỏ qua kết quả, mock `mockResolvedValue(undefined)` vẫn hợp lệ. TypeScript sẽ báo nếu có chỗ nào dùng kết quả sai. |
| **`@MaxLength(64)` từ chối một `chat.id` thật dài hơn 64** | Rất thấp | Id thật đang thấy dài 20 ký tự hex (`docs/API.md`). `AllExceptionsFilter` vẫn trả `200` cho `/webhook*` nên Zalo không retry. |
| **Parse sai `/gia` hay các lệnh hiện có** khi thêm alias mới | Thấp | Bộ spec parser hiện có chạy lại ở mọi bước; alias mới không trùng alias cũ. |
| **Nguồn giá trả giá cũ** (cache in-memory TTL 30 giây trong `CoingeckoService`) | Chắc chắn, nhưng vô hại | Chậm tối đa 30 giây, vẫn trong ngân sách 2 phút của NFR01. Không đổi cache. |
| **Khoá lượt hết hạn khi lượt vẫn đang chạy** | Rất thấp | TTL khoá là 120 giây, gấp 8 lần NFR02 (15 giây). |
| **Khó đảo ngược** | Thấp | Không có migration Postgres. Gỡ tính năng chỉ cần tắt job cron-job.org rồi revert. Dữ liệu Redis là dữ liệu riêng của tính năng, xoá được mà không ảnh hưởng subscriber. |
| **Hai lệnh tạo đồng thời của cùng một chat vượt giới hạn 10** (đếm rồi mới ghi, không atomic) | Rất thấp | Chấp nhận: `UserThrottlerGuard` giới hạn tần suất lệnh, và vượt 1–2 cảnh báo không gây hại. Ghi rõ trong code. |

## 5. Proofs

| Criterion | Proof | How it is run |
|---|---|---|
| `EPIC-002-AC01` | e2e: `/canhbao btc > 100000` với giá mock 95.000 thì gọi `create` và trả lời có số thứ tự; unit `price-alerts.service.spec.ts` kiểm tra `create` ghi key, set của chat và set chung | `npm run test:e2e`, `npm test` |
| `EPIC-002-AC02` | Unit controller: một cảnh báo armed, giá 100.200 → `sendTextMessage` được gọi 1 lần với nội dung chứa `BTC`, `100,000` và giá hiện tại; `updateState` chuyển sang `fired` | `npm test` |
| `EPIC-002-AC03` | Unit evaluator: trạng thái fired, giá 100.500 và 101.000 → `'none'` | `npm test` |
| `EPIC-002-AC04` | Unit evaluator, chạy tuần tự: 99.800 → `none`; 99.400 → `rearm`; 100.100 lúc T+16 phút → `fire` | `npm test` |
| `EPIC-002-AC05` | Unit evaluator: bắn lúc T; rearm; vượt lại lúc T+5 phút → `none`; lúc T+15 phút → `fire` | `npm test` |
| `EPIC-002-AC06` | Unit evaluator: `below 2000` với giá 1.990 → `fire`; bật lại khi ≥ 2.010 | `npm test` |
| `EPIC-002-AC07` | Unit service: `create` với giá hiện tại 110.000 → `AlertConditionAlreadyMetError`, không ghi gì; e2e kiểm tra nội dung trả lời | `npm test`, `npm run test:e2e` |
| `EPIC-002-AC08` | Unit parser: mỗi input không hợp lệ → `ALERT_INVALID`; `100,000` → 100000; e2e với một input không hợp lệ kiểm tra có câu trả lời chứa ví dụ | `npm test`, `npm run test:e2e` |
| `EPIC-002-AC09` | e2e: mock `getPricesBySymbols` throw `UnknownCoinSymbolsError` → bot trả lời giống `/gia` | `npm run test:e2e` |
| `EPIC-002-AC10` | Unit service: chat đã có 10 cảnh báo → `AlertLimitReachedError`; integration với Redis thật: tạo 11 cái, cái thứ 11 bị từ chối | `npm test`, integration (xem §6) |
| `EPIC-002-AC11` | Integration với Redis thật: 2 chat, list/xoá theo số thứ tự, xoá 99 → `AlertNotFoundError`, chat B không bị ảnh hưởng | integration |
| `EPIC-002-AC12` | Unit controller: `getPricesBySymbols` throw `CoingeckoUnavailableError` → không gửi, không `updateState`, trả `{ ok: true }` | `npm test` |
| `EPIC-002-AC13` | Unit controller: `sendTextMessage` trả `false` cho chat 1 và `true` cho chat 2 → chat 2 được gửi; cảnh báo của chat 1 không bị `updateState`; `recordDelivery` ghi `delivered: false` | `npm test` |
| `EPIC-002-AC14` | Unit controller: `acquireRunLock` trả false → không đánh giá gì. Integration: gọi `acquireRunLock` 2 lần liền → lần 2 trả false. Integration: xoá cảnh báo rồi `updateState` → key không bị tạo lại (`SET XX`) | `npm test`, integration |
| `EPIC-002-AC15` | Unit controller: 50 cảnh báo trên 5 coin → `getPricesBySymbols` được gọi đúng 1 lần với 5 symbol. Mỗi lần gọi này tốn tối đa 1 request CoinGecko + 1 CoinPaprika, theo `coingecko.service.ts:67` | `npm test` |
| `EPIC-002-AC16` | e2e: `GET /cron/price-alerts` không có header, hoặc có secret sai → `401`, `listAll` không được gọi | `npm run test:e2e` |
| `EPIC-002-AC17` | Unit controller: `recordDelivery` và `recordRun` được gọi với đủ trường (evaluated, fired, failed, durationMs, driftMs); integration: đọc lại được từ list Redis | `npm test`, integration |
| `EPIC-002-AC18` | Quan sát production: sau 24 giờ, đọc 1.440 summary gần nhất trong list `price-alerts:runs` rồi tính p95 khoảng cách giữa các lượt, yêu cầu ≤ 90 giây. Lệnh đọc được ghi trong `DEPLOYMENT.md`; lịch sử của cron-job.org dùng để đối chiếu | Owner chạy ở bước 8, không tự động hoá được |
| `EPIC-002-AC19` | Kiểm tra bằng cấu trúc code: đường `/huy` (`SubscribersService.unsubscribe`) không chạm Redis; e2e: `/huy` không gọi hàm nào của `PriceAlertsService` | `npm run test:e2e` |

## 6. Feedback loop

- **Logic thuần** (evaluator, parser, formatter): `npm test -- --watch`.
- **Controller và service**: unit test với `@upstash/redis`, `CoingeckoService`
  và `ZaloService` được mock, theo pattern của `digest.controller.spec.ts`.
- **Driver thật (bài học EPIC-001):** Redis scratch cục bộ bằng Docker, gồm
  `redis:7-alpine` và `hiett/serverless-redis-http` (giả lập REST API của
  Upstash):

  ```
  docker run -d --name ea-redis -p 6379:6379 redis:7-alpine
  docker run -d --name ea-srh -p 8079:80 -e SRH_MODE=env -e SRH_TOKEN=local \
    -e SRH_CONNECTION_STRING=redis://host.docker.internal:6379 hiett/serverless-redis-http
  REDIS_INT_URL=http://localhost:8079 REDIS_INT_TOKEN=local npm run test:e2e -- price-alerts.redis
  ```

  Nhờ vậy `PriceAlertsService` thật chạy với `@upstash/redis` thật (`MULTI`,
  `SET NX/XX`, `MGET`, `LTRIM`). Chạy xong thì xoá container.
- **Đầu cuối cục bộ:** `npm run start:dev` với `.env` trỏ vào Redis scratch, rồi
  gọi bằng `curl`: `POST /webhook` với `/canhbao …`, và
  `GET /cron/price-alerts -H "X-Cron-Secret-Token: …"`. Tin nhắn Zalo thật chỉ
  kiểm tra sau deploy.
- **Trước khi coi là xong (bài học EPIC-001):** chạy đủ `npm run lint`,
  `npm test`, `npm run test:e2e`, `npm run build`, không chỉ unit.

## 7. Deliberately not doing

- **Không đụng tới Postgres, `SubscribersService` hay bảng `subscribers`**: cảnh
  báo độc lập với digest (AC19), và giữ Neon được ngủ.
- **Không đổi `vercel.json`**: Vercel Cron vẫn chỉ chạy bản tin 9h. Endpoint mới
  do cron-job.org gọi, và `vercel.json` đã route mọi path vào `api/index.ts`.
- **Không đổi cache hay TTL của `CoingeckoService`**, cũng không tách quota
  riêng cho bộ kiểm tra: 1 lần gọi mỗi phút là đủ nhỏ so với giới hạn free
  (NFR03).
- **Không dùng Lua hay transaction phức tạp**: khoá lượt cộng `SET XX` đã đủ cho
  AC14.
- **Không dọn dữ liệu cũ bằng job riêng**: log lần gửi và log lượt chạy tự giới
  hạn bằng `LTRIM`, lần lượt 1.000 và 1.440 mục.
- **Không tự xoá cảnh báo của chat chặn bot** (spec §7).
- **Không dời logic lượt chạy ra một service riêng**: giữ trong controller,
  giống `DigestController`, để cùng một pattern với code hiện có.
