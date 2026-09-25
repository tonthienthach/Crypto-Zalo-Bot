import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { PriceAlertsWatchSecretGuard } from '../common/guards/price-alerts-watch-secret.guard';
import { PriceAlertsMonitorService } from './price-alerts-monitor.service';

/**
 * The watcher (spec EPIC-002-FIX-FR03): tells the owner when the per-minute
 * price-alert check stops. It is triggered every 5 minutes by a different
 * scheduler than the check's (Upstash QStash, see docs/DEPLOYMENT.md §8b) —
 * a missing check run can't report itself, so something independent of
 * cron-job.org has to notice the silence.
 */
@Controller('cron')
export class PriceAlertsWatchController {
  private readonly logger = new Logger(PriceAlertsWatchController.name);

  constructor(private readonly monitorService: PriceAlertsMonitorService) {}

  @All('price-alerts-watch')
  @UseGuards(PriceAlertsWatchSecretGuard)
  @HttpCode(HttpStatus.OK)
  async watch(): Promise<{ ok: true }> {
    try {
      await this.monitorService.runWatcher();
    } catch (error) {
      this.logger.error(
        `Price-alert watcher failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
    // Always 200, like the other machine-triggered endpoints.
    return { ok: true };
  }
}
