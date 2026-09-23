import { AlertDirection, PriceAlert } from './interfaces/price-alert.interface';
import { ALERT_COOLDOWN_MS, REARM_BUFFER_RATIO } from './price-alerts.constants';

export type AlertAction = 'fire' | 'rearm' | 'none';

/** True when `priceUsd` satisfies the alert condition: `>=` for "above", `<=` for "below". */
export function isConditionMet(
  direction: AlertDirection,
  threshold: number,
  priceUsd: number,
): boolean {
  return direction === 'above' ? priceUsd >= threshold : priceUsd <= threshold;
}

/**
 * Decides what one check should do with one alert, given the current price.
 * Pure — no I/O — so the fire / re-arm / cooldown rules (spec EPIC-002-FR05
 * to FR07) are unit-testable on their own:
 *
 * - `armed` + condition met + outside the cooldown -> `fire`
 * - `fired` + price back past the threshold by REARM_BUFFER_RATIO -> `rearm`
 *   (silently — no message)
 * - anything else -> `none`
 */
export function evaluateAlert(alert: PriceAlert, priceUsd: number, now: Date): AlertAction {
  if (alert.state === 'armed') {
    if (!isConditionMet(alert.direction, alert.threshold, priceUsd)) {
      return 'none';
    }
    const lastFiredMs = alert.lastFiredAt ? Date.parse(alert.lastFiredAt) : null;
    if (lastFiredMs !== null && now.getTime() - lastFiredMs < ALERT_COOLDOWN_MS) {
      return 'none';
    }
    return 'fire';
  }

  const rearmed =
    alert.direction === 'above'
      ? priceUsd <= alert.threshold * (1 - REARM_BUFFER_RATIO)
      : priceUsd >= alert.threshold * (1 + REARM_BUFFER_RATIO);
  return rearmed ? 'rearm' : 'none';
}
