import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';

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
export function formatDailyDigestReply(coins: CoinMarketData[], usdToVndRate: number): string {
  const lines = coins.map((coin) => formatCoinLine(coin, usdToVndRate));
  return ['🌅 Bản tin giá sáng nay:', ...lines].join('\n');
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
    '',
    'Lệnh có dấu hoặc không dấu đều được hỗ trợ (vd: /giá btc = /gia btc).',
  ].join('\n');
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

export function formatGenericErrorReply(): string {
  return '⚠️ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn. Vui lòng thử lại sau.';
}
