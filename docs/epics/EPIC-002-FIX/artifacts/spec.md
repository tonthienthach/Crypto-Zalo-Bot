# Spec — Biết khi việc canh giá ngừng chạy

**Epic ID:** `EPIC-002-FIX`
**Owner:** Product Owner
**Status:** Approved (Thach, 2026-09-25)
**Created:** 2026-09-25
**Traces to:** `intent.md`

---

## 1. Overview

Khi việc canh giá (lượt kiểm tra cảnh báo giá mỗi phút của EPIC-002) không có lượt nào chạy khoẻ trong **15 phút**, owner nhận một tin Zalo. Owner không phải tự đi đo. Khi việc canh giá chạy lại, owner nhận tin báo đã hồi phục. Mọi lần kích hoạt đều được ghi lại, kể cả lần bị từ chối, bị bỏ qua, bị lỗi hay chạy mà không lấy được giá. Nhờ vậy, khi xem lại một khoảng thời gian bất kỳ, owner biết lượt nào bị thiếu và vì sao. Hướng dẫn đo sức khoẻ sau deploy được sửa để owner làm theo được từ đầu đến cuối. Epic này phục vụ ba gạch đầu dòng ở `intent.md` §5, với hai câu trả lời owner đã chốt ngày 2026-09-24: ngưỡng 15 phút (Q1) và kênh báo là tin Zalo tới owner (Q2).

Điểm mấu chốt của thiết kế hành vi: việc canh giá được kích hoạt từ **bên ngoài** (cron-job.org). Khi không ai gọi thì không có code nào của bot chạy. Vì vậy, sự *vắng mặt* của lượt chạy không thể do chính lượt chạy đó tự phát hiện. Phải có một **bên quan sát độc lập** với nguồn kích hoạt chính (§8 Concern 1).

## 2. Constraints applied

| Source | What it constrains |
|---|---|
| `CLAUDE.md` | Repo không có `CLAUDE.md`; dùng `docs/RULES.md` thay thế (giống EPIC-001, EPIC-002). |
| `docs/RULES.md` | Env var chỉ đọc qua `ConfigService`/`env.validation.ts`; tính năng mới phải có test (unit + e2e khi chạm dependency mới); Conventional Commits; nhánh `feature/*` merge qua PR. |
| `docs/ARCHITECTURE.md` §"Price alerts" | Lượt kiểm tra được kích hoạt mỗi phút bởi cron-job.org, có run lock và log tóm tắt từng lượt (tối đa 1.440 lượt). Ngân sách Upstash free 500k lệnh/tháng, hiện đã dùng ước tính ~6 lệnh/lượt × 43.200 lượt ≈ 260k. Vercel Hobby 4h Active CPU/tháng. GitHub Actions `schedule` đã bị loại cho digest và cảnh báo (tối thiểu 5 phút, có lúc chạy trễ hàng giờ). |
| `docs/ARCHITECTURE.md` §"Error handling philosophy" | Endpoint do máy gọi luôn trả `200` với lỗi nghiệp vụ và không lộ stack trace. `ZaloService.sendTextMessage` không throw mà trả kết quả gửi. |
| `docs/ARCHITECTURE.md` §"Persistence" + EPIC-002 plan | Không được đánh thức Neon (Postgres) theo chu kỳ phút hay vài phút. Postgres chỉ thức cho lệnh subscriber và bản tin 9h. |
| `docs/DEPLOYMENT.md` §8a | Hướng dẫn bật job cron-job.org và đo AC18. Bước 4 sai: `vercel env pull` không lấy được biến Sensitive (`KV_REST_API_URL`/`KV_REST_API_TOKEN`), CLI ghi `[SENSITIVE]` vào file (incident.md §5). |
| `docs/epics/EPIC-002/artifacts/incident.md` | Khoảng trống đã confirmed: `recordRun` chỉ chạy cho lượt qua guard, lấy được lock và không throw (`price-alerts.controller.ts:40-50`). Nguyên nhân gốc lần này: job cron-job.org sai URL. Mọi mục ở §5 "What would have caught this". |
| Code hiện có (`src/price-alerts/price-alerts.controller.ts`) | Khi nguồn giá lỗi, `loadPrices` trả về map rỗng, và lượt đó vẫn được ghi như một lượt *hoàn tất* (`evaluated: 0`). Tức là "có lượt hoàn tất" chưa có nghĩa là "đang canh được". Spec này định nghĩa lại "lượt khoẻ" (FR01). |
| `src/config/env.validation.ts` | Chưa có cấu hình nào cho chat của owner. `DIGEST_CHAT_ID` chỉ còn dùng cho script seed một lần, được ghi là không đọc lúc runtime (ROADMAP Initiative 1). |
| `docs/epics/EPIC-002/artifacts/review.md` should-fix #1 | Secret lưu ở bên thứ ba phải riêng cho đúng một endpoint, để nếu lộ thì không mở được chức năng khác. |
| `docs/epics/EPIC-002/epic-memory.json` | Bài học: mỗi trigger bên ngoài phải có bước xác nhận chạy được trong vài phút sau khi bật, và log chạy phải ghi cả thất bại chứ không chỉ thành công. |
| `.aidlc/workspace.yaml` (`risk-security-reviewer`) | Có đường ghi mới do request chưa xác thực gây ra (ghi lại lượt bị từ chối) và có thể thêm một endpoint mới do máy gọi, nên áp dụng kiểm tra trust boundary và chống lạm dụng quota. |

