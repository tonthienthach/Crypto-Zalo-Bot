import { ChatSignalState, CoinSignal } from './interfaces/signal.interface';
import {
  COMPARE_EPSILON,
  REPEAT_EXTRA_PP,
  REPEAT_WINDOW_MS,
  SEND_BACKOFF_MS,
  SEND_COOLDOWN_MS,
  SEND_FAILURES_BEFORE_BACKOFF,
} from './signals.constants';

function isStrong(signal: CoinSignal): boolean {
  return signal.result.strong && !signal.result.insufficientData && signal.result.movePct !== null;
}

/**
 * Picks the coins a chat should be told about in this run. Pure — no I/O —
 * so the rate-limit and no-repeat rules (spec EPIC-004-FR05, FR06) are
 * unit-testable on their own:
 *
 * - the chat got a signal message less than SEND_COOLDOWN_MS ago -> nothing
 *   (held signals simply come back on the next run once the hour is up)
 * - a coin not reported yet, or last reported REPEAT_WINDOW_MS or more ago -> report
 * - reported within the window: report only if the direction flipped, or the
 *   move grew by at least REPEAT_EXTRA_PP points over the last report
 */
export function selectCoinsToAlert(
  signals: CoinSignal[],
  state: ChatSignalState,
  now: number,
): CoinSignal[] {
  if (state.lastSentAt !== null && now - state.lastSentAt < SEND_COOLDOWN_MS) return [];

  return signals.filter((signal) => {
    if (!isStrong(signal)) return false;
    const previous = state.coins[signal.symbol];
    if (!previous || now - previous.sentAt >= REPEAT_WINDOW_MS) return true;
    if (previous.direction !== signal.result.direction) return true;
    return (
      Math.abs(signal.result.movePct as number) >=
      Math.abs(previous.movePct) + REPEAT_EXTRA_PP - COMPARE_EPSILON
    );
  });
}

/**
 * True for a chat whose last SEND_FAILURES_BEFORE_BACKOFF sends were all
 * refused (it blocked the bot, or no longer exists): it is tried only once
 * per SEND_BACKOFF_MS instead of on every 30-minute run.
 */
export function isBackedOff(state: ChatSignalState, now: number): boolean {
  return (
    (state.failures ?? 0) >= SEND_FAILURES_BEFORE_BACKOFF &&
    state.failedAt != null &&
    now - state.failedAt < SEND_BACKOFF_MS
  );
}

/** State after a refused send: the streak grows; what the chat was told is unchanged. */
export function recordFailed(state: ChatSignalState, now: number): ChatSignalState {
  return { ...state, failures: (state.failures ?? 0) + 1, failedAt: now };
}

/** State after `sent` went out at `now`; entries past the repeat window are dropped. */
export function recordSent(
  state: ChatSignalState,
  sent: CoinSignal[],
  now: number,
): ChatSignalState {
  const coins: ChatSignalState['coins'] = {};
  for (const [symbol, entry] of Object.entries(state.coins)) {
    if (now - entry.sentAt < REPEAT_WINDOW_MS) coins[symbol] = entry;
  }
  for (const signal of sent) {
    coins[signal.symbol] = {
      sentAt: now,
      direction: signal.result.direction!,
      movePct: signal.result.movePct!,
    };
  }
  return { lastSentAt: now, coins };
}
