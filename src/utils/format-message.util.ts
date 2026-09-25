import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import {
  AlertDirection,
  MonitorAction,
  OutageSignal,
  PriceAlert,
} from '../price-alerts/interfaces/price-alert.interface';

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const VND_FORMATTER = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 0,
});

/** Converts a USD amount to a formatted VND string using a static rate from config. */
export function toVndDisplay(usdAmount: number, usdToVndRate: number): string {
  return `${VND_FORMATTER.format(usdAmount * usdToVndRate)}₫`;
}

function formatUsd(amount: number): string {
  return USD_FORMATTER.format(amount);
}

function changeEmoji(changePercent: number | null): string {
  if (changePercent === null || Number.isNaN(changePercent)) return '➖';
  return changePercent >= 0 ? '🔺' : '🔻';
}

function formatChangePercent(changePercent: number | null): string {
  if (changePercent === null || Number.isNaN(changePercent)) return 'N/A';
  const sign = changePercent >= 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
}

/** One line describing a single coin's price, VND estimate, and 24h change. */
export function formatCoinLine(coin: CoinMarketData, usdToVndRate: number): string {
  const emoji = changeEmoji(coin.changePercent24h);
  const change = formatChangePercent(coin.changePercent24h);
  return `${emoji} ${coin.name} (${coin.symbol.toUpperCase()}): ${formatUsd(coin.priceUsd)} (~${toVndDisplay(
    coin.priceUsd,
    usdToVndRate,
  )}) | ${change} (24h)`;
}

/** Full reply for "/gia <symbols...>". */
export function formatPriceReply(coins: CoinMarketData[], usdToVndRate: number): string {
  const lines = coins.map((coin) => formatCoinLine(coin, usdToVndRate));
  return ['💰 Giá thị trường:', ...lines].join('\n');
}

/** Daily scheduled digest for a fixed watchlist (e.g. the 9am BTC/ETH/YGG push). */
export function formatDailyDigestReply(
  coins: CoinMarketData[],
  usdToVndRate: number,
  cronTrackingLine?: string,
): string {
  const lines = coins.map((coin) => formatCoinLine(coin, usdToVndRate));
  const body = ['🌅 Bản tin giá sáng nay:', ...lines];
  if (cronTrackingLine) body.push('', cronTrackingLine);
  return body.join('\n');
}

const EXPECTED_DIGEST_HOUR_ICT = 9;
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Temporary cron-timing footer (see DIGEST_CRON_TRACKING in
 * src/config/configuration.ts) — computes how far the actual invocation
 * landed from the expected 09:00 ICT slot, so drift is visible in the chat
 * itself across days without needing a database.
 */
export function formatCronTrackingLine(invokedAt: Date): string {
  const ict = new Date(invokedAt.getTime() + ICT_OFFSET_MS);
  const hours = ict.getUTCHours();
  const minutes = ict.getUTCMinutes();
  const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const driftMinutes = (hours - EXPECTED_DIGEST_HOUR_ICT) * 60 + minutes;
  const sign = driftMinutes >= 0 ? '+' : '';
  return `🕐 [cron-tracking] nhận lúc ${label} (ICT) — lệch ${sign}${driftMinutes} phút so với 09:00`;
}

/** Full reply for "/gia" with no symbols — top-N coins by market cap. */
export function formatTopMarketsReply(coins: CoinMarketData[], usdToVndRate: number): string {
  const lines = coins.map((coin, index) => `${index + 1}. ${formatCoinLine(coin, usdToVndRate)}`);
  return ['🏆 Top thị trường theo vốn hóa:', ...lines].join('\n');
}