## 3. User scenarios

### 3.1 Primary flow

- **Given** việc canh giá đang chạy khoẻ khoảng mỗi phút, **when** không có lượt khoẻ nào trong 15 phút liên tục (job bị tắt, sai URL, sai secret, lượt nào cũng lỗi, hay nguồn giá hỏng liên tục), **then** chậm nhất 20 phút sau lượt khoẻ cuối cùng, owner nhận **một** tin Zalo gồm: đã ngừng từ lúc nào (giờ Việt Nam), đã ngừng bao lâu, dấu hiệu quan sát được gần nhất (không có lượt gọi nào / bị từ chối N lần / lỗi khi chạy / không lấy được giá), số cảnh báo đang không được canh, và gợi ý chỗ cần kiểm tra.
- **Given** owner đã được báo là việc canh giá ngừng, **when** vẫn chưa hồi phục, **then** owner không nhận thêm tin nào cho tới khi đủ 6 giờ kể từ tin trước. Sau đó mỗi 6 giờ nhận một tin nhắc (FR05).
- **Given** việc canh giá đang ngừng và owner đã được báo, **when** có lại một lượt khoẻ, **then** owner nhận **một** tin "đã hồi phục" kèm tổng thời gian ngừng, chậm nhất 5 phút sau lượt khoẻ đó.
- **Given** owner muốn biết chuyện gì đã xảy ra trong một khoảng thời gian, **when** chạy report chỉ đọc, **then** report liệt kê từng đợt ngừng (bắt đầu, kết thúc, thời lượng) cùng những gì quan sát được trong đợt đó: không có lượt gọi nào, bị từ chối, bị bỏ qua, lỗi, hay chạy mà không lấy được giá.
- **Given** owner vừa bật hoặc sửa job kích hoạt, **when** làm theo `docs/DEPLOYMENT.md`, **then** trong vòng 5 phút owner xác nhận được bằng report rằng các lượt khoẻ đang đến. Owner không phải chờ 24 giờ, và không phải tự tìm cách lấy thông tin đăng nhập.

### 3.2 Edge and error paths

