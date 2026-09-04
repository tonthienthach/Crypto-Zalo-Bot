import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../coingecko/coingecko.service';
import { CommandParserService } from '../command-parser/command-parser.service';
import { CommandType } from '../command-parser/interfaces/parsed-command.interface';
import { WebhookSecretGuard } from '../common/guards/webhook-secret.guard';
import {
  formatGenericErrorReply,
  formatHelpReply,
  formatPriceReply,
  formatServiceUnavailableReply,
  formatTopMarketsReply,
  formatUnknownCommandReply,
  formatUnknownSymbolsReply,
} from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { ZaloWebhookDto } from './dto/zalo-webhook.dto';
import { ConfigService } from '@nestjs/config';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly usdToVndRate: number;

  constructor(
    private readonly commandParserService: CommandParserService,
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
  ) {
    this.usdToVndRate = this.configService.get<number>('currency.usdToVndRate')!;
  }

  /**
   * Always returns 200 with { ok: true } — Zalo (like most bot platforms)
   * retries on non-2xx responses, so every code path here acknowledges the
   * webhook regardless of whether the bot's reply itself succeeded. Any
   * business-level failure is translated into a friendly chat message
   * instead of ever leaving the request to fail silently.
   */
  @Post()
  @UseGuards(WebhookSecretGuard)
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: ZaloWebhookDto): Promise<{ ok: true }> {
    const message = payload.result?.message;
    const text = message?.text;
    const chatId = message?.chat?.id;

    if (!text || !chatId) {
      return { ok: true };
    }

    await this.replyToMessage(chatId, text);
    return { ok: true };
  }

  private async replyToMessage(chatId: string, text: string): Promise<void> {
    try {
      const command = this.commandParserService.parse(text);

      switch (command.type) {
        case CommandType.HELP: {
          await this.zaloService.sendTextMessage(chatId, formatHelpReply());
          return;
        }
        case CommandType.TOP_MARKETS: {
          const coins = await this.coingeckoService.getTopMarkets();
          await this.zaloService.sendTextMessage(
            chatId,
            formatTopMarketsReply(coins, this.usdToVndRate),
          );
          return;
        }
        case CommandType.PRICE: {
          const coins = await this.coingeckoService.getPricesBySymbols(command.symbols);
          await this.zaloService.sendTextMessage(
            chatId,
            formatPriceReply(coins, this.usdToVndRate),
          );
          return;
        }
        case CommandType.UNKNOWN:
        default: {
          await this.zaloService.sendTextMessage(chatId, formatUnknownCommandReply());
          return;
        }
      }
    } catch (error) {
      await this.handleReplyError(chatId, error);
    }
  }

  private async handleReplyError(chatId: string, error: unknown): Promise<void> {
    if (error instanceof UnknownCoinSymbolsError) {
      await this.zaloService.sendTextMessage(chatId, formatUnknownSymbolsReply(error.symbols));
      return;
    }
    if (error instanceof CoingeckoUnavailableError) {
      await this.zaloService.sendTextMessage(chatId, formatServiceUnavailableReply());
      return;
    }

    this.logger.error(
      `Unexpected error while handling webhook message: ${
        error instanceof Error ? error.stack : String(error)
      }`,
    );
    await this.zaloService.sendTextMessage(chatId, formatGenericErrorReply());
  }
}
