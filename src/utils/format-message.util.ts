import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import {
  AlertDirection,
  MonitorAction,
  OutageSignal,
  PriceAlert,
} from '../price-alerts/interfaces/price-alert.interface';
import {
  HoldingsResult,
  PortfolioSnapshot,
  PortfolioTrade,
} from '../portfolio/interfaces/portfolio.interface';
import { formatQuantityUnits, toQuantityUnits } from '../portfolio/portfolio-calculator';
import type { TradePage } from '../portfolio/portfolio.service';

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
  portfolioSection?: string,
): string {
  const lines = coins.map((coin) => formatCoinLine(coin, usdToVndRate));
  const body = ['🌅 Bản tin giá sáng nay:', ...lines];
  if (portfolioSection) body.push('', portfolioSection);
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
    '• /danhmuc mua btc 0.5 60000 — ghi mua 0.5 BTC giá $60,000 (dùng ban thay cho mua khi bán)',
    '• /danhmuc — xem danh mục và lãi/lỗ · /danhmuc lichsu — lịch sử · /danhmuc xoa 3 — xoá giao dịch #3 (chỉ trong chat riêng)',
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

// ---------------------------------------------------------------------------
// Portfolio ("/danhmuc", EPIC-003)
// ---------------------------------------------------------------------------

const PORTFOLIO_TRADE_EXAMPLE = 'Ví dụ: /danhmuc mua btc 0.5 60000 (0.5 BTC, giá $60,000 mỗi BTC)';

/** "0.50000000" -> "0.5"; as typed when it can't be normalized. */
function formatQuantity(quantity: string): string {
  try {
    return formatQuantityUnits(toQuantityUnits(quantity));
  } catch {
    return quantity;
  }
}

/** "+$3,000.00 (~+76.200.000₫)" / "−$492.26 (~−12.503.404₫)" (spec EPIC-003-FR08). */
function formatSignedMoney(amountUsd: number, usdToVndRate: number): string {
  const sign = amountUsd < 0 ? '−' : '+';
  const magnitude = Math.abs(amountUsd);
  return `${sign}${formatUsd(magnitude)} (~${sign}${toVndDisplay(magnitude, usdToVndRate)})`;
}

function formatSignedPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '';
  return ` (${percent < 0 ? '−' : '+'}${Math.abs(percent).toFixed(2)}%)`;
}

function pnlEmoji(amountUsd: number): string {
  return amountUsd < 0 ? '🔻' : '🔺';
}

function formatMoney(amountUsd: number, usdToVndRate: number): string {
  return `${formatUsd(amountUsd)} (~${toVndDisplay(amountUsd, usdToVndRate)})`;
}

/** Notes for coins left out of the totals or the 24h change (spec AC13). */
function formatExclusions(snapshot: PortfolioSnapshot): string[] {
  const notes: string[] = [];
  if (snapshot.unpricedSymbols.length > 0) {
    notes.push(
      `ℹ️ Tổng chưa gồm ${snapshot.unpricedSymbols.join(', ').toUpperCase()} (không có giá lúc này).`,
    );
  }
  if (snapshot.missingChangeSymbols.length > 0) {
    notes.push(
      `ℹ️ Biến động 24h chưa gồm ${snapshot.missingChangeSymbols.join(', ').toUpperCase()} (không có số liệu 24h).`,
    );
  }
  return notes;
}

function formatChange24h(snapshot: PortfolioSnapshot, usdToVndRate: number): string {
  if (snapshot.change24hUsd === null) {
    return '📅 Biến động 24h: không có số liệu';
  }
  return `📅 Biến động 24h: ${pnlEmoji(snapshot.change24hUsd)} ${formatSignedMoney(
    snapshot.change24hUsd,
    usdToVndRate,
  )}${formatSignedPercent(snapshot.change24hPercent)}`;
}

