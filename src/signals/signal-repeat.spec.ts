import { recordSent, selectCoinsToAlert } from './signal-repeat';
import { ChatSignalState, CoinSignal, SignalResult } from './interfaces/signal.interface';
import { HOUR_MS } from './signals.constants';

const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);
const MIN = 60_000;

function strong(symbol: string, movePct: number): CoinSignal {
  const result: SignalResult = {
    insufficientData: false,
    change24hPct: movePct,
    change72hPct: movePct,
    strong: true,
    direction: movePct >= 0 ? 'up' : 'down',
    movePct,
    window: '24h',
    rangeLow: 1,
    rangeHigh: 2,
    positionPct: 10,
    verdict: 'buy',
    priceUsd: 1,
  };
  return { symbol, result };
}

const fresh = (): ChatSignalState => ({ lastSentAt: null, coins: {} });
const symbols = (signals: CoinSignal[]) => signals.map((s) => s.symbol);

describe('selectCoinsToAlert', () => {
  it('reports a coin never reported before', () => {
    expect(symbols(selectCoinsToAlert([strong('btc', -16)], fresh(), T0))).toEqual(['btc']);
  });

  it('skips signals that are not strong or lack data', () => {
    const mild = strong('eth', 3);
    mild.result.strong = false;
    const thin = strong('sol', 20);
    thin.result.insufficientData = true;
    expect(selectCoinsToAlert([mild, thin], fresh(), T0)).toEqual([]);
  });

  it('holds everything for an hour after a message, then lets a new coin through (AC05)', () => {
    const state = recordSent(fresh(), [strong('btc', -16)], T0);
    const eth = [strong('eth', 9)];
    expect(selectCoinsToAlert(eth, state, T0 + 20 * MIN)).toEqual([]);
    expect(selectCoinsToAlert(eth, state, T0 + 50 * MIN)).toEqual([]);
    expect(symbols(selectCoinsToAlert(eth, state, T0 + HOUR_MS))).toEqual(['eth']);
  });

  describe('no repeat within 24h (AC07)', () => {
    const state = recordSent(fresh(), [strong('btc', -16)], T0);
    const later = T0 + 5 * HOUR_MS;

    it('does not report the same direction at -18%', () => {
      expect(selectCoinsToAlert([strong('btc', -18)], state, later)).toEqual([]);
    });

    it('reports again at -21% (5 points more)', () => {
      expect(symbols(selectCoinsToAlert([strong('btc', -21)], state, later))).toEqual(['btc']);
    });

    it('reports a direction flip at once', () => {
      expect(symbols(selectCoinsToAlert([strong('btc', 9)], state, later))).toEqual(['btc']);
    });

    it('reports again after 24h at a similar level', () => {
      expect(symbols(selectCoinsToAlert([strong('btc', -17)], state, T0 + 24 * HOUR_MS))).toEqual([
        'btc',
      ]);
    });
  });

  it('returns several coins together (AC06)', () => {
    const picked = selectCoinsToAlert(
      [strong('btc', -16), strong('eth', -12), strong('sol', 20)],
      fresh(),
      T0,
    );
    expect(symbols(picked)).toEqual(['btc', 'eth', 'sol']);
  });
});

describe('recordSent', () => {
  it('stores the send time and what was said, and drops entries older than 24h', () => {
    const old: ChatSignalState = {
      lastSentAt: T0 - 30 * HOUR_MS,
      coins: { doge: { sentAt: T0 - 30 * HOUR_MS, direction: 'up', movePct: 10 } },
    };
    const next = recordSent(old, [strong('btc', -16)], T0);
    expect(next.lastSentAt).toBe(T0);
    expect(next.coins).toEqual({ btc: { sentAt: T0, direction: 'down', movePct: -16 } });
  });
});