export function formatHelpReply(): string {
  return [
    '👋 Xin chào! Tôi là bot giá tiền điện tử.',
    '',
    'Các lệnh hỗ trợ:',
    '• /gia btc — xem giá Bitcoin',
    '• /gia btc eth sol — xem giá nhiều đồng cùng lúc',
    '• /gia (không kèm mã) — top 5 coin theo vốn hóa',
    '• /price btc — tương đương /gia btc (tiếng Anh)',
    '• /dangky btc eth — đăng ký nhận bản tin giá 9h sáng mỗi ngày',
    '• /watchlist — xem hoặc /watchlist btc sol để đổi danh sách theo dõi',
    '• /huy — hủy đăng ký bản tin hàng ngày',
    '• /canhbao btc > 100000 — báo khi giá BTC vượt lên trên $100,000 (dùng < để báo khi rơi xuống dưới)',
    '• /canhbao — xem cảnh báo, /canhbao xoa 1 để xoá cảnh báo số 1',
    '',
    'Lệnh có dấu hoặc không dấu đều được hỗ trợ (vd: /giá btc = /gia btc).',
  ].join('\n');
}

/** Reply for "/dangky [symbols...]" — confirms the digest subscription and its watchlist. */
export function formatSubscribeReply(watchlist: string[]): string {
  return [
    `✅ Đã đăng ký nhận bản tin giá hàng ngày lúc 9h sáng (ICT).`,
    `Danh sách theo dõi: ${watchlist.join(', ').toUpperCase()}`,
    'Dùng /watchlist để xem hoặc đổi danh sách, /huy để hủy đăng ký.',
  ].join('\n');
}

/** Reply for "/huy". */
export function formatUnsubscribeReply(): string {
  return '👋 Đã hủy đăng ký bản tin giá hàng ngày. Gõ /dangky bất cứ lúc nào để đăng ký lại.';
}

/** Reply for "/watchlist" with no symbols — shows the current watchlist. */
export function formatWatchlistViewReply(watchlist: string[] | null): string {
  if (!watchlist || watchlist.length === 0) {
    return [
      '📭 Bạn chưa đăng ký bản tin giá hàng ngày.',
      'Gõ /dangky btc eth để đăng ký với danh sách theo dõi.',
    ].join('\n');
  }
  return [
    `📋 Danh sách theo dõi hiện tại: ${watchlist.join(', ').toUpperCase()}`,
    'Dùng /watchlist btc eth sol để đổi danh sách.',
  ].join('\n');
}

/** Reply for "/watchlist <symbols...>" — confirms the watchlist was updated. */
export function formatWatchlistUpdatedReply(watchlist: string[]): string {
  return `✅ Đã cập nhật danh sách theo dõi: ${watchlist.join(', ').toUpperCase()}`;
}

/** Reply when "/watchlist <symbols...>" is used by a chat that isn't subscribed yet. */
export function formatWatchlistNotSubscribedReply(): string {
  return [
    '📭 Bạn chưa đăng ký bản tin giá hàng ngày.',
    'Gõ /dangky btc eth để đăng ký trước, sau đó dùng /watchlist để đổi danh sách.',
  ].join('\n');
}

/** Reply when a subscribe/watchlist symbol list is empty or exceeds the cap. */
export function formatInvalidWatchlistReply(message: string): string {
  return `⚠️ ${message}`;
}

export function formatUnknownCommandReply(): string {
  return ['❓ Tôi chưa hiểu lệnh này.', 'Gõ /help để xem danh sách lệnh, hoặc thử: /gia btc'].join(
    '\n',
  );
}

export function formatUnknownSymbolsReply(symbols: string[]): string {
  return `⚠️ Không tìm thấy đồng coin: ${symbols.join(', ').toUpperCase()}. Vui lòng kiểm tra lại mã coin.`;
}

export function formatServiceUnavailableReply(): string {
  return '⚠️ Không thể lấy dữ liệu giá lúc này (dịch vụ CoinGecko đang bận hoặc quá giới hạn). Vui lòng thử lại sau ít phút.';
}

const ALERT_SYNTAX_EXAMPLE = 'Ví dụ: /canhbao btc > 100000 hoặc /canhbao eth < 2000';

/** Like USD_FORMATTER, but shows all 8 decimals /canhbao accepts, so tiny thresholds don't read as $0.00. */
const ALERT_THRESHOLD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

/** "BTC > $100,000.00" — the alert condition as shown to the user. */
function formatAlertCondition(
  symbol: string,
  direction: AlertDirection,
  threshold: number,
): string {
  return `${symbol.toUpperCase()} ${direction === 'above' ? '>' : '<'} ${ALERT_THRESHOLD_FORMATTER.format(threshold)}`;
}