/** Full reply for "/danhmuc" (spec EPIC-003-FR06, FR07, FR08). */
export function formatPortfolioReply(snapshot: PortfolioSnapshot, usdToVndRate: number): string {
  const body = ['💼 Danh mục của bạn:'];
  if (snapshot.lines.length === 0) {
    body.push('Không còn coin nào đang giữ (đã bán hết).');
  }
  for (const line of snapshot.lines) {
    const symbol = line.symbol.toUpperCase();
    if (!line.priced) {
      body.push(`• ${formatQuantity(line.quantity)} ${symbol}: không có giá lúc này`);
      continue;
    }
    body.push(
      `• ${formatQuantity(line.quantity)} ${symbol} × ${formatUsd(line.priceUsd)} = ${formatMoney(
        line.valueUsd,
        usdToVndRate,
      )}`,
      `   Lãi/lỗ: ${pnlEmoji(line.unrealizedPnlUsd)} ${formatSignedMoney(
        line.unrealizedPnlUsd,
        usdToVndRate,
      )}${formatSignedPercent(line.unrealizedPnlPercent)}`,
    );
  }

  body.push('', `💰 Tổng giá trị: ${formatMoney(snapshot.totalValueUsd, usdToVndRate)}`);
  if (snapshot.lines.some((line) => line.priced)) {
    body.push(
      `📈 Lãi/lỗ chưa chốt: ${pnlEmoji(snapshot.unrealizedPnlUsd)} ${formatSignedMoney(
        snapshot.unrealizedPnlUsd,
        usdToVndRate,
      )}${formatSignedPercent(snapshot.unrealizedPnlPercent)}`,
    );
  }
  body.push(`✅ Lãi/lỗ đã chốt: ${formatSignedMoney(snapshot.realizedPnlUsd, usdToVndRate)}`);
  if (snapshot.lines.some((line) => line.priced)) {
    body.push(formatChange24h(snapshot, usdToVndRate));
  }
  body.push(...formatExclusions(snapshot));
  body.push('', 'Giá vốn tính theo giá trung bình. VND là ước tính theo tỷ giá cố định.');
  return body.join('\n');
}

/** Portfolio part of the 9am digest (spec EPIC-003-FR11). */
export function formatPortfolioDigestSection(
  snapshot: PortfolioSnapshot,
  usdToVndRate: number,
): string {
  const body = [`💼 Danh mục: ${formatMoney(snapshot.totalValueUsd, usdToVndRate)}`];
  if (snapshot.lines.some((line) => line.priced)) {
    body.push(
      `📈 Lãi/lỗ chưa chốt: ${pnlEmoji(snapshot.unrealizedPnlUsd)} ${formatSignedMoney(
        snapshot.unrealizedPnlUsd,
        usdToVndRate,
      )}${formatSignedPercent(snapshot.unrealizedPnlPercent)}`,
      formatChange24h(snapshot, usdToVndRate),
    );
  }
  body.push(...formatExclusions(snapshot));
  return body.join('\n');
}

/** Digest line when the portfolio couldn't be computed (spec EPIC-003-NFR08). */
export function formatPortfolioDigestUnavailableSection(): string {
  return '💼 Danh mục: tạm thời không có số liệu.';
}

/** Reply for "/danhmuc" before any trade (spec EPIC-003-AC07). */
export function formatPortfolioEmptyReply(): string {
  return ['📭 Danh mục của bạn đang trống.', PORTFOLIO_TRADE_EXAMPLE].join('\n');
}

/** "#3 Mua 0.5 BTC × $60,000.00" */
function formatTradeSummary(trade: PortfolioTrade): string {
  return `#${trade.seq} ${trade.side === 'buy' ? 'Mua' : 'Bán'} ${formatQuantity(
    trade.quantity,
  )} ${trade.symbol.toUpperCase()} × ${ALERT_THRESHOLD_FORMATTER.format(trade.priceUsd)}`;
}

/** "Đang giữ: 0.6 BTC, giá vốn TB $65,000.00" — the coin's position after a write. */
function formatPositionLine(symbol: string, holdings: HoldingsResult): string {
  const holding = holdings.holdings.find((item) => item.symbol === symbol);
  if (!holding) {
    return `Đang giữ: 0 ${symbol.toUpperCase()}`;
  }
  return `Đang giữ: ${holding.quantity} ${symbol.toUpperCase()}, giá vốn TB ${ALERT_THRESHOLD_FORMATTER.format(
    holding.avgCostUsd,
  )}`;
}

/** Reply for a recorded "/danhmuc mua|ban ..." (spec EPIC-003-AC01). */
export function formatPortfolioTradeRecordedReply(
  trade: PortfolioTrade,
  holdings: HoldingsResult,
  usdToVndRate: number,
): string {
  const body = [
    `✅ Đã ghi giao dịch ${formatTradeSummary(trade)}`,
    formatPositionLine(trade.symbol, holdings),
  ];
  if (trade.side === 'sell') {
    body.push(
      `Lãi/lỗ đã chốt của ${trade.symbol.toUpperCase()}: ${formatSignedMoney(
        holdings.realizedBySymbol.get(trade.symbol) ?? 0,
        usdToVndRate,
      )}`,
    );
  }
  body.push('Gõ /danhmuc để xem danh mục, /danhmuc lichsu để xem lịch sử.');
  return body.join('\n');
}