- **Chưa từng có lượt khoẻ nào** (deploy lần đầu mà job sai URL, đúng như sự cố của EPIC-002): mốc để tính 15 phút là lúc bên quan sát bắt đầu hoạt động, nên owner vẫn được báo. Không có chuyện "chưa từng chạy thì không báo".
- **Lượt chạy nhưng nguồn giá hỏng** (có cảnh báo đang canh mà không lấy được giá nào): không tính là lượt khoẻ. Nếu kéo dài 15 phút, owner được báo với dấu hiệu "không lấy được giá".
- **Không có cảnh báo nào đang canh**: lượt chạy không cần lấy giá vẫn là lượt khoẻ. Việc giám sát vẫn chạy như bình thường, vì cảnh báo mới có thể được đặt bất cứ lúc nào.
- **Lượt bị bỏ qua vì lượt trước còn giữ lock**: được ghi lại, nhưng không tính là lượt khoẻ. Một lần bỏ qua lẻ tẻ không gây báo động, vì ngưỡng 15 phút lớn hơn nhiều so với thời hạn lock (120 giây).
- **Request bị từ chối vì sai hoặc thiếu secret**: được ghi lại dưới dạng đếm có giới hạn (NFR03), không lưu secret hay header đã gửi. Người lạ gọi endpoint liên tục không làm cạn quota lưu trữ và không gây báo động giả. Việc canh giá vẫn khoẻ nếu job thật vẫn chạy đúng.
- **Gửi tin cho owner thất bại** (Zalo lỗi, owner chặn bot): tin đó không được coi là đã gửi. Bên quan sát thử lại ở lượt sau, tối đa 1 lần mỗi 5 phút. Việc gửi tin cảnh báo giá cho người dùng không bị ảnh hưởng.
- **Chưa cấu hình chat của owner**: bot vẫn khởi động bình thường, việc giám sát và ghi nhận vẫn chạy, chỉ không gửi được tin. Report hiện rõ là "chưa cấu hình chat owner".
- **Kho lưu trạng thái (Redis) không đọc được**: bên quan sát không biết lượt khoẻ cuối là khi nào. Owner được báo với dấu hiệu "không đọc được trạng thái", nhưng tối đa 1 tin mỗi giờ, kể cả khi không lưu được là đã báo (NFR05).
- **Chính bên quan sát ngừng chạy**: việc canh giá (vẫn chạy mỗi phút) nhận ra bên quan sát đã im lặng quá 30 phút, và báo owner một lần; khi bên quan sát chạy lại thì báo hồi phục một lần (FR07). Nếu *cả hai* cùng ngừng thì không ai báo được. Rủi ro này được chấp nhận và ghi ở §8 Concern 1.
- **Owner cố ý tắt việc canh giá** (theo `DEPLOYMENT.md`: "To stop alerts quickly, disable the cron-job.org job"): owner vẫn nhận tin báo ngừng, sau đó là tin nhắc mỗi 6 giờ. Muốn im lặng hẳn thì tắt luôn bên quan sát. Hướng dẫn này được ghi vào `DEPLOYMENT.md` (FR10).
- **Dao động quanh ngưỡng** (lúc có lượt khoẻ, lúc không, sát mốc 15 phút): một đợt ngừng chỉ kết thúc khi có lượt khoẻ. Chỉ khi đợt ngừng thực sự đã được báo thì mới có tin hồi phục, nên không có cặp tin ngừng/hồi phục liên tục.

## 4. Functional requirements