/** Reply for a successful "/canhbao <coin> > <price>". */
export function formatAlertCreatedReply(
  alert: PriceAlert,
  position: number,
  currentPriceUsd: number,
  usdToVndRate: number,
): string {
  return [
    `🔔 Đã đặt cảnh báo #${position}: ${formatAlertCondition(alert.symbol, alert.direction, alert.threshold)}`,
    `Giá hiện tại: ${formatUsd(currentPriceUsd)} (~${toVndDisplay(currentPriceUsd, usdToVndRate)})`,
    'Bot kiểm tra giá khoảng mỗi phút. Gõ /canhbao để xem danh sách cảnh báo.',
  ].join('\n');
}

/** Reply for "/canhbao" with no arguments. */
export function formatAlertListReply(alerts: PriceAlert[]): string {
  if (alerts.length === 0) {
    return ['📭 Bạn chưa có cảnh báo giá nào.', ALERT_SYNTAX_EXAMPLE].join('\n');
  }
  const lines = alerts.map(
    (alert, i) =>
      `${i + 1}. ${formatAlertCondition(alert.symbol, alert.direction, alert.threshold)} — ${
        alert.state === 'armed' ? 'đang canh' : 'đã báo, chờ giá quay lại'
      }`,
  );
  return ['🔔 Cảnh báo giá của bạn:', ...lines, '', 'Gõ /canhbao xoa <số> để xoá.'].join('\n');
}

/** Reply for "/canhbao xoa <n>". */
export function formatAlertDeletedReply(alert: PriceAlert, index: number): string {
  return `🗑️ Đã xoá cảnh báo #${index}: ${formatAlertCondition(alert.symbol, alert.direction, alert.threshold)}`;
}

export function formatAlertNotFoundReply(index: number): string {
  return `⚠️ Không tìm thấy cảnh báo #${index}. Gõ /canhbao để xem danh sách.`;
}

export function formatAlertLimitReply(limit: number): string {
  return `⚠️ Bạn đã có tối đa ${limit} cảnh báo. Gõ /canhbao để xem và /canhbao xoa <số> để xoá bớt.`;
}

/** Reply when the requested condition is already true at the current price (spec EPIC-002-FR10). */
export function formatAlertAlreadyMetReply(
  symbol: string,
  direction: AlertDirection,
  currentPriceUsd: number,
): string {
  return [
    `ℹ️ Giá ${symbol.toUpperCase()} hiện là ${formatUsd(currentPriceUsd)} — điều kiện ${
      direction === 'above' ? 'vượt lên trên' : 'rơi xuống dưới'
    } mức này đã đúng rồi, nên chưa đặt cảnh báo.`,
    'Hãy chọn một mức giá khác.',
  ].join('\n');
}

/** Reply for "/canhbao ..." with arguments that don't parse. */
export function formatAlertInvalidReply(): string {
  return [
    '⚠️ Cú pháp cảnh báo chưa đúng.',
    ALERT_SYNTAX_EXAMPLE,
    'Mức giá tính bằng USD: dùng "." cho số lẻ, "," cho hàng nghìn (không hỗ trợ "100k").',
    'Xem cảnh báo: /canhbao · Xoá: /canhbao xoa 1',
  ].join('\n');
}

/** Push message sent when an alert fires (spec EPIC-002-FR11). */
export function formatAlertTriggeredMessage(
  alert: PriceAlert,
  currentPriceUsd: number,
  usdToVndRate: number,
): string {
  return [
    `🚨 Cảnh báo giá: ${formatAlertCondition(alert.symbol, alert.direction, alert.threshold)}`,
    `Giá hiện tại: ${formatUsd(currentPriceUsd)} (~${toVndDisplay(currentPriceUsd, usdToVndRate)})`,
    'Cảnh báo sẽ tự bật lại khi giá quay về. Gõ /canhbao để xem hoặc xoá.',
  ].join('\n');
}

export function formatGenericErrorReply(): string {
  return '⚠️ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn. Vui lòng thử lại sau.';
}

