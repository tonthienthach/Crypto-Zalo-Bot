import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../coingecko/coingecko.service';
import { CommandParserService } from '../command-parser/command-parser.service';
import { CommandType } from '../command-parser/interfaces/parsed-command.interface';
import { WebhookSecretGuard } from '../common/guards/webhook-secret.guard';
import { InvalidWatchlistError, SubscribersService } from '../subscribers/subscribers.service';
import { DEFAULT_WATCHLIST } from '../subscribers/subscribers.constants';
import {
  formatGenericErrorReply,
  formatHelpReply,
  formatInvalidWatchlistReply,
  formatPriceReply,
  formatServiceUnavailableReply,
  formatSubscribeReply,
  formatTopMarketsReply,
  formatUnknownCommandReply,
  formatUnknownSymbolsReply,
  formatUnsubscribeReply,
  formatWatchlistNotSubscribedReply,
  formatWatchlistUpdatedReply,
  formatWatchlistViewReply,
} from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { ZaloWebhookDto } from './dto/zalo-webhook.dto';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly usdToVndRate: number;

  constructor(
    private readonly commandParserService: CommandParserService,
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
    private readonly subscribersService: SubscribersService,
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
    const message = payload.message;
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
        case CommandType.SUBSCRIBE: {
          const watchlist = command.symbols.length > 0 ? command.symbols : DEFAULT_WATCHLIST;
          const subscriber = await this.subscribersService.subscribe(chatId, watchlist);
          await this.zaloService.sendTextMessage(
            chatId,
            formatSubscribeReply(subscriber.watchlist),
          );
          return;
        }
        case CommandType.UNSUBSCRIBE: {
          await this.subscribersService.unsubscribe(chatId);
          await this.zaloService.sendTextMessage(chatId, formatUnsubscribeReply());
          return;
        }
        case CommandType.WATCHLIST: {
          if (command.symbols.length === 0) {
            const subscriber = await this.subscribersService.findActiveByChatId(chatId);
            await this.zaloService.sendTextMessage(
              chatId,
              formatWatchlistViewReply(subscriber?.watchlist ?? null),
            );
            return;
          }
          const updated = await this.subscribersService.updateWatchlist(chatId, command.symbols);
          await this.zaloService.sendTextMessage(
            chatId,
            updated
              ? formatWatchlistUpdatedReply(updated.watchlist)
              : formatWatchlistNotSubscribedReply(),
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
    if (error instanceof InvalidWatchlistError) {
      await this.zaloService.sendTextMessage(chatId, formatInvalidWatchlistReply(error.message));
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
