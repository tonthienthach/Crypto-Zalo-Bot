import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoingeckoService } from '../coingecko/coingecko.service';
import { PriceAlertsCronSecretGuard } from '../common/guards/price-alerts-cron-secret.guard';
import { formatAlertTriggeredMessage } from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { AlertRunSummary, PriceAlert, RunOutcome } from './interfaces/price-alert.interface';
import { evaluateAlert } from './price-alert-evaluator';
import { RUN_SEND_BUDGET_MS, WATCHDOG_CHECK_EVERY_MINUTES } from './price-alerts.constants';
import { PriceAlertsMonitorService } from './price-alerts-monitor.service';
import { PriceAlertsService } from './price-alerts.service';

/**
 * Machine-triggered endpoint for the price-alert check. Has no scheduler of
 * its own: Vercel Cron on the Hobby plan only runs daily, so an external
 * scheduler (cron-job.org, see docs/DEPLOYMENT.md) calls this once a minute,
 * authenticated like /cron/daily-digest but with its own secret
 * (PriceAlertsCronSecretGuard / PRICE_ALERTS_CRON_SECRET).
 */
@Controller('cron')
export class PriceAlertsController {
  private readonly logger = new Logger(PriceAlertsController.name);
  private readonly usdToVndRate: number;

  constructor(
    private readonly priceAlertsService: PriceAlertsService,
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
    private readonly monitorService: PriceAlertsMonitorService,
  ) {
    this.usdToVndRate = this.configService.get<number>('currency.usdToVndRate')!;
  }