| Id | Requirement | Priority | Traces to |
|---|---|---|---|
| `EPIC-002-FIX-FR01` | **Lượt khoẻ** là lượt thoả cả bốn điều kiện: qua được xác thực, lấy được lock, chạy hết mà không có lỗi chưa xử lý, và (khi có ≥ 1 cảnh báo đang canh) lấy được giá cho ít nhất một coin cần canh. Thời điểm của lượt khoẻ gần nhất luôn đọc được. | Must | intent §1, §5 gạch 1 |
| `EPIC-002-FIX-FR02` | Mỗi lần endpoint kiểm tra được gọi, kết quả được ghi thành đúng một trong các loại: `healthy`, `no-price` (chạy hết nhưng nguồn giá hỏng), `failed` (lỗi chưa xử lý), `skipped` (lock đang bị giữ), `rejected` (sai hoặc thiếu secret). "Không được gọi" là loại thứ sáu, suy ra từ việc không có ghi nhận nào trong khoảng đó. | Must | intent §5 gạch 2 |
| `EPIC-002-FIX-FR03` | Một **bên quan sát** chạy ít nhất mỗi 5 phút, **độc lập với nguồn kích hoạt việc canh giá**. Mỗi lần chạy, nó so thời điểm lượt khoẻ gần nhất với ngưỡng 15 phút. Mốc tính là thời điểm muộn hơn giữa lượt khoẻ gần nhất và lúc bên quan sát bắt đầu hoạt động. | Must | intent §5 gạch 1, Q1 |
| `EPIC-002-FIX-FR04` | Khi vượt ngưỡng, owner nhận **một** tin Zalo "ngừng canh giá" gồm: thời điểm lượt khoẻ cuối (giờ Việt Nam, hoặc "chưa từng" nếu chưa có), thời gian đã ngừng, dấu hiệu gần nhất theo các loại ở FR02 kèm số lần, số cảnh báo đang canh, và một dòng gợi ý chỗ kiểm tra (lịch gọi bên ngoài, log Vercel). | Must | intent §5 gạch 1, Q2 |
| `EPIC-002-FIX-FR05` | Trong một đợt ngừng, owner nhận tối đa **1 tin mỗi 6 giờ**: tin đầu tiên, rồi tin nhắc mỗi 6 giờ nếu vẫn chưa hồi phục, mỗi tin nêu tổng thời gian đã ngừng. | Must | intent §5 (không spam) |
| `EPIC-002-FIX-FR06` | Khi một đợt ngừng *đã được báo* kết thúc (có lại lượt khoẻ), owner nhận **một** tin "đã hồi phục" kèm thời điểm bắt đầu, thời điểm kết thúc và tổng thời gian ngừng. Đợt ngừng chưa từng được báo thì không gửi tin hồi phục. | Must | intent §5 gạch 1 |
| `EPIC-002-FIX-FR07` | Việc canh giá ghi nhận nhịp của bên quan sát. Khi bên quan sát im lặng quá **30 phút**, owner nhận một tin "bên giám sát ngừng chạy", và một tin hồi phục khi nó chạy lại. Hai tin này tuân theo cùng quy tắc chống spam ở FR05 và FR06. | Should | intent §5 gạch 1 (báo động không được tự hỏng mà không ai biết) |
| `EPIC-002-FIX-FR08` | Chat nhận tin của owner là một giá trị cấu hình riêng, tách khỏi `DIGEST_CHAT_ID` cũ. Chưa cấu hình thì không gửi tin, còn giám sát và ghi nhận vẫn chạy; bot không lỗi lúc khởi động. | Must | intent Q2 |
| `EPIC-002-FIX-FR09` | `npm run alerts:report` hiển thị thêm: (a) số lần theo từng loại ở FR02 trong khoảng log; (b) danh sách các đợt không có lượt khoẻ dài ≥ 15 phút, mỗi đợt có bắt đầu, kết thúc, thời lượng và các loại quan sát được trong đợt (không có gì thì ghi "không được gọi"); (c) thời điểm lượt khoẻ gần nhất và lần chạy gần nhất của bên quan sát; (d) chat owner đã cấu hình chưa và tin giám sát gần nhất đã gửi; (e) các số liệu AC18/NFR02 đã có, nhưng chỉ tính trên lượt `healthy`. Report vẫn chỉ đọc. | Must | intent §5 gạch 2 |
| `EPIC-002-FIX-FR10` | `docs/DEPLOYMENT.md` §8a được sửa: (a) bước lấy `KV_REST_API_URL` + token để chạy report hướng dẫn copy từ Upstash Console (token read-only là đủ) thay vì `vercel env pull`; (b) thêm bước xác nhận ngay sau khi bật hoặc sửa job: trong 5 phút, report phải thấy ≥ 3 lượt `healthy` mới; (c) hướng dẫn thiết lập bên quan sát, cấu hình chat owner, và cách thử báo động; (d) ghi rõ muốn tắt hẳn thì tắt cả job kích hoạt lẫn bên quan sát. | Must | intent §5 gạch 3, Q6 |
| `EPIC-002-FIX-FR11` | `docs/ARCHITECTURE.md` §"Price alerts" mô tả bên quan sát, các loại ghi nhận và ngân sách tài nguyên mới. | Should | `docs/RULES.md` |

