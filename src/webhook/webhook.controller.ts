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
import {
  AlertConditionAlreadyMetError,
  AlertLimitReachedError,
  AlertNotFoundError,
  PriceAlertsService,
} from '../price-alerts/price-alerts.service';
import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import { ParsedCommand } from '../command-parser/interfaces/parsed-command.interface';
import { pricesBySymbol } from '../portfolio/portfolio-prices';
import {
  computeHoldings,
  findRecentTwin,
  computePortfolio,
  InconsistentTradesError,
} from '../portfolio/portfolio-calculator';
import {
  PortfolioDeleteWouldOversellError,
  PortfolioLimitError,
  PortfolioOversellError,
  PortfolioService,
  PortfolioTradeNotFoundError,
  PortfolioUnavailableError,
} from '../portfolio/portfolio.service';
import { InvalidWatchlistError, SubscribersService } from '../subscribers/subscribers.service';
import { DEFAULT_WATCHLIST } from '../subscribers/subscribers.constants';
import {
  formatAlertAlreadyMetReply,
  formatAlertCreatedReply,
  formatAlertDeletedReply,
  formatAlertInvalidReply,
  formatAlertLimitReply,
  formatAlertListReply,
  formatAlertNotFoundReply,
  formatGenericErrorReply,
  formatHelpReply,
  formatInvalidWatchlistReply,
  formatPortfolioClearConfirmReply,
  formatPortfolioClearedReply,
  formatPortfolioDeletedReply,
  formatPortfolioDeleteRefusedReply,
  formatPortfolioEmptyReply,
  formatPortfolioGroupRefusedReply,
  formatPortfolioHistoryReply,
  formatPortfolioInvalidReply,
  formatPortfolioLimitReply,
  formatPortfolioNotFoundReply,
  formatPortfolioOversellReply,
  formatPortfolioReply,
  formatPortfolioTradeRecordedReply,
  formatPortfolioUnavailableReply,
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

/** "/danhmuc" commands: private chats only (spec EPIC-003-FR12). */
const PORTFOLIO_COMMANDS = new Set<CommandType>([
  CommandType.PORTFOLIO_VIEW,
  CommandType.PORTFOLIO_TRADE,
  CommandType.PORTFOLIO_HISTORY,
  CommandType.PORTFOLIO_DELETE,
  CommandType.PORTFOLIO_CLEAR,
  CommandType.PORTFOLIO_INVALID,
]);

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
    private readonly priceAlertsService: PriceAlertsService,
    private readonly portfolioService: PortfolioService,
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

    await this.replyToMessage(chatId, text, message.chat.chat_type, message.message_id);
    return { ok: true };
  }

  private async replyToMessage(
    chatId: string,
    text: string,
    chatType?: string,
    messageId?: string,
  ): Promise<void> {
    try {
      const command = this.commandParserService.parse(text);

      if (PORTFOLIO_COMMANDS.has(command.type)) {
        await this.replyToPortfolioCommand(chatId, command, chatType, messageId);
        return;
      }

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
        case CommandType.ALERT_CREATE: {
          const { direction, threshold } = command.alert!;
          const created = await this.priceAlertsService.create(
            chatId,
            command.symbols[0],
            direction!,
            threshold!,
          );
          await this.zaloService.sendTextMessage(
            chatId,
            formatAlertCreatedReply(
              created.alert,
              created.position,
              created.currentPriceUsd,
              this.usdToVndRate,
            ),
          );
          return;
        }
        case CommandType.ALERT_LIST: {
          const alerts = await this.priceAlertsService.listByChat(chatId);
          await this.zaloService.sendTextMessage(chatId, formatAlertListReply(alerts));
          return;
        }
        case CommandType.ALERT_DELETE: {
          const index = command.alert!.index!;
          const deleted = await this.priceAlertsService.deleteByIndex(chatId, index);
          await this.zaloService.sendTextMessage(chatId, formatAlertDeletedReply(deleted, index));
          return;
        }
        case CommandType.ALERT_INVALID: {
          await this.zaloService.sendTextMessage(chatId, formatAlertInvalidReply());
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

  /**
   * "/danhmuc" and its subcommands (spec EPIC-003). Only a chat whose
   * `chat_type` is PRIVATE gets through: a group, and a payload without the
   * field, are refused, so a member's amounts never show to a whole group.
   * Logs carry the chat, command and outcome only — never an amount (NFR06).
   */
  private async replyToPortfolioCommand(
    chatId: string,
    command: ParsedCommand,
    chatType?: string,
    messageId?: string,
  ): Promise<void> {
    if ((chatType ?? '').toUpperCase() !== 'PRIVATE') {
      this.logger.warn(
        `Portfolio command refused outside a private chat: chat ${chatId}, chat_type=${
          chatType ?? '(missing)'
        }`,
      );
      await this.zaloService.sendTextMessage(chatId, formatPortfolioGroupRefusedReply());
      return;
    }

    const args = command.portfolio ?? {};
    switch (command.type) {
      case CommandType.PORTFOLIO_VIEW: {
        await this.replyWithPortfolio(chatId);
        return;
      }
      case CommandType.PORTFOLIO_TRADE: {
        const [symbol] = command.symbols;
        // Only coins "/gia" can price are accepted (FR03): throws UnknownCoinSymbolsError otherwise.
        await this.coingeckoService.getPricesBySymbols([symbol]);
        const recorded = await this.portfolioService.recordTrade(
          chatId,
          args.side!,
          symbol,
          args.quantity!,
          args.priceUsd!,
          messageId,
        );
        if (recorded.duplicate) {
          // A redelivered webhook: the trade was recorded the first time.
          this.logger.warn(
            `Portfolio trade not recorded twice: chat ${chatId} resent message ${messageId}`,
          );
        }
        await this.zaloService.sendTextMessage(
          chatId,
          formatPortfolioTradeRecordedReply(
            recorded.trade,
            computeHoldings(recorded.trades),
            this.usdToVndRate,
            {
              duplicate: recorded.duplicate,
              twin: recorded.duplicate
                ? undefined
                : findRecentTwin(recorded.trades, recorded.trade),
            },
          ),
        );
        return;
      }
      case CommandType.PORTFOLIO_HISTORY: {
        const page = await this.portfolioService.listTradesPage(chatId, args.page ?? 1);
        await this.zaloService.sendTextMessage(chatId, formatPortfolioHistoryReply(page));
        return;
      }
      case CommandType.PORTFOLIO_DELETE: {
        const deleted = await this.portfolioService.deleteTrade(chatId, args.index!);
        await this.zaloService.sendTextMessage(
          chatId,
          formatPortfolioDeletedReply(deleted.trade, computeHoldings(deleted.trades)),
        );
        return;
      }
      case CommandType.PORTFOLIO_CLEAR: {
        if (!args.confirmed) {
          await this.zaloService.sendTextMessage(chatId, formatPortfolioClearConfirmReply());
          return;
        }
        const deletedCount = await this.portfolioService.clearTrades(chatId);
        await this.zaloService.sendTextMessage(chatId, formatPortfolioClearedReply(deletedCount));
        return;
      }
      case CommandType.PORTFOLIO_INVALID:
      default: {
        await this.zaloService.sendTextMessage(chatId, formatPortfolioInvalidReply());
        return;
      }
    }
  }

  /**
   * "/danhmuc": one store read, then one price lookup for every held coin
   * (spec EPIC-003-NFR03). A price source outage gets the "/gia" outage reply
   * and no numbers (AC13); a lookup that finds none of the coins lists them
   * all as unpriced instead of calling them unknown coins.
   */
  private async replyWithPortfolio(chatId: string): Promise<void> {
    const startedAt = Date.now();
    const trades = await this.portfolioService.listTrades(chatId);
    if (trades.length === 0) {
      await this.zaloService.sendTextMessage(chatId, formatPortfolioEmptyReply());
      return;
    }

    const holdings = computeHoldings(trades);
    const symbols = holdings.holdings.map((holding) => holding.symbol);
    let coins: CoinMarketData[] = [];
    if (symbols.length > 0) {
      try {
        coins = await this.coingeckoService.getPricesBySymbols(symbols);
      } catch (error) {
        if (!(error instanceof UnknownCoinSymbolsError)) throw error;
      }
    }
    const prices = pricesBySymbol(coins, symbols, (symbol) =>
      this.coingeckoService.resolveSymbolToId(symbol),
    );
    await this.zaloService.sendTextMessage(
      chatId,
      formatPortfolioReply(computePortfolio(holdings, prices), this.usdToVndRate),
    );
    this.logger.log(
      JSON.stringify({
        event: 'portfolio-view',
        chatId,
        coins: symbols.length,
        durationMs: Date.now() - startedAt,
      }),
    );
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
    if (error instanceof AlertLimitReachedError) {
      await this.zaloService.sendTextMessage(chatId, formatAlertLimitReply(error.limit));
      return;
    }
    if (error instanceof AlertConditionAlreadyMetError) {
      await this.zaloService.sendTextMessage(
        chatId,
        formatAlertAlreadyMetReply(error.symbol, error.direction, error.currentPriceUsd),
      );
      return;
    }
    if (error instanceof AlertNotFoundError) {
      await this.zaloService.sendTextMessage(chatId, formatAlertNotFoundReply(error.index));
      return;
    }
    if (error instanceof PortfolioOversellError) {
      await this.zaloService.sendTextMessage(
        chatId,
        formatPortfolioOversellReply(error.symbol, error.heldQuantity),
      );
      return;
    }
    if (error instanceof PortfolioLimitError) {
      await this.zaloService.sendTextMessage(
        chatId,
        formatPortfolioLimitReply(error.kind, error.limit),
      );
      return;
    }
    if (error instanceof PortfolioTradeNotFoundError) {
      await this.zaloService.sendTextMessage(chatId, formatPortfolioNotFoundReply(error.index));
      return;
    }
    if (error instanceof PortfolioDeleteWouldOversellError) {
      await this.zaloService.sendTextMessage(
        chatId,
        formatPortfolioDeleteRefusedReply(error.index, error.symbol),
      );
      return;
    }
    if (error instanceof PortfolioUnavailableError || error instanceof InconsistentTradesError) {
      // PortfolioService already logged the failure by name only; the inconsistent-trades
      // message names a trade number and a coin, never an amount (NFR06).
      if (error instanceof InconsistentTradesError) {
        this.logger.error(`Portfolio for ${chatId} could not be replayed: ${error.message}`);
      }
      await this.zaloService.sendTextMessage(chatId, formatPortfolioUnavailableReply());
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