/** "14:05 25/09" in Vietnam time, for monitoring messages. */
function formatIctDateTime(isoTimestamp: string): string {
  const ict = new Date(Date.parse(isoTimestamp) + ICT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(ict.getUTCHours())}:${pad(ict.getUTCMinutes())} ${pad(ict.getUTCDate())}/${pad(
    ict.getUTCMonth() + 1,
  )}`;
}

/** "2 giờ 5 phút" / "15 phút" / "3 ngày 4 giờ". Rounded down to the minute. */
export function formatDurationVi(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} ngày ${hours} giờ` : `${days} ngày`;
  if (hours > 0) return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
  return `${minutes} phút`;
}

const OUTAGE_SIGNAL_LABELS: Record<keyof OutageSignal, string> = {
  rejected: 'bị từ chối (sai/thiếu secret)',
  'no-price': 'không lấy được giá',
  failed: 'lỗi khi chạy',
  skipped: 'bị bỏ qua (lượt trước còn giữ lock)',
};

/** What was seen during an outage (spec EPIC-002-FIX-FR04, AC09). */
function formatOutageSignal(signal: OutageSignal): string {
  const parts = (Object.keys(OUTAGE_SIGNAL_LABELS) as (keyof OutageSignal)[])
    .filter((kind) => (signal[kind] ?? 0) > 0)
    .map((kind) => `${OUTAGE_SIGNAL_LABELS[kind]} ${signal[kind]} lần`);
  return parts.length > 0 ? parts.join(', ') : 'không có lượt gọi nào tới bot';
}

/**
 * Owner-only monitoring messages (spec EPIC-002-FIX-FR04–FR07). `activeAlerts`
 * is the number of alerts not being watched, for "down"/"reminder".
 */
export function formatMonitorMessage(action: MonitorAction, activeAlerts: number): string {
  switch (action.kind) {
    case 'down':
    case 'reminder':
      return [
        action.kind === 'down'
          ? `⚠️ Ngừng canh giá: ${formatDurationVi(action.downForMs)} không có lượt kiểm tra nào chạy khoẻ.`
          : `⏰ Vẫn đang ngừng canh giá, đã ${formatDurationVi(action.downForMs)}.`,
        action.lastHealthyAt === null
          ? `Lượt khoẻ cuối: chưa từng (giám sát bắt đầu lúc ${formatIctDateTime(action.since)}, giờ VN)`
          : `Lượt khoẻ cuối: ${formatIctDateTime(action.lastHealthyAt)} (giờ VN)`,
        `Dấu hiệu gần nhất: ${formatOutageSignal(action.signal)}`,
        `Cảnh báo đang không được canh: ${activeAlerts}`,
        'Kiểm tra: job trên cron-job.org (đang bật, đúng URL, đúng secret) và log Vercel.',
      ].join('\n');
    case 'recovered':
      return [
        `✅ Canh giá đã chạy lại lúc ${formatIctDateTime(action.recoveredAt)} (giờ VN).`,
        `Đã ngừng từ ${formatIctDateTime(action.since)}, tổng ${formatDurationVi(action.downForMs)}.`,
      ].join('\n');
    case 'watcher-down':
      return [
        `⚠️ Bên giám sát canh giá đã im lặng ${formatDurationVi(action.silentForMs)} (lần chạy cuối ${formatIctDateTime(action.lastWatcherRunAt)}, giờ VN).`,
        'Trong lúc này, nếu việc canh giá ngừng sẽ không ai báo. Kiểm tra schedule trên Upstash QStash.',
      ].join('\n');
    case 'watcher-recovered':
      return `✅ Bên giám sát canh giá đã chạy lại lúc ${formatIctDateTime(action.recoveredAt)} (giờ VN), sau ${formatDurationVi(action.silentForMs)} im lặng.`;
  }
}

/** Sent when the watcher can't read its state from Redis (spec EPIC-002-FIX-NFR05). */
export function formatMonitorStateUnreadableMessage(): string {
  return [
    '⚠️ Bên giám sát canh giá không đọc được trạng thái (Upstash Redis lỗi).',
    'Không biết việc canh giá còn chạy không. Kiểm tra Upstash Console và log Vercel.',
  ].join('\n');
}
