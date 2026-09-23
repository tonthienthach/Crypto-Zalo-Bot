import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoingeckoService } from '../coingecko/coingecko.service';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { formatAlertTriggeredMessage } from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { AlertRunSummary, PriceAlert } from './interfaces/price-alert.interface';
import { evaluateAlert } from './price-alert-evaluator';
import { PriceAlertsService } from './price-alerts.service';

/**
 * Machine-triggered endpoint for the price-alert check. Has no scheduler of
 * its own: Vercel Cron on the Hobby plan only runs daily, so an external
 * scheduler (cron-job.org, see docs/DEPLOYMENT.md) calls this once a minute,
 * authenticated via CronSecretGuard exactly like /cron/daily-digest.
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
  ) {
    this.usdToVndRate = this.configService.get<number>('currency.usdToVndRate')!;
  }

  @All('price-alerts')
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  async checkPriceAlerts(): Promise<{ ok: true }> {
    const startedAt = new Date();
    let locked = false;

    try {
      locked = await this.priceAlertsService.acquireRunLock();
      if (!locked) {
        this.logger.warn('Price-alert check skipped: a previous run still holds the lock');
        return { ok: true };
      }

      const summary = await this.runCheck(startedAt);
      this.logger.log(JSON.stringify({ event: 'price-alert-run', ...summary }));
      await this.priceAlertsService.recordRun(summary);
    } catch (error) {
      this.logger.error(
        `Price-alert check failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    } finally {
      if (locked) {
        await this.priceAlertsService.releaseRunLock().catch((error: unknown) => {
          this.logger.error(`Failed to release price-alert run lock: ${String(error)}`);
        });
      }
    }

    // Always 200, like /cron/daily-digest: a CoinGecko/Zalo/Redis outage is
    // logged above, and the scheduler shouldn't retry-storm on it.
    return { ok: true };
  }

  private async runCheck(startedAt: Date): Promise<AlertRunSummary> {
    const summary: AlertRunSummary = {
      startedAt: startedAt.toISOString(),
      evaluated: 0,
      fired: 0,
      failed: 0,
      rearmed: 0,
      durationMs: 0,
      // How far past the minute boundary the scheduler actually called us.
      driftMs: startedAt.getTime() % 60_000,
    };

    const alerts = await this.priceAlertsService.listAll();
    const prices = alerts.length > 0 ? await this.loadPrices(alerts) : new Map<string, number>();

    // Sequential, not Promise.all, and each alert in its own try/catch: one
    // failed send or bad row never blocks the rest of the run (spec NFR07).
    for (const alert of alerts) {
      const priceUsd = prices.get(alert.symbol);
      if (priceUsd === undefined) {
        continue;
      }
      summary.evaluated++;
      try {
        await this.processAlert(alert, priceUsd, startedAt, summary);
      } catch (error) {
        summary.failed++;
        this.logger.error(
          `Price alert ${alert.id} for ${alert.chatId} failed: ${
            error instanceof Error ? error.stack : String(error)
          }`,
        );
      }
    }

    summary.durationMs = Date.now() - startedAt.getTime();
    return summary;
  }

  /**
   * One price lookup for every distinct coin across all alerts, however many
   * alerts there are (spec NFR03). If the price source is down, returns no
   * prices: nothing fires and no state changes this run (spec AC12).
   */
  private async loadPrices(alerts: PriceAlert[]): Promise<Map<string, number>> {
    const symbols = Array.from(new Set(alerts.map((alert) => alert.symbol)));
    try {
      const coins = await this.coingeckoService.getPricesBySymbols(symbols);
      return new Map(coins.map((coin) => [coin.symbol, coin.priceUsd]));
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

    const delivered = await this.zaloService.sendTextMessage(
      alert.chatId,
      formatAlertTriggeredMessage(alert, priceUsd, this.usdToVndRate),
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
      // Left armed so the next run retries while the condition still holds (spec AC13).
      summary.failed++;
      return;
    }
    await this.priceAlertsService.updateState({
      ...alert,
      state: 'fired',
      lastFiredAt: now.toISOString(),
    });
    summary.fired++;
  }
}