## 5. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| `EPIC-002-FIX-NFR01` | Thời gian phát hiện | Tin "ngừng canh giá" tới owner **≤ 20 phút** sau lượt khoẻ cuối (ngưỡng 15 phút + chu kỳ bên quan sát ≤ 5 phút), với điều kiện Zalo nhận tin. Tin "đã hồi phục" tới ≤ 5 phút sau lượt khoẻ đầu tiên. |
| `EPIC-002-FIX-NFR02` | Không báo động giả | Trong 24 giờ vận hành bình thường (lượt khoẻ cách nhau ≤ 90 giây ở p95, tức AC18 của EPIC-002 đạt), owner nhận **0** tin giám sát. |
| `EPIC-002-FIX-NFR03` | Chống lạm dụng khi ghi nhận lượt bị từ chối | Dù request không xác thực tới với tần suất bao nhiêu, việc ghi nhận chúng tốn **≤ 1 lệnh ghi lưu trữ mỗi phút** (≤ 43.200 lệnh/tháng). Không lưu secret, header hay body của request bị từ chối. |
| `EPIC-002-FIX-NFR04` | Ngân sách lưu trữ | Tổng lệnh Upstash/tháng (việc canh giá + ghi nhận mới + bên quan sát + lượt bị từ chối) **≤ 400k**, chừa ≥ 20% so với mức free 500k. `plan.md` phải lấy số thực tế trên Upstash dashboard làm gốc, không dùng số ước tính. |
| `EPIC-002-FIX-NFR05` | Chống spam khi mất trạng thái | Kể cả khi kho trạng thái không đọc hay ghi được, owner nhận **≤ 1 tin giám sát mỗi giờ**. |
| `EPIC-002-FIX-NFR06` | Ngân sách CPU | Phần Active CPU tăng thêm (bên quan sát + ghi nhận thêm) **≤ 24 phút/tháng** (≤ 10% của 4h Hobby). Không đánh thức Postgres. |
| `EPIC-002-FIX-NFR07` | Chi phí | Không thêm gói hay dịch vụ trả phí. Mọi thành phần mới chạy được trên gói miễn phí. |
| `EPIC-002-FIX-NFR08` | Bảo mật | Nếu bên quan sát được kích hoạt qua một endpoint do máy gọi, endpoint đó dùng **secret riêng**, khác cả `CRON_SECRET_TOKEN` lẫn `PRICE_ALERTS_CRON_SECRET`. Gọi sai hoặc thiếu secret thì trả `401` và không gửi tin nào. Lỗi nghiệp vụ trả `200`, không lộ stack trace. |
| `EPIC-002-FIX-NFR09` | Không ảnh hưởng hành vi hiện có | Mọi hành vi và AC của EPIC-002 (fire, re-arm, cooldown, retry, thời gian mỗi lượt ≤ 15 giây) giữ nguyên. Việc ghi nhận thêm không làm một lượt kiểm tra lỗi: nếu ghi nhận hỏng thì chỉ mất bản ghi đó, cảnh báo vẫn được xử lý. |
| `EPIC-002-FIX-NFR10` | Lưu giữ | Report dựng lại được ít nhất **24 giờ** gần nhất ở cả sáu loại ở FR02, và lịch sử tin giám sát đã gửi trong ít nhất 30 ngày. |
| `EPIC-002-FIX-NFR11` | Quyền của report | Report chạy được chỉ với token read-only của Upstash. |

## 6. Acceptance criteria

