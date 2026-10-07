import {
  BAND_PCT,
  COMPARE_EPSILON,
  DAY_MS,
  MIN_HISTORY_DAYS,
  RANGE_DAYS,
  REFERENCE_TOLERANCE_MS,
  SWING_24H_PCT,
  SWING_72H_PCT,
  HOUR_MS,
} from './signals.constants';
import { PricePoint, SignalResult, SignalThresholds, Verdict } from './interfaces/signal.interface';

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  swing24hPct: SWING_24H_PCT,
  swing72hPct: SWING_72H_PCT,
  bandPct: BAND_PCT,
};

/** Price of the stored point closest to `targetMs`, or null when none is within the tolerance. */
function priceNear(points: PricePoint[], targetMs: number): number | null {
  let best: PricePoint | null = null;
  for (const point of points) {
    const gap = Math.abs(point.t - targetMs);
    if (gap > REFERENCE_TOLERANCE_MS) continue;
    if (best === null || gap < Math.abs(best.t - targetMs)) best = point;
  }
  return best === null ? null : best.p;
}

function changePct(from: number | null, to: number): number | null {
  if (from === null || from <= 0) return null;
  return ((to - from) / from) * 100;
}

function exceeds(change: number | null, threshold: number): boolean {
  return change !== null && Math.abs(change) >= threshold - COMPARE_EPSILON;
}

/**
 * Decides whether a coin is swinging strongly and, if so, what to say about
 * it. Pure — no I/O — so the rules (spec EPIC-004-FR01, FR02) are
 * unit-testable on their own, and the 9h digest, `/tinhieu` and the
 * periodic check all share one definition of "strong swing".
 *
 * - strong: |change vs 24h ago| >= swing24hPct or |change vs 72h ago| >= swing72hPct
 * - verdict (strong only): bottom `bandPct` of the 7-day range -> buy,
 *   top `bandPct` -> sell, anywhere else -> watch
 * - history shorter than MIN_HISTORY_DAYS -> `insufficientData`, no verdict
 */
export function evaluateSignal(
  points: PricePoint[],
  nowPrice: number,
  now: number,
  thresholds: SignalThresholds = DEFAULT_THRESHOLDS,
): SignalResult {
  const empty: SignalResult = {
    insufficientData: true,
    change24hPct: null,
    change72hPct: null,
    strong: false,
    direction: null,
    movePct: null,
    window: null,
    rangeLow: null,
    rangeHigh: null,
    positionPct: null,
    verdict: null,
    priceUsd: nowPrice,
  };

  // A price of 0 (a dead coin, a bad feed) would read as a -100% swing and a "buy".
  if (!Number.isFinite(nowPrice) || nowPrice <= 0) return empty;

  const oldest = points.reduce((min, point) => Math.min(min, point.t), Number.POSITIVE_INFINITY);
  const covered = oldest <= now - MIN_HISTORY_DAYS * DAY_MS + REFERENCE_TOLERANCE_MS;
  const change24hPct = changePct(priceNear(points, now - 24 * HOUR_MS), nowPrice);
  const change72hPct = changePct(priceNear(points, now - 72 * HOUR_MS), nowPrice);
  if (!covered || (change24hPct === null && change72hPct === null)) {
    return { ...empty, change24hPct, change72hPct };
  }

  const strong24h = exceeds(change24hPct, thresholds.swing24hPct);
  const strong72h = exceeds(change72hPct, thresholds.swing72hPct);
  const strong = strong24h || strong72h;

  const rangeStart = now - RANGE_DAYS * DAY_MS;
  const rangePrices = points
    .filter((point) => point.t >= rangeStart)
    .map((point) => point.p)
    .concat(nowPrice);
  const rangeLow = Math.min(...rangePrices);
  const rangeHigh = Math.max(...rangePrices);
  const positionPct =
    rangeHigh > rangeLow ? ((nowPrice - rangeLow) / (rangeHigh - rangeLow)) * 100 : 50;

  let window: SignalResult['window'] = null;
  let movePct: number | null = null;
  if (strong) {
    const use24h =
      strong24h &&
      (!strong72h || Math.abs(change24hPct as number) >= Math.abs(change72hPct as number));
    window = use24h ? '24h' : '72h';
    movePct = use24h ? (change24hPct as number) : (change72hPct as number);
  }

  let verdict: Verdict | null = null;
  if (strong) {
    if (positionPct <= thresholds.bandPct + COMPARE_EPSILON) verdict = 'buy';
    else if (positionPct >= 100 - thresholds.bandPct - COMPARE_EPSILON) verdict = 'sell';
    else verdict = 'watch';
  }

  return {
    insufficientData: false,
    change24hPct,
    change72hPct,
    strong,
    direction: movePct === null ? null : movePct >= 0 ? 'up' : 'down',
    movePct,
    window,
    rangeLow,
    rangeHigh,
    positionPct,
    verdict,
    priceUsd: nowPrice,
  };
}
