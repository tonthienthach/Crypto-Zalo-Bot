import { CoinSignal, SignalResult } from '../signals/interfaces/signal.interface';
import { formatDailyDigestReply, formatHelpReply } from './format-message.util';
import {
  SIGNAL_DISCLAIMER,
  formatBacktestReply,
  formatScorecardReply,
  formatSignalAlertMessage,
  formatSignalDigestSection,
  formatSignalDigestUnavailableSection,
  formatSignalInvalidReply,
  formatSignalNoWatchlistReply,
  formatSignalReply,
  formatSignalToggleReply,
} from './format-signals.util';

function result(overrides: Partial<SignalResult> = {}): SignalResult {
  return {
    insufficientData: false,
    change24hPct: -16,
    change72hPct: -11.1,
    strong: true,
    direction: 'down',
    movePct: -16,
    window: '24h',
    rangeLow: 80_000,
    rangeHigh: 120_000,
    positionPct: 10,
    verdict: 'buy',
    priceUsd: 84_000,
    ...overrides,
  };
}

const btcBuy: CoinSignal = { symbol: 'btc', result: result() };
const ethMild: CoinSignal = {
  symbol: 'eth',
  result: result({
    strong: false,
    verdict: null,
    direction: null,
    movePct: null,
    window: null,
    change24hPct: 3,
    change72hPct: 5,
    priceUsd: 2_500,
  }),
};
const solThin: CoinSignal = {
  symbol: 'sol',
  result: result({ insufficientData: true, strong: false, verdict: null }),
};

describe('formatSignalAlertMessage', () => {
  it('has the coin, verdict, reason numbers, disclaimer and the off switch (AC04)', () => {
    const text = formatSignalAlertMessage([btcBuy]);
    expect(text).toContain('BTC');
    expect(text).toContain('Cân nhắc mua');
    expect(text).toContain('-16.0% trong 24 giờ');
    expect(text).toContain('$84,000.00');
    expect(text).toContain('10%');
    expect(text).toContain('$80,000.00–$120,000.00');
    expect(text).toContain(SIGNAL_DISCLAIMER);
    expect(text).toContain('/tinhieu tat');
  });

  it('puts several coins in one message (AC06)', () => {
    const sell: CoinSignal = {
      symbol: 'sol',
      result: result({ verdict: 'sell', direction: 'up', movePct: 20, positionPct: 92 }),
    };
    const text = formatSignalAlertMessage([btcBuy, sell]);
    expect(text).toContain('BTC');
    expect(text).toContain('SOL');
    expect(text).toContain('Cân nhắc bán / chốt lời');
  });

  it('labels a middle-of-range swing as "Theo dõi"', () => {
    const watch: CoinSignal = {
      symbol: 'btc',
      result: result({ verdict: 'watch', positionPct: 50 }),
    };
    expect(formatSignalAlertMessage([watch])).toContain('Theo dõi');
  });
});

describe('formatSignalDigestSection', () => {
  it('lists strong coins with the disclaimer (AC08)', () => {
    const text = formatSignalDigestSection([btcBuy, ethMild]);
    expect(text).toContain('BTC');
    expect(text).not.toContain('ETH');
    expect(text).toContain(SIGNAL_DISCLAIMER);
  });

  it('says so in one line when nothing swings strongly (AC08)', () => {
    const text = formatSignalDigestSection([ethMild]);
    expect(text).toBe('📡 Tín hiệu: Không có coin nào dao động mạnh.');
  });

  it('notes coins without enough history', () => {
    expect(formatSignalDigestSection([ethMild, solThin])).toContain(
      'Chưa đủ dữ liệu (cần 7 ngày): SOL',
    );
  });

  it('has an unavailable line', () => {
    expect(formatSignalDigestUnavailableSection()).toContain('tạm thời không có số liệu');
  });

  it('sits between the prices and the portfolio in the digest', () => {
    const digest = formatDailyDigestReply([], 25_000, undefined, 'PORTFOLIO', 'SIGNALS');
    expect(digest.indexOf('SIGNALS')).toBeGreaterThan(-1);
    expect(digest.indexOf('SIGNALS')).toBeLessThan(digest.indexOf('PORTFOLIO'));
  });
});