/** "25/09/2026" in Vietnam time. */
function formatIctDate(date: Date): string {
  const ict = new Date(date.getTime() + ICT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(ict.getUTCDate())}/${pad(ict.getUTCMonth() + 1)}/${ict.getUTCFullYear()}`;
}

/** Reply for "/danhmuc lichsu [page]" (spec EPIC-003-FR09). */
export function formatPortfolioHistoryReply(page: TradePage): string {
  if (page.total === 0) {
    return formatPortfolioEmptyReply();
  }
  if (page.trades.length === 0) {
    return `⚠️ Không có trang ${page.page}. Lịch sử có ${page.pageCount} trang.`;
  }
  const lines = page.trades.map(
    (trade) => `${formatTradeSummary(trade)} — ${formatIctDate(trade.createdAt)}`,
  );
  const body = [
    `🧾 Lịch sử giao dịch (trang ${page.page}/${page.pageCount}, mới nhất trước):`,
    ...lines,
  ];
  if (page.page < page.pageCount) {
    body.push('', `Xem tiếp: /danhmuc lichsu ${page.page + 1}`);
  }
  body.push('Xoá một giao dịch: /danhmuc xoa <số>');
  return body.join('\n');
}

/** Reply for "/danhmuc xoa <n>" (spec EPIC-003-FR10). */
export function formatPortfolioDeletedReply(
  trade: PortfolioTrade,
  holdings: HoldingsResult,
): string {
  return [
    `🗑️ Đã xoá giao dịch ${formatTradeSummary(trade)}`,
    formatPositionLine(trade.symbol, holdings),
  ].join('\n');
}

export function formatPortfolioNotFoundReply(index: number): string {
  return `⚠️ Không tìm thấy giao dịch #${index}. Gõ /danhmuc lichsu để xem số thứ tự.`;
}

/** Reply when a sell exceeds the holding (spec EPIC-003-AC04). */
export function formatPortfolioOversellReply(symbol: string, heldQuantity: string): string {
  return `⚠️ Không thể bán nhiều hơn số đang giữ: bạn đang giữ ${formatQuantity(
    heldQuantity,
  )} ${symbol.toUpperCase()}. Chưa ghi giao dịch nào.`;
}

/** Reply when deleting a trade would make a later sell an oversell (spec EPIC-003-AC09). */
export function formatPortfolioDeleteRefusedReply(index: number, symbol: string): string {
  return [
    `⚠️ Không thể xoá giao dịch #${index}: một lần bán ${symbol.toUpperCase()} sau đó sẽ thành bán nhiều hơn số đang giữ.`,
    'Hãy xoá giao dịch bán đó trước (xem /danhmuc lichsu).',
  ].join('\n');
}

/** Reply for the trade or held-coin cap (spec EPIC-003-AC14). */
export function formatPortfolioLimitReply(kind: 'trades' | 'coins', limit: number): string {
  return kind === 'trades'
    ? `⚠️ Mỗi chat ghi được tối đa ${limit} giao dịch. Xoá bớt bằng /danhmuc xoa <số>.`
    : `⚠️ Mỗi chat giữ được tối đa ${limit} coin khác nhau. Bán hết một coin trước khi mua coin mới.`;
}

/** Reply for "/danhmuc ..." with arguments that don't parse (spec EPIC-003-AC05). */
export function formatPortfolioInvalidReply(): string {
  return [
    '⚠️ Cú pháp danh mục chưa đúng.',
    PORTFOLIO_TRADE_EXAMPLE,
    'Bán: /danhmuc ban btc 0.4 80000',
    'Số lượng và giá (USD) dùng "." cho số lẻ, "," cho hàng nghìn (không hỗ trợ "60k"); số lượng tối đa 8 chữ số lẻ.',
    'Xem: /danhmuc · Lịch sử: /danhmuc lichsu · Xoá: /danhmuc xoa 3 · Xoá hết: /danhmuc xoahet',
  ].join('\n');
}

/** Reply for any "/danhmuc" command outside a private chat (spec EPIC-003-FR12). */
export function formatPortfolioGroupRefusedReply(): string {
  return '🔒 Danh mục là thông tin riêng, nên chỉ dùng được khi nhắn riêng cho bot. Hãy mở chat riêng với bot và gõ /danhmuc.';
}

/** Reply for "/danhmuc xoahet" without confirmation (spec EPIC-003-AC15). */
export function formatPortfolioClearConfirmReply(): string {
  return [
    '⚠️ Lệnh này sẽ xoá TOÀN BỘ giao dịch trong danh mục của bạn, không khôi phục được.',
    'Nếu chắc chắn, gõ: /danhmuc xoahet xacnhan',
  ].join('\n');
}

export function formatPortfolioClearedReply(deletedCount: number): string {
  return `🗑️ Đã xoá ${deletedCount} giao dịch. Danh mục của bạn giờ đang trống.`;
}

/** Reply when the portfolio store is down (spec EPIC-003-AC19). */
export function formatPortfolioUnavailableReply(): string {
  return '⚠️ Tạm thời không truy cập được dữ liệu danh mục. Chưa có thay đổi nào được ghi. Vui lòng thử lại sau ít phút.';
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
