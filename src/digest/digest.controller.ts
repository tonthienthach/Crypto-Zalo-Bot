import { Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../coingecko/coingecko.service';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { formatDailyDigestReply } from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';

/**
 * Machine-triggered endpoint for the daily coin digest. Has no scheduler of
 * its own — an external cron (GitHub Actions workflow, see
 * .github/workflows/daily-digest.yml) calls this once a day, authenticated
 * via CronSecretGuard, and this handler does the actual price lookup + send.
 */
@Controller('cron')
export class DigestController {
  private readonly logger = new Logger(DigestController.name);
  private readonly usdToVndRate: number;
  private readonly chatId: string;
  private readonly coinSymbols: string[];

  constructor(
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
  ) {
    this.usdToVndRate = this.configService.get<number>('currency.usdToVndRate')!;
    this.chatId = this.configService.get<string>('digest.chatId')!;
    this.coinSymbols = this.configService.get<string[]>('digest.coinSymbols')!;
  }

  @Post('daily-digest')
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  async sendDailyDigest(): Promise<{ ok: true }> {
    try {
      const coins = await this.coingeckoService.getPricesBySymbols(this.coinSymbols);
      await this.zaloService.sendTextMessage(
        this.chatId,
        formatDailyDigestReply(coins, this.usdToVndRate),
      );
    } catch (error) {
      if (error instanceof UnknownCoinSymbolsError || error instanceof CoingeckoUnavailableError) {
        this.logger.error(`Daily digest failed: ${error.message}`);
      } else {
        this.logger.error(
          `Unexpected error while sending daily digest: ${
            error instanceof Error ? error.stack : String(error)
          }`,
        );
      }
    }

    // Always 200: this is a fire-and-forget cron hook, not a user-facing
    // request — the scheduler shouldn't retry-storm on a transient CoinGecko
    // or Zalo outage that's already logged above.
    return { ok: true };
  }
}
