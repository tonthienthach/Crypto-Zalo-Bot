import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../coingecko/coingecko.service';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { Subscriber } from '../subscribers/interfaces/subscriber.interface';
import { SubscribersService } from '../subscribers/subscribers.service';
import { formatCronTrackingLine, formatDailyDigestReply } from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';

/** Drift beyond this many minutes from the expected 09:00 ICT slot logs a warning, not just a log line. */
const DRIFT_WARN_THRESHOLD_MINUTES = 15;

/**
 * Machine-triggered endpoint for the daily coin digest. Has no scheduler of
 * its own — Vercel Cron (see vercel.json, `crons`) calls this once a day at
 * 02:00 UTC (09:00 ICT), authenticated via CronSecretGuard, and this handler
 * does the actual price lookup + send. Accepts any HTTP method (@All) because
 * Vercel Cron issues GET while manual/legacy callers may still POST.
 */
@Controller('cron')
export class DigestController {
  private readonly logger = new Logger(DigestController.name);
  private readonly usdToVndRate: number;
  private readonly cronTrackingEnabled: boolean;

  constructor(
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
    private readonly subscribersService: SubscribersService,
  ) {
    this.usdToVndRate = this.configService.get<number>('currency.usdToVndRate')!;
    this.cronTrackingEnabled = this.configService.get<boolean>('digest.cronTrackingEnabled')!;
  }

  @All('daily-digest')
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  async sendDailyDigest(): Promise<{ ok: true }> {
    const invokedAt = new Date();
    this.logDrift(invokedAt);

    const cronTrackingLine = this.cronTrackingEnabled
      ? formatCronTrackingLine(invokedAt)
      : undefined;

    try {
      const subscribers = await this.subscribersService.listActive();
      // Sequential, not Promise.all: each subscriber's watchlist is fetched
      // and sent independently, so one subscriber's unknown-symbol typo or a
      // single failed send doesn't block or fail the rest of the run.
      for (const subscriber of subscribers) {
        await this.sendToSubscriber(subscriber, cronTrackingLine);
      }
    } catch (error) {
      this.logger.error(
        `Failed to load subscribers for daily digest: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
    }

    // Always 200: this is a fire-and-forget cron hook, not a user-facing
    // request — the scheduler shouldn't retry-storm on a transient CoinGecko
    // or Zalo outage that's already logged above.
    return { ok: true };
  }

  private async sendToSubscriber(subscriber: Subscriber, cronTrackingLine?: string): Promise<void> {
    try {
      const coins = await this.coingeckoService.getPricesBySymbols(subscriber.watchlist);
      await this.zaloService.sendTextMessage(
        subscriber.chatId,
        formatDailyDigestReply(coins, this.usdToVndRate, cronTrackingLine),
      );
    } catch (error) {
      if (error instanceof UnknownCoinSymbolsError || error instanceof CoingeckoUnavailableError) {
        this.logger.error(`Daily digest failed for ${subscriber.chatId}: ${error.message}`);
      } else {
        this.logger.error(
          `Unexpected error sending daily digest to ${subscriber.chatId}: ${
            error instanceof Error ? error.stack : String(error)
          }`,
        );
      }
    }
  }

  /** Logs (Vercel function logs) how far this invocation landed from the expected 09:00 ICT slot. */
  private logDrift(invokedAt: Date): void {
    const driftMinutes = Math.round(
      (invokedAt.getTime() - this.expectedInvocationTime(invokedAt).getTime()) / 60_000,
    );
    const message = `Cron invoked at ${invokedAt.toISOString()}, drift ${driftMinutes >= 0 ? '+' : ''}${driftMinutes}m from expected 09:00 ICT`;
    if (Math.abs(driftMinutes) > DRIFT_WARN_THRESHOLD_MINUTES) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  /** The 09:00 ICT (02:00 UTC) instant on the same UTC calendar day as `invokedAt`. */
  private expectedInvocationTime(invokedAt: Date): Date {
    const expected = new Date(invokedAt);
    expected.setUTCHours(2, 0, 0, 0);
    return expected;
  }
}
