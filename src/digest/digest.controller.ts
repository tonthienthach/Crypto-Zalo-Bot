import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../coingecko/coingecko.service';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import { PortfolioTrade } from '../portfolio/interfaces/portfolio.interface';
import { computeHoldings, computePortfolio } from '../portfolio/portfolio-calculator';
import { pricesBySymbol } from '../portfolio/portfolio-prices';
import { PortfolioService } from '../portfolio/portfolio.service';
import { CoinSignal } from '../signals/interfaces/signal.interface';
import { SignalsStateService } from '../signals/signals-state.service';
import { SignalsSubscriptionsMirror } from '../signals/signals-subscriptions-mirror';
import { SignalsService } from '../signals/signals.service';
import { Subscriber } from '../subscribers/interfaces/subscriber.interface';
import { SubscribersService } from '../subscribers/subscribers.service';
import {
  formatCronTrackingLine,
  formatDailyDigestReply,
  formatPortfolioDigestSection,
  formatPortfolioDigestUnavailableSection,
} from '../utils/format-message.util';
import { formatSignalDigestSection } from '../utils/format-signals.util';
import { ZaloService } from '../zalo/zalo.service';

/** One line per digest run, logged as JSON (spec EPIC-003-NFR09). */
interface DigestRunSummary {
  subscribers: number;
  sent: number;
  failed: number;
  /** Digests that carried a portfolio part. */
  portfolioSections: number;
  /** Chats whose portfolio part could not be computed (their watchlist still went out). */
  portfolioFailures: number;
  /** The one query loading every portfolio failed: no chat got a portfolio part. */
  portfolioLoadFailed: boolean;
  /** Digests that carried a "Tín hiệu" part. */
  signalSections: number;
  /** Chats whose signals part could not be built (their prices still went out). */
  signalFailures: number;
  /** The one signals lookup failed: no chat got a signals part. */
  signalLoadFailed: boolean;
}

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
    private readonly portfolioService: PortfolioService,
    private readonly signalsService: SignalsService,
    private readonly signalsMirror: SignalsSubscriptionsMirror,
    private readonly signalsState: SignalsStateService,
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

    const run: DigestRunSummary = {
      subscribers: 0,
      sent: 0,
      failed: 0,
      portfolioSections: 0,
      portfolioFailures: 0,
      portfolioLoadFailed: false,
      signalSections: 0,
      signalFailures: 0,
      signalLoadFailed: false,
    };
    try {
      const subscribers = await this.subscribersService.listActive();
      run.subscribers = subscribers.length;
      const tradesByChat = await this.loadTrades(subscribers, run);
      // Heals the Redis copy of the watchlists the signals check reads (never throws).
      await this.signalsMirror.syncAll(subscribers);
      const signalsBySymbol = await this.loadSignals(subscribers, run, invokedAt.getTime());
      // Sequential, not Promise.all: each subscriber's watchlist is fetched
      // and sent independently, so one subscriber's unknown-symbol typo or a
      // single failed send doesn't block or fail the rest of the run.
      for (const subscriber of subscribers) {
        await this.sendToSubscriber(
          subscriber,
          tradesByChat.get(subscriber.chatId) ?? [],
          run,
          signalsBySymbol,
          invokedAt.getTime(),
          cronTrackingLine,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to load subscribers for daily digest: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
    }
    // Failures included, not only successes (spec EPIC-003-NFR09).
    this.logger.log(
      JSON.stringify({
        event: 'daily-digest-run',
        ...run,
        durationMs: Date.now() - invokedAt.getTime(),
      }),
    );

    // Always 200: this is a fire-and-forget cron hook, not a user-facing
    // request — the scheduler shouldn't retry-storm on a transient CoinGecko
    // or Zalo outage that's already logged above.
    return { ok: true };
  }

  /**
   * Every active subscriber's trades in one query (spec EPIC-003-NFR03,
   * NFR04). If that fails, the run goes on as before the portfolio existed:
   * everyone still gets their watchlist, just without a portfolio part.
   */
  private async loadTrades(
    subscribers: Subscriber[],
    run: DigestRunSummary,
  ): Promise<Map<string, PortfolioTrade[]>> {
    try {
      return await this.portfolioService.listTradesForChats(
        subscribers.map((subscriber) => subscriber.chatId),
      );
    } catch (error) {
      run.portfolioLoadFailed = true;
      this.logger.error(
        `Daily digest: portfolios not loaded, sending watchlists only: ${
          error instanceof Error ? error.name : String(error)
        }`,
      );
      return new Map();
    }
  }

  /**
   * Signals for every coin on any watchlist, in one lookup (spec
   * EPIC-004-FR03, NFR03): no per-chat price call. If it fails, the digests
   * go out with prices only; undefined means "no signals part for anyone".
   */
  private async loadSignals(
    subscribers: Subscriber[],
    run: DigestRunSummary,
    now: number,
  ): Promise<Map<string, CoinSignal> | undefined> {
    const symbols = Array.from(new Set(subscribers.flatMap((s) => s.watchlist)));
    if (symbols.length === 0) {
      return new Map();
    }
    try {
      const signals = await this.signalsService.getSignalsForSymbols(symbols, now);
      return new Map(signals.map((signal) => [signal.symbol, signal]));
    } catch (error) {
      run.signalLoadFailed = true;
      this.logger.error(
        `Daily digest: signals not computed, sending prices only: ${
          error instanceof Error ? error.name : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * The "Tín hiệu" part of one chat's digest, in its own try/catch: a failure
   * only drops this part (spec EPIC-004-AC09, NFR07).
   */
  private signalsPart(
    subscriber: Subscriber,
    signalsBySymbol: Map<string, CoinSignal> | undefined,
    run: DigestRunSummary,
  ): { section?: string; shown: CoinSignal[] } {
    if (!signalsBySymbol) {
      return { shown: [] };
    }
    try {
      const shown = subscriber.watchlist
        .map((symbol) => signalsBySymbol.get(symbol))
        .filter((signal): signal is CoinSignal => signal !== undefined);
      return { section: formatSignalDigestSection(shown), shown };
    } catch (error) {
      run.signalFailures++;
      this.logger.error(
        `Daily digest: signals of ${subscriber.chatId} not built: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { shown: [] };
    }
  }

  /**
   * Once the digest went out: records the verdicts it carried (spec
   * EPIC-004-FR11) and the use (FR12). Bookkeeping never fails the digest.
   */
  private async recordSignalsSent(chatId: string, shown: CoinSignal[], now: number): Promise<void> {
    try {
      await this.signalsService.recordSentVerdicts(chatId, shown, now);
      await this.signalsState.recordUsage(chatId, 'digest', now);
    } catch (error) {
      this.logger.error(
        `Daily digest: signal bookkeeping for ${chatId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async sendToSubscriber(
    subscriber: Subscriber,
    trades: PortfolioTrade[],
    run: DigestRunSummary,
    signalsBySymbol: Map<string, CoinSignal> | undefined,
    now: number,
    cronTrackingLine?: string,
  ): Promise<void> {
    try {
      const heldSymbols = this.heldSymbols(subscriber.chatId, trades, run);
      const extraSymbols = (heldSymbols ?? []).filter(
        (symbol) => !subscriber.watchlist.includes(symbol),
      );
      // One lookup for the watchlist and every held coin (spec EPIC-003-NFR03).
      const coins = await this.coingeckoService.getPricesBySymbols([
        ...subscriber.watchlist,
        ...extraSymbols,
      ]);
      const watchlistCoins =
        extraSymbols.length === 0 ? coins : this.watchlistCoins(coins, subscriber.watchlist);
      if (watchlistCoins.length === 0) {
        // Only held coins were found: the watchlist itself is all unknown symbols, as before.
        throw new UnknownCoinSymbolsError(subscriber.watchlist);
      }

      const portfolioSection =
        heldSymbols === undefined
          ? formatPortfolioDigestUnavailableSection()
          : this.portfolioSection(subscriber.chatId, trades, heldSymbols, coins, run);
      const signals = this.signalsPart(subscriber, signalsBySymbol, run);
      const delivered = await this.zaloService.sendTextMessage(
        subscriber.chatId,
        formatDailyDigestReply(
          watchlistCoins,
          this.usdToVndRate,
          cronTrackingLine,
          portfolioSection,
          signals.section,
        ),
      );
      // ZaloService never throws; a failed send resolves false (already logged there).
      if (delivered) {
        run.sent++;
        if (signals.section) {
          run.signalSections++;
          await this.recordSignalsSent(subscriber.chatId, signals.shown, now);
        }
      } else {
        run.failed++;
      }
    } catch (error) {
      run.failed++;
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

  /**
   * Coins the chat holds; [] for no portfolio (the digest then reads exactly
   * as before, spec EPIC-003-FR11), undefined when its trades can't be
   * replayed — counted as a portfolio failure, the watchlist still goes out.
   */
  private heldSymbols(
    chatId: string,
    trades: PortfolioTrade[],
    run: DigestRunSummary,
  ): string[] | undefined {
    try {
      return computeHoldings(trades).holdings.map((holding) => holding.symbol);
    } catch (error) {
      run.portfolioFailures++;
      this.logger.error(
        `Daily digest: portfolio of ${chatId} not computed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /** The watchlist's part of a combined lookup, matched by symbol or shared id. */
  private watchlistCoins(coins: CoinMarketData[], watchlist: string[]): CoinMarketData[] {
    const ids = new Set(watchlist.map((symbol) => this.coingeckoService.resolveSymbolToId(symbol)));
    return coins.filter((coin) => watchlist.includes(coin.symbol) || ids.has(coin.id));
  }

  /**
   * The portfolio part of one digest, in its own try/catch: a failure here
   * becomes a "no data right now" line and never costs the watchlist part
   * (spec EPIC-003-NFR08). Undefined when the chat holds nothing.
   */
  private portfolioSection(
    chatId: string,
    trades: PortfolioTrade[],
    heldSymbols: string[],
    coins: CoinMarketData[],
    run: DigestRunSummary,
  ): string | undefined {
    if (heldSymbols.length === 0) {
      return undefined;
    }
    try {
      const prices = pricesBySymbol(coins, heldSymbols, (symbol) =>
        this.coingeckoService.resolveSymbolToId(symbol),
      );
      const section = formatPortfolioDigestSection(
        computePortfolio(computeHoldings(trades), prices),
        this.usdToVndRate,
      );
      run.portfolioSections++;
      return section;
    } catch (error) {
      run.portfolioFailures++;
      this.logger.error(
        `Daily digest: portfolio of ${chatId} not computed: ${
          error instanceof Error ? error.name : String(error)
        }`,
      );
      return formatPortfolioDigestUnavailableSection();
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
