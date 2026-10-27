import { Injectable } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard';

/**
 * Guards /cron/signals with its OWN secret (SIGNALS_CRON_SECRET), not the
 * digest's CRON_SECRET_TOKEN: it lives in a third-party scheduler
 * (cron-job.org), and a leak must not be able to re-send the daily digest.
 * Same header forms as CronSecretGuard; an unset env var rejects every call
 * (401) rather than failing the boot.
 */
@Injectable()
export class SignalsCronSecretGuard extends CronSecretGuard {
  protected readonly secretConfigKey = 'signals.cronSecretToken';
}
