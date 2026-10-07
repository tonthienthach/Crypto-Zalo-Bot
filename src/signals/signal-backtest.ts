import {
  BacktestResult,
  PricePoint,
  Scorecard,
  SignalRecord,
  SignalThresholds,
  VerdictTally,
} from './interfaces/signal.interface';
import { DEFAULT_THRESHOLDS, evaluateSignal } from './signal-evaluator';
import { BACKTEST_MIN_DAYS, DAY_MS, HORIZON_MS } from './signals.constants';

const HORIZON_DAYS = HORIZON_MS / DAY_MS;

function emptyTally(): VerdictTally {
  return { scored: 0, correct: 0 };
}

function isCorrect(verdict: 'buy' | 'sell', priceThen: number, priceLater: number): boolean {
  return verdict === 'buy' ? priceLater > priceThen : priceLater < priceThen;
}

/**
 * Replays the verdict rules over end-of-day prices (spec EPIC-004-FR10).
 * `dailyCloses` is oldest first, one price per day. Days are laid on an
 * exact 24h grid so the same `evaluateSignal` rules apply with daily
 * instead of hourly references — an approximation, and the reply says so.
 *
 * Consecutive days with the same buy/sell verdict count once, on the first
 * day (one swing would otherwise be counted on every day it persists; spec
 * FR06). A signal is scored by the close HORIZON_DAYS later; signals without
 * that many days after them are left out.
 */
export function runBacktest(
  dailyCloses: number[],
  thresholds: SignalThresholds = DEFAULT_THRESHOLDS,
): BacktestResult {
  const result: BacktestResult = {
    insufficient: dailyCloses.length < BACKTEST_MIN_DAYS,
    days: dailyCloses.length,
    buy: emptyTally(),
    sell: emptyTally(),
  };
  if (result.insufficient) return result;

  const points: PricePoint[] = dailyCloses.map((p, index) => ({ t: index * DAY_MS, p }));
  let previous: 'buy' | 'sell' | null = null;
  for (let i = 0; i < dailyCloses.length; i++) {
    const { verdict } = evaluateSignal(
      points.slice(0, i + 1),
      dailyCloses[i],
      points[i].t,
      thresholds,
    );
    const current = verdict === 'buy' || verdict === 'sell' ? verdict : null;
    const startsRun = current !== null && current !== previous;
    previous = current;
    if (current === null || !startsRun) continue;
    if (i + HORIZON_DAYS > dailyCloses.length - 1) continue;

    result[current].scored += 1;
    if (isCorrect(current, dailyCloses[i], dailyCloses[i + HORIZON_DAYS]))
      result[current].correct += 1;
  }
  return result;
}

/**
 * Scores verdicts that were actually sent (spec EPIC-004-FR11): the price is
 * the first stored point at or after `at + HORIZON_MS`. A record is pending
 * until that time has passed and a later point exists. The same coin and
 * verdict on the same UTC day counts once.
 */
export function scoreRecords(
  records: SignalRecord[],
  history: Record<string, PricePoint[]>,
  now: number,
): Scorecard {
  const card: Scorecard = { buy: emptyTally(), sell: emptyTally(), pending: 0 };
  const seen = new Set<string>();
  for (const record of records) {
    const day = new Date(record.at).toISOString().slice(0, 10);
    const key = `${record.symbol}:${record.verdict}:${day}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const due = record.at + HORIZON_MS;
    const later =
      now >= due ? (history[record.symbol] ?? []).find((point) => point.t >= due) : undefined;
    if (!later) {
      card.pending += 1;
      continue;
    }
    const tally = card[record.verdict];
    tally.scored += 1;
    if (isCorrect(record.verdict, record.priceUsd, later.p)) tally.correct += 1;
  }
  return card;
}
