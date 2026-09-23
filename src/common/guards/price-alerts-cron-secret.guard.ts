import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class PriceAlertsCronSecretGuard extends CronSecretGuard {
  protected readonly secretConfigKey = 'priceAlerts.cronSecretToken';
}