describe('formatSignalReply', () => {
  it('shows the 24h/72h change, position, verdict and reason for a strong coin (AC10)', () => {
    const text = formatSignalReply([btcBuy]);
    expect(text).toContain('-16.0% (24h)');
    expect(text).toContain('-11.1% (72h)');
    expect(text).toContain('Cân nhắc mua');
    expect(text).toContain('Lý do');
    expect(text).toContain(SIGNAL_DISCLAIMER);
  });

  it('says a mild coin has no verdict and adds no disclaimer (AC03)', () => {
    const text = formatSignalReply([ethMild]);
    expect(text).toContain('không dao động mạnh, không có nhận định');
    expect(text).not.toMatch(/Cân nhắc/);
    expect(text).not.toContain(SIGNAL_DISCLAIMER);
  });

  it('says "chưa đủ dữ liệu" without a verdict (AC11)', () => {
    const text = formatSignalReply([solThin]);
    expect(text).toContain('chưa đủ dữ liệu');
    expect(text).not.toMatch(/Cân nhắc/);
  });
});

describe('formatBacktestReply', () => {
  it('reports days, counts and rates, the approximation note and the disclaimer (AC12)', () => {
    const text = formatBacktestReply('btc', {
      insufficient: false,
      days: 90,
      buy: { scored: 6, correct: 4 },
      sell: { scored: 5, correct: 2 },
    });
    expect(text).toContain('BTC — 90 ngày');
    expect(text).toContain('6 lần, đúng 4 (66.7%)');
    expect(text).toContain('5 lần, đúng 2 (40.0%)');
    expect(text).toContain('xấp xỉ');
    expect(text).toContain(SIGNAL_DISCLAIMER);
  });

  it('refuses a short history and explains (AC12)', () => {
    const text = formatBacktestReply('btc', {
      insufficient: true,
      days: 9,
      buy: { scored: 0, correct: 0 },
      sell: { scored: 0, correct: 0 },
    });
    expect(text).toContain('có 9 ngày, cần ít nhất 14 ngày');
  });

  it('does not divide by zero when a verdict never appeared', () => {
    const text = formatBacktestReply('btc', {
      insufficient: false,
      days: 30,
      buy: { scored: 0, correct: 0 },
      sell: { scored: 1, correct: 1 },
    });
    expect(text).toContain('chưa có lần nào');
    expect(text).not.toContain('NaN');
  });
});

describe('formatScorecardReply', () => {
  it('reports scored, correct and pending (AC13)', () => {
    const text = formatScorecardReply(
      { buy: { scored: 3, correct: 2 }, sell: { scored: 1, correct: 0 }, pending: 2 },
      30,
    );
    expect(text).toContain('30 ngày gần nhất');
    expect(text).toContain('3 lần, đúng 2 (66.7%)');
    expect(text).toContain('1 lần, đúng 0 (0.0%)');
    expect(text).toContain('Còn chờ chấm: 2');
  });

  it('explains an empty scorecard', () => {
    const text = formatScorecardReply(
      { buy: { scored: 0, correct: 0 }, sell: { scored: 0, correct: 0 }, pending: 0 },
      30,
    );
    expect(text).toContain('Chưa có nhận định nào');
  });
});

describe('other replies', () => {
  it('confirms the new state on /tinhieu tat and bat (AC14)', () => {
    expect(formatSignalToggleReply(false)).toContain('Đã tắt');
    expect(formatSignalToggleReply(false)).toContain('bản tin 9h');
    expect(formatSignalToggleReply(true)).toContain('Đã bật');
  });

  it('points a chat with no watchlist to /dangky and /tinhieu <coin>', () => {
    const text = formatSignalNoWatchlistReply();
    expect(text).toContain('/dangky');
    expect(text).toContain('/tinhieu btc');
  });

  it('shows the syntax on invalid input', () => {
    expect(formatSignalInvalidReply()).toContain('/tinhieu backtest btc');
  });

  it('lists /tinhieu in /help (AC18)', () => {
    const help = formatHelpReply();
    expect(help).toContain('/tinhieu');
    expect(help).toContain('/tinhieu backtest');
    expect(help).toContain('/tinhieu thongke');
    expect(help).toContain('/tinhieu tat');
  });
});
