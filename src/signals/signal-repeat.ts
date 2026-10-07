import { ChatSignalState, CoinSignal } from './interfaces/signal.interface';
import {
  COMPARE_EPSILON,
  REPEAT_EXTRA_PP,
  REPEAT_WINDOW_MS,
  SEND_COOLDOWN_MS,
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
