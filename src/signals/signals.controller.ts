import { All, Controller, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { CoingeckoService } from '../coingecko/coingecko.service';
import { SignalsCronSecretGuard } from '../common/guards/signals-cron-secret.guard';
import { pricesBySymbol } from '../portfolio/portfolio-prices';
import { formatSignalAlertMessage } from '../utils/format-signals.util';
import { ZaloService } from '../zalo/zalo.service';
import { ChatSignalState, CoinSignal, SignalRunSummary } from './interfaces/signal.interface';
import { recordSent, selectCoinsToAlert } from './signal-repeat';
import { SignalsStateService } from './signals-state.service';
import { SignalsService } from './signals.service';
import { SIGNALS_SEND_BUDGET_MS } from './signals.constants';

const FRESH_STATE: ChatSignalState = { lastSentAt: null, coins: {} };

/**
 * Machine-triggered endpoint for the proactive signal check (spec
 * EPIC-004-FR04). Like /cron/price-alerts it has no scheduler of its own:
 * cron-job.org calls it every 30 minutes with its own secret
 * (SignalsCronSecretGuard / SIGNALS_CRON_SECRET, see docs/DEPLOYMENT.md).
 *
 * A run reads only Redis (never Postgres, so Neon stays asleep), prices all
 * watched coins with ONE lookup, saves the hour's sample, evaluates, and
 * sends each chat at most one message that merges its coins.
 */
@Controller('cron')
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(
    private readonly signalsService: SignalsService,
    private readonly state: SignalsStateService,
    private readonly coingeckoService: CoingeckoService,
    private readonly zaloService: ZaloService,
  ) {}

  @All('signals')
  @UseGuards(SignalsCronSecretGuard)
  @HttpCode(HttpStatus.OK)
  async checkSignals(): Promise<{ ok: true }> {
    const startedAt = Date.now();
    let lockToken: string | null = null;
    let summary: SignalRunSummary;
    try {
      lockToken = await this.state.acquireRunLock();
      if (!lockToken) {
        this.logger.warn('Signals check skipped: a previous run still holds the lock');
        summary = emptySummary(startedAt, 'skipped');
      } else {
        summary = await this.runCheck(startedAt);
      }
    } catch (error) {
      this.logger.error(
        `Signals check failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      summary = emptySummary(startedAt, 'failed');
    } finally {
      if (lockToken) {
        await this.state.releaseRunLock(lockToken).catch((error: unknown) => {
          this.logger.error(`Failed to release signals run lock: ${String(error)}`);
        });
      }
    }

    // Counts only: a log line never carries a chat's verdicts (spec EPIC-004-AC17).
    this.logger.log(JSON.stringify({ event: 'signals-run', ...summary }));
    try {
      await this.state.recordRun(summary);
    } catch (error) {
      this.logger.error(`Failed to record signals run: ${String(error)}`);
    }

    // Always 200, like the other cron hooks: an outage is logged above and the
    // scheduler must not retry-storm on it.
    return { ok: true };
  }

  private async runCheck(startedAt: number): Promise<SignalRunSummary> {
    const summary = emptySummary(startedAt, 'healthy');

    const [watchlists, extras, disabled, sentStates] = await Promise.all([
      this.state.getWatchlists(),
      this.state.listExtra(startedAt),
      this.state.listDisabled(),
      this.state.getSentStates(),
    ]);

    const symbols = Array.from(
      new Set([...Object.values(watchlists).flat(), ...extras].map((s) => s.toLowerCase())),
    );
    summary.coins = symbols.length;
    if (symbols.length === 0) {
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }

    // One price lookup for every chat (spec EPIC-004-NFR03). If the source is
    // down nothing is sent and nothing is saved; the next run starts afresh (AC15).
    let signals: CoinSignal[];
    try {
      const coins = await this.coingeckoService.getPricesBySymbols(symbols);
      const prices = pricesBySymbol(coins, symbols, (symbol) =>
        this.coingeckoService.resolveSymbolToId(symbol),
      );
      signals = await this.signalsService.evaluateWithPrices(
        symbols,
        Object.fromEntries(Array.from(prices, ([symbol, price]) => [symbol, price.priceUsd])),
        startedAt,
      );
    } catch (error) {
      this.logger.error(
        `Signals lookup failed, skipping this run: ${error instanceof Error ? error.message : String(error)}`,
      );
      summary.outcome = 'failed';
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
    const bySymbol = new Map(signals.map((signal) => [signal.symbol, signal]));

    // Sequential and each chat in its own try/catch: one failed send never
    // blocks the rest. The budget starts after the lookup so a slow price
    // source delays this run instead of starving every chat.
    const sendsStartedAt = Date.now();
    for (const [chatId, watchlist] of Object.entries(watchlists)) {
      if (disabled.has(chatId)) continue;
      const chatSignals = watchlist
        .map((symbol) => bySymbol.get(symbol.toLowerCase()))
        .filter((signal): signal is CoinSignal => signal !== undefined);
      const picked = selectCoinsToAlert(chatSignals, sentStates[chatId] ?? FRESH_STATE, startedAt);
      if (picked.length === 0) continue;

      if (Date.now() - sendsStartedAt > SIGNALS_SEND_BUDGET_MS) {
        summary.deferred++;
        continue;
      }
      try {
        await this.alertChat(chatId, picked, sentStates[chatId] ?? FRESH_STATE, startedAt, summary);
      } catch (error) {
        summary.failures++;
        this.logger.error(
          `Signal alert for ${chatId} failed: ${error instanceof Error ? error.stack : String(error)}`,
        );
      }
    }

    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  /**
   * Sends one chat its merged message. State and verdict records are written
   * only once Zalo accepted the message (spec EPIC-004-FR05, FR06, FR11): a
   * failed send leaves the chat eligible on the next run.
   */
  private async alertChat(
    chatId: string,
    picked: CoinSignal[],
    previous: ChatSignalState,
    now: number,
    summary: SignalRunSummary,
  ): Promise<void> {
    const delivered = await this.zaloService.sendTextMessage(
      chatId,
      formatSignalAlertMessage(picked),
    );
    if (!delivered) {
      summary.failures++;
      return;
    }
    summary.chatsAlerted++;

    await this.state.setSentState(chatId, recordSent(previous, picked, now));
    try {
      await this.signalsService.recordSentVerdicts(chatId, picked, now);
      await this.state.recordUsage(chatId, 'alert', now);
    } catch (error) {
      // The message went out; losing its scorecard entry or usage count must not undo that.
      this.logger.error(`Could not record signal bookkeeping for ${chatId}: ${String(error)}`);
    }
  }
}

function emptySummary(startedAt: number, outcome: SignalRunSummary['outcome']): SignalRunSummary {
  return {
    at: new Date(startedAt).toISOString(),
    outcome,
    coins: 0,
    chatsAlerted: 0,
    failures: 0,
    deferred: 0,
    durationMs: Date.now() - startedAt,
  };
}