| Id | Given / When / Then |
|---|---|
| `EPIC-002-FIX-AC01` | **Given** có 2 cảnh báo đang canh và nguồn giá trả giá bình thường, **when** một lượt kiểm tra hợp lệ chạy xong, **then** lượt đó được ghi là `healthy` và thời điểm lượt khoẻ gần nhất được cập nhật. (FR01, FR02) |
| `EPIC-002-FIX-AC02` | **Given** có cảnh báo đang canh và nguồn giá lỗi, **when** một lượt chạy, **then** lượt đó được ghi là `no-price` và thời điểm lượt khoẻ gần nhất **không** đổi. **Given** không có cảnh báo nào, **when** một lượt chạy (không gọi nguồn giá), **then** lượt đó là `healthy`. (FR01, FR02) |
| `EPIC-002-FIX-AC03` | **When** endpoint kiểm tra được gọi với secret sai, không có secret, trong lúc lock đang bị giữ, hoặc với một lỗi chưa xử lý được giả lập, **then** mỗi lần được ghi đúng loại `rejected` / `rejected` / `skipped` / `failed`, response giữ nguyên như EPIC-002 (`401` / `401` / `200` / `200`), và dữ liệu ghi lại không chứa secret đã gửi. (FR02, NFR08) |
| `EPIC-002-FIX-AC04` | **Given** 10.000 request sai secret trong 1 phút, **then** số lệnh ghi lưu trữ do chúng gây ra ≤ 1, owner không nhận tin nào, và report vẫn hiện số lần bị từ chối (cho phép là số xấp xỉ, miễn không nhỏ hơn 1). (NFR03) |
| `EPIC-002-FIX-AC05` | **Given** lượt khoẻ cuối lúc T và sau đó không có lượt khoẻ nào, **when** bên quan sát chạy lúc T+14 phút, **then** không gửi tin; **when** nó chạy ở một lần bất kỳ trong khoảng [T+15, T+20] phút, **then** owner nhận đúng 1 tin "ngừng canh giá" có đủ các trường ở FR04. (FR03, FR04, NFR01) |
| `EPIC-002-FIX-AC06` | **Given** bên quan sát bắt đầu hoạt động lúc S và chưa từng có lượt khoẻ nào, **when** tới S+20 phút, **then** owner đã nhận 1 tin "ngừng canh giá" với lượt khoẻ cuối ghi là "chưa từng". (FR03, edge path "chưa từng có lượt khoẻ") |
| `EPIC-002-FIX-AC07` | **Given** owner đã nhận tin ngừng lúc N và vẫn chưa hồi phục, **when** bên quan sát chạy ở N+1h … N+5h59, **then** không gửi thêm tin; **when** chạy ở N+6h (±5 phút), **then** owner nhận 1 tin nhắc có tổng thời gian ngừng. (FR05) |
| `EPIC-002-FIX-AC08` | **Given** một đợt ngừng đã được báo, **when** có lại một lượt khoẻ lúc R, **then** chậm nhất R+5 phút owner nhận đúng 1 tin "đã hồi phục" có bắt đầu, kết thúc và thời lượng; **when** các lượt khoẻ tiếp tục, **then** không có tin nào thêm. **Given** một khoảng 10 phút không có lượt khoẻ (chưa tới ngưỡng) rồi hồi phục, **then** không gửi tin nào. (FR06) |
| `EPIC-002-FIX-AC09` | **Given** trong 20 phút liên tục chỉ có lượt `rejected`, **then** tin ngừng nêu dấu hiệu "bị từ chối" kèm số lần. **Given** chỉ có `no-price`, **then** nêu "không lấy được giá". **Given** không có ghi nhận nào, **then** nêu "không có lượt gọi nào". (FR04) |
| `EPIC-002-FIX-AC10` | **Given** gửi tin ngừng cho owner thất bại, **then** tin đó không được đánh dấu đã gửi, và bên quan sát thử lại ở lần chạy sau (≤ 5 phút). Tin cảnh báo giá cho người dùng trong cùng khoảng không bị ảnh hưởng. (edge path, FR04) |
| `EPIC-002-FIX-AC11` | **Given** chưa cấu hình chat owner, **when** bot khởi động và việc canh giá ngừng quá 15 phút, **then** bot khởi động bình thường, không gửi tin nào, việc ghi nhận vẫn chạy, và report hiện "chưa cấu hình chat owner". (FR08) |
| `EPIC-002-FIX-AC12` | **Given** kho trạng thái không truy cập được trong 3 giờ, **then** owner nhận ≤ 3 tin giám sát trong 3 giờ đó. (NFR05) |
| `EPIC-002-FIX-AC13` | **Given** việc canh giá vẫn chạy mỗi phút nhưng bên quan sát không chạy từ lúc W, **when** tới W+35 phút, **then** owner đã nhận 1 tin "bên giám sát ngừng chạy"; **when** bên quan sát chạy lại, **then** owner nhận 1 tin hồi phục. (FR07) |
| `EPIC-002-FIX-AC14` | **Given** log gồm một đợt 32 phút không có ghi nhận nào, rồi 20 phút toàn `rejected`, rồi các lượt `healthy`, **when** chạy report, **then** report liệt kê 1 đợt ngừng dài 52 phút, cho biết trong đợt có "không được gọi" và "bị từ chối", kèm số lần theo loại, và p95 khoảng cách AC18 chỉ tính trên lượt `healthy`. (FR09) |
| `EPIC-002-FIX-AC15` | **Given** chỉ có `KV_REST_API_URL` và một token **read-only** của Upstash, **when** chạy `npm run alerts:report`, **then** report chạy xong và không ghi gì vào lưu trữ. (NFR11, FR09) |
| `EPIC-002-FIX-AC16` | **Given** production vận hành bình thường 24 giờ sau deploy, **then** owner nhận 0 tin giám sát (NFR02), và owner xác nhận trên dashboard rằng mức dùng Upstash và Active CPU dự kiến theo tháng nằm trong NFR04 và NFR06. (NFR02, NFR04, NFR06; owner quan sát, không tự động hoá được) |
| `EPIC-002-FIX-AC17` | **Given** production, **when** owner tạm tắt job kích hoạt việc canh giá, **then** owner nhận tin ngừng trong ≤ 20 phút; **when** bật lại, **then** nhận tin hồi phục trong ≤ 5 phút. (NFR01; kiểm tra thật sau deploy, được ghi trong `DEPLOYMENT.md`) |
| `EPIC-002-FIX-AC18` | **Given** một người chỉ có `docs/DEPLOYMENT.md` §8a và quyền vào Upstash Console, cron-job.org và Vercel, **when** làm theo từ đầu đến cuối, **then** chạy được report, thấy ≥ 3 lượt `healthy` mới trong 5 phút sau khi bật job, và không có bước nào dùng `vercel env pull` cho `KV_REST_API_*`. (FR10) |
| `EPIC-002-FIX-AC19` | **Given** toàn bộ test của EPIC-002, **when** chạy lại sau thay đổi này, **then** tất cả vẫn pass. **Given** việc ghi nhận một lượt bị lỗi, **then** lượt kiểm tra vẫn xử lý cảnh báo bình thường. (NFR09) |
| `EPIC-002-FIX-AC20` | **When** bên quan sát được kích hoạt bằng secret của digest, secret của việc canh giá, hoặc không có secret, **then** trả `401` và không gửi tin nào. (NFR08; chỉ áp dụng nếu `plan.md` chọn một endpoint do máy gọi) |

