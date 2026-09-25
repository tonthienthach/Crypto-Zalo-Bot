import { Injectable } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard';

/**
 * Guards /cron/price-alerts-watch with its own secret
 * (PRICE_ALERTS_WATCH_SECRET) — different from both the digest's and the
 * check's, since it lives with yet another third party (the watcher's
 * scheduler, Upstash QStash). A leak lets someone trigger extra watcher runs
 * (read-mostly, rate-limited messages to the owner), nothing else.
 *
 * Same header forms as CronSecretGuard. Unset: every call is rejected (401).
 */
@Injectable()
export class PriceAlertsWatchSecretGuard extends CronSecretGuard {
  protected readonly secretConfigKey = 'priceAlerts.watchSecretToken';
}