  @All('price-alerts')
  @UseGuards(PriceAlertsCronSecretGuard)
  @HttpCode(HttpStatus.OK)
  async checkPriceAlerts(): Promise<{ ok: true }> {
    const startedAt = new Date();
    let lockToken: string | null = null;

    // Every call that gets past the guard is logged with its outcome — skipped
    // and failed runs too — so a gap in healthy runs can be explained later
    // (spec EPIC-002-FIX-FR02). Only the lock-holding run touches alerts.
    let summary: AlertRunSummary;
    try {
      lockToken = await this.priceAlertsService.acquireRunLock();
      if (!lockToken) {
        this.logger.warn('Price-alert check skipped: a previous run still holds the lock');
        summary = emptyRunSummary(startedAt, 'skipped');
      } else {
        summary = await this.runCheck(startedAt);
      }
    } catch (error) {
      this.logger.error(
        `Price-alert check failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      summary = emptyRunSummary(startedAt, 'failed');
    } finally {
      if (lockToken) {
        await this.priceAlertsService.releaseRunLock(lockToken).catch((error: unknown) => {
          this.logger.error(`Failed to release price-alert run lock: ${String(error)}`);
        });
      }
    }

    this.logger.log(JSON.stringify({ event: 'price-alert-run', ...summary }));
    await this.recordRunSafely(summary);
    if (summary.outcome !== 'skipped' && isWatchdogMinute(startedAt)) {
      await this.checkWatcherSafely();
    }

    // Always 200, like /cron/daily-digest: a CoinGecko/Zalo/Redis outage is
    // logged above, and the scheduler shouldn't retry-storm on it.
    return { ok: true };
  }

  /**
   * Best-effort: a failed run-log write loses that log line, never the run
   * (spec EPIC-002-FIX-NFR09). The alerts were already processed by now.
   */
  private async recordRunSafely(summary: AlertRunSummary): Promise<void> {
    try {
      await this.priceAlertsService.recordRun(summary);
    } catch (error) {
      this.logger.error(
        `Failed to record price-alert run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Watches the watcher (spec EPIC-002-FIX-FR07), after the lock is released
   * so it never lengthens a run's hold on it. Best-effort, like the run log.
   */
  private async checkWatcherSafely(): Promise<void> {
    try {
      await this.monitorService.checkWatcher();
    } catch (error) {
      this.logger.error(
        `Price-alert watchdog check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runCheck(startedAt: Date): Promise<AlertRunSummary> {
    const summary = emptyRunSummary(startedAt, 'healthy');

    const alerts = await this.priceAlertsService.listAll();
    const prices = alerts.length > 0 ? await this.loadPrices(alerts) : new Map<string, number>();
    // A run that watches alerts but priced none of them isn't watching
    // anything (spec EPIC-002-FIX-FR01). With no alerts, there is nothing to price.
    if (alerts.length > 0 && prices.size === 0) {
      summary.outcome = 'no-price';
    }
    // The send budget starts after the price lookup, so a slow price source
    // delays this run instead of deferring every due alert on every run.
    const sendsStartedAt = Date.now();

    // Sequential, not Promise.all, and each alert in its own try/catch: one
    // failed send or bad row never blocks the rest of the run (spec NFR07).
    const unpriced = new Set<string>();
    for (const alert of alerts) {
      const priceUsd = prices.get(alert.symbol);
      if (priceUsd === undefined) {
        unpriced.add(alert.symbol);
        continue;
      }
      summary.evaluated++;
      try {
        await this.processAlert(alert, priceUsd, startedAt, sendsStartedAt, summary);
      } catch (error) {
        summary.failed++;
        this.logger.error(
          `Price alert ${alert.id} for ${alert.chatId} failed: ${
            error instanceof Error ? error.stack : String(error)
          }`,
        );
      }
    }

    if (unpriced.size > 0 && prices.size > 0) {
      // Only when the lookup itself worked — a failed lookup is logged in loadPrices.
      this.logger.warn(`No price this run for alert symbols: ${[...unpriced].join(', ')}`);
    }

    summary.durationMs = Date.now() - startedAt.getTime();
    return summary;
  }

  /**
   * One price lookup for every distinct coin across all alerts, however many
   * alerts there are (spec NFR03). If the price source is down, returns no
   * prices: nothing fires and no state changes this run (spec AC12).
   *
   * Keyed by each alert's own symbol. Two symbols can share one CoinGecko id
   * (e.g. "matic" and "pol"), and the lookup then returns that coin under
   * only one of them, so symbols are also matched through their resolved id.
   */
  private async loadPrices(alerts: PriceAlert[]): Promise<Map<string, number>> {
    const symbols = Array.from(new Set(alerts.map((alert) => alert.symbol)));
    try {
      const coins = await this.coingeckoService.getPricesBySymbols(symbols);
      const bySymbol = new Map(coins.map((coin) => [coin.symbol, coin.priceUsd]));
      const byId = new Map(coins.map((coin) => [coin.id, coin.priceUsd]));
      const prices = new Map<string, number>();
      for (const symbol of symbols) {
        const price =
          bySymbol.get(symbol) ?? byId.get(this.coingeckoService.resolveSymbolToId(symbol));
        if (price !== undefined) {
          prices.set(symbol, price);
        }
      }
      return prices;
    } catch (error) {
      this.logger.error(
        `Price lookup failed for alert check, skipping this run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  private async processAlert(
    alert: PriceAlert,
    priceUsd: number,
    now: Date,
    sendsStartedAt: number,
    summary: AlertRunSummary,
  ): Promise<void> {
    const action = evaluateAlert(alert, priceUsd, now);

    if (action === 'rearm') {
      await this.priceAlertsService.updateState({ ...alert, state: 'armed' });
      summary.rearmed++;
      return;
    }
    if (action !== 'fire') {
      return;
    }
    if (Date.now() - sendsStartedAt > RUN_SEND_BUDGET_MS) {
      // Out of send budget (spec NFR02): stays armed, the next run sends it.
      summary.deferred++;
      return;
    }

    const delivered = await this.zaloService.sendTextMessage(
      alert.chatId,
      formatAlertTriggeredMessage(alert, priceUsd, this.usdToVndRate),
    );
    // Persist the outcome before the delivery log: if logging fails, we lose
    // a log line rather than leaving a delivered alert armed to fire twice.
    // A failed send stays armed and is retried next run (spec AC13); only
    // repeated failures back off (see ALERT_FAILURES_BEFORE_BACKOFF).
    await this.priceAlertsService.updateState(
      delivered
        ? {
            ...alert,
            state: 'fired',
            lastFiredAt: now.toISOString(),
            lastFailedAt: null,
            consecutiveFailures: 0,
          }
        : {
            ...alert,
            lastFailedAt: now.toISOString(),
            consecutiveFailures: (alert.consecutiveFailures ?? 0) + 1,
          },
    );
    await this.priceAlertsService.recordDelivery({
      alertId: alert.id,
      chatId: alert.chatId,
      symbol: alert.symbol,
      direction: alert.direction,
      threshold: alert.threshold,
      priceUsd,
      delivered,
      attemptedAt: now.toISOString(),
    });

    if (!delivered) {
      summary.failed++;
      return;
    }
    summary.fired++;
  }
}

function emptyRunSummary(startedAt: Date, outcome: RunOutcome): AlertRunSummary {
  return {
    startedAt: startedAt.toISOString(),
    outcome,
    evaluated: 0,
    fired: 0,
    failed: 0,
    rearmed: 0,
    deferred: 0,
    durationMs: Date.now() - startedAt.getTime(),
    driftMs: signedMinuteDrift(startedAt),
  };
}

/**
 * Every WATCHDOG_CHECK_EVERY_MINUTES-th minute, by the nearest minute so a
 * run a few seconds early or late still lands on its slot.
 */
function isWatchdogMinute(at: Date): boolean {
  return Math.round(at.getTime() / 60_000) % WATCHDOG_CHECK_EVERY_MINUTES === 0;
}

/** Signed ms from the nearest minute boundary: 100ms early -> -100, not +59,900. */
function signedMinuteDrift(at: Date): number {
  const pastMinute = at.getTime() % 60_000;
  return pastMinute > 30_000 ? pastMinute - 60_000 : pastMinute;
}