## 7. Out of scope

- Sửa sự cố URL của cron-job.org (owner đã sửa ngày 2026-09-24) và đo lại AC18 của EPIC-002 (đang theo dõi, không chờ epic này).
- Báo cho chính các chat có cảnh báo khi việc canh giá tạm ngừng. Mặc định chỉ báo owner, chờ owner chốt §8 Concern 3.
- Giám sát bản tin 9h sáng, webhook hay các phần khác của bot. Mặc định chỉ việc canh giá, chờ owner chốt §8 Concern 4.
- Kênh báo khác ngoài Zalo (email, SMS, pager). Owner đã chọn Zalo và chấp nhận rằng khi chính kênh Zalo hỏng thì báo động không tới.
- Lệnh chat để tắt tạm hoặc xác nhận báo động (mute/ack). Muốn im lặng thì tắt bên quan sát (FR10d).
- Tự sửa hay tự khởi động lại job kích hoạt. Hệ thống chỉ báo, không tự sửa.
- Dashboard hay giao diện web. Report dòng lệnh là đủ.
- Thay đổi hành vi cảnh báo giá của EPIC-002 (NFR09).
- Chuyển gói hosting hay đổi nhà cung cấp chính.

## 8. Concerns

| # | Concern | Needs | Resolution |
|---|---|---|---|
| 1 | **Ai quan sát sự vắng mặt của lượt chạy?** Việc canh giá do cron-job.org kích hoạt từ bên ngoài; khi không ai gọi thì không có code nào chạy, nên lượt chạy không thể tự báo là mình vắng mặt. Các lựa chọn: **(A)** một job thứ hai *cùng* trên cron-job.org, mỗi 5 phút, gọi bên quan sát. Phát hiện được sai URL hay sai secret của job chính, lỗi khi chạy và nguồn giá hỏng, nhưng không phát hiện được sự cố cả tài khoản hay dịch vụ cron-job.org (bị khoá, bị ngừng). **(B)** bên quan sát được kích hoạt từ **một nhà cung cấp lập lịch khác** cron-job.org, miễn phí, chu kỳ ≤ 5 phút, và tin cậy được về thời điểm (GitHub Actions `schedule` đã bị loại vì chạy trễ hàng giờ). Bắt được mọi trường hợp của A, cộng thêm sự cố của cron-job.org. **(C)** kiểm tra "ké" khi có webhook hoặc khi bản tin 9h chạy. Không tốn gì, nhưng không có giới hạn thời gian phát hiện (có thể tới 24 giờ), nên không đạt ngưỡng 15 phút. **(D)** dùng tính năng báo lỗi sẵn có của cron-job.org. Chỉ thấy lỗi HTTP của những lượt *có chạy*, không thấy job bị tắt hay sai URL trỏ ra ngoài, và không báo qua Zalo. | Owner (chọn A hay B); Engineer (`plan.md` chọn nhà cung cấp cụ thể) | **PO đề xuất B**, bắt buộc hành vi ở FR03: *độc lập với nguồn kích hoạt*, ≤ 5 phút, miễn phí. Kèm FR07 (quan sát lẫn nhau) để một bên hỏng thì bên kia báo. Nếu `plan.md` không tìm được nhà cung cấp nào thoả B trong ràng buộc miễn phí và độ tin cậy, thì **quay lại owner** để chấp nhận A (và ghi nhận rằng sự cố cả dịch vụ cron-job.org sẽ không được phát hiện). Rủi ro còn lại: cả hai bên cùng hỏng một lúc thì không ai báo. Chấp nhận ở quy mô hiện tại. **Owner cần xác nhận trước build-plan.** |
| 2 | Chat nhận tin của owner chưa có cấu hình nào. `DIGEST_CHAT_ID` có thể đang giữ đúng chat của owner, nhưng nó được ghi là giá trị cũ chỉ dùng cho seed; dùng lại nó sẽ làm hồi sinh một biến đã "khai tử". | Product Owner | **Đã chốt:** một giá trị cấu hình riêng cho chat owner (FR08). Không bắt buộc có, và không dùng lại `DIGEST_CHAT_ID` lúc runtime. Owner điền đúng giá trị chat của mình khi deploy; nếu đó chính là giá trị `DIGEST_CHAT_ID` hiện tại thì copy sang. |
| 3 | Intent Q3: các chat có cảnh báo có nên được báo khi việc canh giá tạm ngừng không? Báo họ thì đúng với nỗi đau ở intent §2 ("họ đã thôi tự kiểm tra giá"), nhưng tăng nguy cơ spam và lộ trạng thái vận hành cho người dùng. | Owner | **Hoãn, owner: Thach.** Mặc định: chỉ báo owner (§7). Có thể thêm sau như một yêu cầu riêng mà không đổi thiết kế của epic này, vì nó chỉ thêm người nhận cho cùng sự kiện ngừng/hồi phục. |
| 4 | Intent Q4: có áp dụng "biết khi ngừng chạy" cho bản tin 9h không? Lần gửi đầu tiên của bản tin theo từng subscriber (Initiative 1) cũng chưa được xác nhận. | Owner | **Hoãn, owner: Thach.** Mặc định: chỉ việc canh giá (§7). Bản tin chạy mỗi ngày một lần nên cần ngưỡng khác (vd. "chưa gửi lúc 9h30"). Nên làm thành epic riêng nếu owner muốn. |
| 5 | Intent Q6: sửa hướng dẫn đo trong epic này hay tách riêng? | Product Owner | **Đã chốt:** làm trong epic này (FR10), vì hướng dẫn đo và báo động phải đi cùng nhau, và phần sửa rất nhỏ. |
| 6 | Tin nhắc mỗi 6 giờ (FR05) và ngưỡng 30 phút cho bên quan sát (FR07) là con số PO tự đặt, owner chưa trả lời. | Owner | **Đã chốt tạm (PO):** 6 giờ và 30 phút. Owner có thể chỉnh khi duyệt spec mà không đổi thiết kế. |
| 7 | Ngân sách Upstash: số hiện tại (~260k lệnh/tháng) là ước tính, chưa đo; thêm việc ghi nhận mọi loại lượt chạy và bên quan sát có thể đẩy gần mức free 500k. | Engineer (phase `build-plan`) | **Hoãn có chủ, owner: engineer ở `plan.md`.** Ràng buộc bằng NFR03, NFR04. `plan.md` phải lấy số thực tế trên Upstash dashboard (production đang chạy ~1 lượt/phút từ 2026-09-24T15:25Z), cộng phần tăng thêm, và chứng minh ≤ 400k. |
| 8 | Ghi nhận lượt bị từ chối (FR02) là một đường ghi mới do request **chưa xác thực** gây ra. Làm ngây thơ (mỗi request một lần ghi) thì bất kỳ ai cũng đốt được quota Upstash, làm sập cả việc canh giá. | Product Owner; `risk-security-reviewer` ở phase review | **Đã chốt:** giới hạn ≤ 1 lệnh ghi/phút bất kể lưu lượng, không lưu dữ liệu request (NFR03, AC04). Số đếm được phép là xấp xỉ. Reviewer xem lại ở phase review. |

---

*No implementation detail: no libraries, tables, endpoints or file layouts.*
