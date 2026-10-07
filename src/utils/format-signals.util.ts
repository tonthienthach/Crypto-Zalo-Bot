import { formatDurationVi, formatIctDateTime, formatUsd } from './format-message.util';
import {
  BacktestResult,
  CoinSignal,
  Scorecard,
  SignalResult,
  SignalsMonitorAction,
  Verdict,
  VerdictTally,
} from '../signals/interfaces/signal.interface';
import { BACKTEST_MIN_DAYS } from '../signals/signals.constants';

/** Shown with every message that carries a buy/sell/watch verdict (spec EPIC-004-FR07). */
export const SIGNAL_DISCLAIMER =
  '⚠️ Chỉ là thông tin tham khảo theo quy tắc đơn giản (biến động giá và vị trí trong khoảng giá 7 ngày), không phải lời khuyên đầu tư. Bạn tự chịu trách nhiệm với quyết định của mình.';

const VERDICT_LABELS: Record<Verdict, string> = {
  buy: '🟢 Cân nhắc mua',
  sell: '🔴 Cân nhắc bán / chốt lời',
  watch: '🟡 Theo dõi',
};

const SIGNAL_SYNTAX_EXAMPLE =
  'Ví dụ: /tinhieu · /tinhieu eth · /tinhieu backtest btc · /tinhieu thongke · /tinhieu tat';

const SIGNAL_USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Whole cents for ordinary prices (a range like $83,185.105519 reads badly); full precision below $1. */
function formatSignalUsd(amount: number): string {
  return amount >= 1 ? SIGNAL_USD_FORMATTER.format(amount) : formatUsd(amount);
}

