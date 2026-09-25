import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REJECTION_FLUSH_INTERVAL_MS } from '../../price-alerts/price-alerts.constants';
import { PriceAlertsService } from '../../price-alerts/price-alerts.service';
import { CronSecretGuard } from './cron-secret.guard';

/**
 * Guards /cron/price-alerts with its OWN secret (PRICE_ALERTS_CRON_SECRET),
 * not the digest's CRON_SECRET_TOKEN. The price-alert secret has to live in
 * a third-party scheduler (cron-job.org); if it leaks, the worst an attacker
 * can do is trigger extra (lock-protected, idempotent) alert checks — not
 * re-send the daily digest to every subscriber.
 *
 * Same header forms as CronSecretGuard. If the env var is unset, every call
 * is rejected (401) rather than the app failing to boot.
 *
 * Rejected calls are counted so the report can tell "the scheduler sends the
 * wrong secret" from "nobody calls" (spec EPIC-002-FIX-FR02). Anyone can send
 * a rejected call, so the count is kept in memory and written at most once
 * per REJECTION_FLUSH_INTERVAL_MS per instance, whatever the request rate
 * (spec EPIC-002-FIX-NFR03). Nothing from the request itself is stored.
 */
@Injectable()
export class PriceAlertsCronSecretGuard extends CronSecretGuard {
  protected readonly secretConfigKey = 'priceAlerts.cronSecretToken';
  private readonly rejectionLogger = new Logger(PriceAlertsCronSecretGuard.name);
  private pendingRejections = 0;
  private lastFlushAt = Number.NEGATIVE_INFINITY;

  constructor(
    configService: ConfigService,
    private readonly priceAlertsService: PriceAlertsService,
  ) {
    super(configService);
  }

  /**
   * The first rejection after a quiet minute is written at once, so a wrong
   * secret shows up within a minute. Rejections inside the next minute are
   * added to the count written with the next flush; if none comes, that tail
   * is never written — the count is a lower bound, never a false zero.
   */
  protected onRejected(): void {
    this.pendingRejections++;
    const now = Date.now();
    if (now - this.lastFlushAt < REJECTION_FLUSH_INTERVAL_MS) {
      return;
    }

    const count = this.pendingRejections;
    this.pendingRejections = 0;
    this.lastFlushAt = now;
    // Fire-and-forget: the 401 must not wait on Redis, and a failed write
    // only loses this count.
    const logFailure = (error: unknown) =>
      this.rejectionLogger.error(`Failed to record rejected price-alert calls: ${String(error)}`);
    try {
      this.priceAlertsService.recordRejections(count, new Date(now)).catch(logFailure);
    } catch (error) {
      logFailure(error);
    }
  }
}
