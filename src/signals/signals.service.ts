import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoingeckoCoinNotFoundError, CoingeckoService } from '../coingecko/coingecko.service';
import { pricesBySymbol } from '../portfolio/portfolio-prices';
import {
  BacktestResult,
  CoinSignal,
  PricePoint,
  Scorecard,
  SignalRecord,
  SignalThresholds,
} from './interfaces/signal.interface';
import { runBacktest, scoreRecords } from './signal-backtest';
import { evaluateSignal } from './signal-evaluator';
import { SignalsHistoryService, buildBackfillPoints } from './signals-history.service';
import { SignalsStateService } from './signals-state.service';
import { BACKTEST_DAYS, BACKTEST_MIN_DAYS, DAY_MS } from './signals.constants';

/** Days of verdicts the scorecard looks back over (spec EPIC-004-FR11). */
export const SCORECARD_DAYS = 30;

export interface SingleSignal {
  signal: CoinSignal;
  /** False when the coin could not be tracked (too many tracked already): its verdict is not scored. */
  tracked: boolean;
}

/**
 * Signals for the commands, the digest and the periodic check, all through
 * one place so "strong swing" means the same everywhere (spec EPIC-004-FR01).
 */
@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly coingeckoService: CoingeckoService,
    private readonly history: SignalsHistoryService,
    private readonly state: SignalsStateService,
  ) {}

  thresholds(): SignalThresholds {
    return {
      swing24hPct: this.configService.get<number>('signals.swing24hPct') ?? 8,
      swing72hPct: this.configService.get<number>('signals.swing72hPct') ?? 15,
      bandPct: this.configService.get<number>('signals.bandPct') ?? 25,
    };
  }

  /**
   * Signals for coins that are tracked (on a watchlist or tracked extra):
   * one price lookup for all of them, this hour's sample saved, history
   * filled once for coins seen first time, then evaluated. Coins the price
   * source did not return are left out. Throws what the price lookup throws.
   */
  async getSignalsForSymbols(symbols: string[], now: number): Promise<CoinSignal[]> {
    if (symbols.length === 0) return [];
    const coins = await this.coingeckoService.getPricesBySymbols(symbols);
    const prices = pricesBySymbol(coins, symbols, (symbol) =>
      this.coingeckoService.resolveSymbolToId(symbol),
    );
    return this.evaluateWithPrices(
      symbols,
      Object.fromEntries(Array.from(prices, ([symbol, price]) => [symbol, price.priceUsd])),
      now,
    );
  }

  /**
   * Same as getSignalsForSymbols but the prices are already known (the
   * periodic check fetches them once for every chat). Saves the samples.
   */
  async evaluateWithPrices(
    symbols: string[],
    prices: Record<string, number>,
    now: number,
  ): Promise<CoinSignal[]> {
    const priced = symbols.filter((symbol) => prices[symbol] !== undefined);
    if (priced.length === 0) return [];
    await this.history.snapshot(
      Object.fromEntries(priced.map((symbol) => [symbol, prices[symbol]])),
      now,
    );
    await this.history.backfill(priced, now).catch((error) => {
      this.logger.warn(`Backfill step failed: ${(error as Error).message}`);
      return [];
    });
    const hourly = await this.history.loadHourly(priced, now);
    return priced.map((symbol) => ({
      symbol,
      result: evaluateSignal(hourly[symbol] ?? [], prices[symbol], now, this.thresholds()),
    }));
  }

  /**
   * "/tinhieu <coin>" for any coin the price lookup knows (spec EPIC-004-FR08).
   * The coin is tracked for a few days so its verdict can be scored (FR11).
   * When MAX_EXTRA_TRACKED coins are already tracked it is evaluated once
   * from CoinGecko's chart without storing anything, and not scored.
   */
  async getSignalFor(symbol: string, now: number): Promise<SingleSignal> {
    const [coin] = await this.coingeckoService.getPricesBySymbols([symbol]);
    const tracked = await this.state.trackExtra(symbol, now);
    if (tracked) {
      const [signal] = await this.evaluateWithPrices([symbol], { [symbol]: coin.priceUsd }, now);
      return { signal, tracked };
    }
    const hourly = (await this.chartPoints(symbol, now)).hourly;
    return {
      signal: {
        symbol,
        result: evaluateSignal(hourly, coin.priceUsd, now, this.thresholds()),
      },
      tracked,
    };
  }

  /**
   * "/tinhieu backtest <coin>" (spec EPIC-004-FR10): the rules replayed over
   * up to 90 days of end-of-day prices. Uses stored history when it is long
   * enough, otherwise one call to CoinGecko's chart that is not stored — a
   * backtest of an arbitrary coin must not grow what we keep.
   */
  async backtest(symbol: string, now: number): Promise<BacktestResult> {
    const stored = (await this.history.loadDaily([symbol], now))[symbol] ?? [];
    let daily: PricePoint[] = stored;
    if (stored.length < BACKTEST_MIN_DAYS) {
      daily = (await this.chartPoints(symbol, now)).daily;
    }
    const closes = daily.slice(-BACKTEST_DAYS).map((point) => point.p);
    return runBacktest(closes, this.thresholds());
  }

  /** Scorecard of the verdicts sent to a chat in the last SCORECARD_DAYS (spec EPIC-004-FR11). */
  async scorecard(chatId: string, now: number): Promise<Scorecard> {
    const records = await this.state.listRecords(chatId, now - SCORECARD_DAYS * DAY_MS);
    const symbols = Array.from(new Set(records.map((record) => record.symbol)));
    if (symbols.length === 0) return scoreRecords([], {}, now);

    const [hourly, daily] = await Promise.all([
      this.history.loadHourly(symbols, now),
      this.history.loadDaily(symbols, now),
    ]);
    const merged: Record<string, PricePoint[]> = {};
    for (const symbol of symbols) {
      merged[symbol] = [...(daily[symbol] ?? []), ...(hourly[symbol] ?? [])].sort(
        (a, b) => a.t - b.t,
      );
    }
    return scoreRecords(records, merged, now);
  }

  /**
   * CoinGecko's chart as kept points; none for a coin CoinGecko does not know (404, e.g.
   * CoinPaprika-only). A rate limit or outage is not swallowed: the caller says "try later"
   * instead of reporting a history of 0 days.
   */
  private async chartPoints(
    symbol: string,
    now: number,
  ): Promise<{ hourly: PricePoint[]; daily: PricePoint[] }> {
    try {
      return buildBackfillPoints(
        await this.coingeckoService.getMarketChart(symbol, BACKTEST_DAYS),
        now,
      );
    } catch (error) {
      if (!(error instanceof CoingeckoCoinNotFoundError)) throw error;
      return { hourly: [], daily: [] };
    }
  }

  /** Records the buy/sell verdicts that were really sent to a chat (spec EPIC-004-FR11). */
  async recordSentVerdicts(chatId: string, signals: CoinSignal[], now: number): Promise<void> {
    const records: SignalRecord[] = [];
    for (const { symbol, result } of signals) {
      if (result.verdict === 'buy' || result.verdict === 'sell') {
        records.push({ symbol, verdict: result.verdict, priceUsd: result.priceUsd, at: now });
      }
    }
    await this.state.recordVerdicts(chatId, records, now);
  }
}