function formatSignedPercent(percent: number | null): string {
  if (percent === null || Number.isNaN(percent)) return 'N/A';
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function formatRate(tally: VerdictTally): string {
  return `${((tally.correct / tally.scored) * 100).toFixed(1)}%`;
}

function windowLabel(window: SignalResult['window']): string {
  return window === '72h' ? '72 giờ' : '24 giờ';
}

function positionPhrase(result: SignalResult): string {
  const position = `${Math.round(result.positionPct ?? 0)}%`;
  const range = `${formatSignalUsd(result.rangeLow ?? 0)}–${formatSignalUsd(result.rangeHigh ?? 0)}`;
  const where =
    result.verdict === 'buy' ? 'gần đáy' : result.verdict === 'sell' ? 'gần đỉnh' : 'ở giữa';
  return `giá ${formatSignalUsd(result.priceUsd)} nằm ${where} khoảng 7 ngày (${position}, khoảng ${range})`;
}

/** The "why" of one verdict: the numbers it was built from (spec EPIC-004-FR02). */
export function formatSignalReason(result: SignalResult): string {
  return `Lý do: ${formatSignedPercent(result.movePct)} trong ${windowLabel(result.window)}; ${positionPhrase(result)}.`;
}

function formatStrongSignal(signal: CoinSignal): string[] {
  const { result } = signal;
  const arrow = result.direction === 'up' ? '🔺' : '🔻';
  return [
    `${arrow} ${signal.symbol.toUpperCase()}: ${formatSignedPercent(result.change24hPct)} (24h) · ${formatSignedPercent(result.change72hPct)} (72h) — ${VERDICT_LABELS[result.verdict!]}`,
    `   ${formatSignalReason(result)}`,
  ];
}

function isStrong(signal: CoinSignal): boolean {
  return signal.result.strong && !signal.result.insufficientData && signal.result.verdict !== null;
}

/** Proactive message for the coins swinging strongly right now (spec EPIC-004-FR04, FR05, FR07). */
export function formatSignalAlertMessage(signals: CoinSignal[]): string {
  return [
    '📡 Tín hiệu: có coin dao động mạnh',
    ...signals.filter(isStrong).flatMap(formatStrongSignal),
    '',
    SIGNAL_DISCLAIMER,
    'Tắt tin này: /tinhieu tat',
  ].join('\n');
}

/** "Tín hiệu" part of the 9am digest (spec EPIC-004-FR03). */
export function formatSignalDigestSection(signals: CoinSignal[]): string {
  const strong = signals.filter(isStrong);
  const lacking = signals.filter((signal) => signal.result.insufficientData);
  const lackingLine =
    lacking.length > 0
      ? [
          `ℹ️ Chưa đủ dữ liệu (cần 7 ngày): ${lacking.map((s) => s.symbol.toUpperCase()).join(', ')}`,
        ]
      : [];
  if (strong.length === 0) {
    return ['📡 Tín hiệu: Không có coin nào dao động mạnh.', ...lackingLine].join('\n');
  }
  return [
    '📡 Tín hiệu: coin đang dao động mạnh',
    ...strong.flatMap(formatStrongSignal),
    ...lackingLine,
    SIGNAL_DISCLAIMER,
  ].join('\n');
}

function formatSignalLine(signal: CoinSignal): string[] {
  const { result } = signal;
  const symbol = signal.symbol.toUpperCase();
  if (result.insufficientData) {
    return [`⏳ ${symbol}: chưa đủ dữ liệu (cần ít nhất 7 ngày lịch sử), chưa có nhận định.`];
  }
  if (!isStrong(signal)) {
    return [
      `➖ ${symbol}: ${formatSignalUsd(result.priceUsd)} · ${formatSignedPercent(result.change24hPct)} (24h) · ${formatSignedPercent(result.change72hPct)} (72h) — không dao động mạnh, không có nhận định.`,
    ];
  }
  return formatStrongSignal(signal);
}

/** Reply for "/tinhieu [coin]" (spec EPIC-004-FR08). */
export function formatSignalReply(signals: CoinSignal[]): string {
  const showsVerdict = signals.some(isStrong);
  return [
    '📡 Tín hiệu hiện tại:',
    ...signals.flatMap(formatSignalLine),
    ...(showsVerdict ? ['', SIGNAL_DISCLAIMER] : []),
  ].join('\n');
}

/** Added to a single-coin reply when the coin could not be tracked, so its verdict is not scored. */
export function formatSignalNotScoredNote(): string {
  return 'ℹ️ Hiện đã theo dõi tạm đủ số coin tối đa, nên nhận định này không được tính vào bảng điểm (/tinhieu thongke).';
}

/** Reply for "/tinhieu" when the chat has no watchlist (spec EPIC-004 §3.2). */
export function formatSignalNoWatchlistReply(): string {
  return [
    '📭 Bạn chưa có danh sách theo dõi nên chưa có tín hiệu để xem.',
    'Gõ /dangky btc eth để đăng ký, hoặc xem một coin bất kỳ: /tinhieu btc',
  ].join('\n');
}

function formatTallyLine(label: string, tally: VerdictTally, unit: string): string {
  return tally.scored === 0
    ? `• ${label}: chưa có lần nào ${unit}`
    : `• ${label}: ${tally.scored} lần, đúng ${tally.correct} (${formatRate(tally)})`;
}

const CORRECT_DEFINITION =
  '"Đúng" = sau 3 ngày giá cao hơn lúc có tín hiệu (mua) hoặc thấp hơn (bán).';

/** Reply for "/tinhieu backtest <coin>" (spec EPIC-004-FR10). */
export function formatBacktestReply(symbol: string, result: BacktestResult): string {
  const name = symbol.toUpperCase();
  if (result.insufficient) {
    return [
      `⏳ Chưa đủ lịch sử để backtest ${name}: có ${result.days} ngày, cần ít nhất ${BACKTEST_MIN_DAYS} ngày.`,
      'Thử lại sau, hoặc thử một coin có lịch sử dài hơn.',
    ].join('\n');
  }
  return [
    `📊 Backtest ${name} — ${result.days} ngày gần nhất`,
    formatTallyLine('Cân nhắc mua', result.buy, 'đủ 3 ngày để chấm'),
    formatTallyLine('Cân nhắc bán', result.sell, 'đủ 3 ngày để chấm'),
    CORRECT_DEFINITION,
    'ℹ️ Chỉ là xấp xỉ: backtest dùng giá cuối ngày, không phải giá theo giờ như tín hiệu thật. Các ngày liên tiếp cùng nhận định tính một lần, và chỉ tính tín hiệu đã đủ 3 ngày để chấm.',
    'Kết quả quá khứ không đảm bảo kết quả tương lai.',
    '',
    SIGNAL_DISCLAIMER,
  ].join('\n');
}

/** Reply for "/tinhieu thongke" (spec EPIC-004-FR11). */
export function formatScorecardReply(card: Scorecard, days: number): string {
  const total = card.buy.scored + card.sell.scored + card.pending;
  if (total === 0) {
    return [
      `📭 Chưa có nhận định nào trong ${days} ngày qua để chấm điểm.`,
      'Bảng điểm chỉ tính các nhận định mua/bán mà bot đã gửi cho bạn (tin chủ động, bản tin 9h, /tinhieu).',
    ].join('\n');
  }
  return [
    `🧾 Bảng điểm nhận định (${days} ngày gần nhất)`,
    formatTallyLine('Cân nhắc mua', card.buy, 'được chấm'),
    formatTallyLine('Cân nhắc bán', card.sell, 'được chấm'),
    `• Còn chờ chấm: ${card.pending} (chưa đủ 3 ngày)`,
    CORRECT_DEFINITION,
    '',
    SIGNAL_DISCLAIMER,
  ].join('\n');
}

/** Reply for "/tinhieu tat" / "/tinhieu bat" (spec EPIC-004-FR13). */
export function formatSignalToggleReply(enabled: boolean): string {
  return enabled
    ? '🔔 Đã bật tin tín hiệu chủ động (tối đa 1 tin mỗi giờ). Tắt lại: /tinhieu tat'
    : '🔕 Đã tắt tin tín hiệu chủ động. Phần "Tín hiệu" trong bản tin 9h sáng vẫn còn. Bật lại: /tinhieu bat';
}

const RUN_OUTCOME_HINTS: Record<string, string> = {
  failed: 'lượt gần nhất bị lỗi (thường là nguồn giá hoặc Redis)',
  skipped: 'lượt gần nhất bị bỏ qua vì lượt trước còn giữ lock',
  healthy: 'lượt gần nhất chạy bình thường nhưng đã quá cũ',
};

/** Owner message about the signals check stopping or coming back (spec EPIC-004-NFR07). */
export function formatSignalsMonitorMessage(
  action: SignalsMonitorAction,
  lastRunOutcome: string | null,
): string {
  if (action.kind === 'recovered') {
    return [
      '✅ Tín hiệu: lượt kiểm tra đã chạy lại.',
      `Lượt chạy tốt gần nhất: ${formatIctDateTime(action.recoveredAt)} (ICT). Gián đoạn khoảng ${formatDurationVi(action.downForMs)}.`,
    ].join('\n');
  }
  const hint = lastRunOutcome
    ? (RUN_OUTCOME_HINTS[lastRunOutcome] ?? `lượt gần nhất: ${lastRunOutcome}`)
    : 'không có lượt nào được ghi gần đây (job cron-job.org có thể đã dừng hoặc sai secret)';
  return [
    action.kind === 'down'
      ? '⚠️ Tín hiệu: lượt kiểm tra ngừng chạy.'
      : '⚠️ Tín hiệu: lượt kiểm tra vẫn chưa chạy lại.',
    `Không có lượt chạy tốt nào từ ${formatIctDateTime(action.lastHealthyAt)} (ICT), đã ${formatDurationVi(action.silentForMs)}.`,
    `Gợi ý: ${hint}. Xem job /cron/signals trên cron-job.org và log trên Vercel.`,
  ].join('\n');
}

/** Reply for "/tinhieu ..." with arguments that match no valid syntax. */
export function formatSignalInvalidReply(): string {
  return [
    '❓ Cú pháp /tinhieu chưa đúng.',
    SIGNAL_SYNTAX_EXAMPLE,
    'Mã coin chỉ gồm chữ và số. Lưu ý: "bat"/"tat" là công tắc bật/tắt tin chủ động.',
  ].join('\n');
}
