import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import { COINPAPRIKA_API_BASE_URL, COINPAPRIKA_TICKERS_CACHE_KEY } from './coinpaprika.constants';
import { CoinPaprikaTicker } from './interfaces/coinpaprika-response.interface';

/**
 * Free, no-API-key fallback for ticker symbols CoinGecko can't resolve (not
 * covered by SYMBOL_TO_COINGECKO_ID, or genuinely missing from CoinGecko).
 * Used only when CoinGecko leaves symbols unresolved — see
 * CoingeckoService.getPricesBySymbols.
 */
@Injectable()
export class CoinPaprikaService {
  private readonly logger = new Logger(CoinPaprikaService.name);
  private readonly cacheTtlMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.cacheTtlMs = (this.configService.get<number>('coinpaprika.cacheTtlSeconds') ?? 30) * 1000;
  }

  /**
   * Best-effort lookup: never throws, and simply omits symbols it can't
   * match so a CoinPaprika outage never breaks the primary CoinGecko path.
   */
  async getPricesBySymbols(symbols: string[]): Promise<CoinMarketData[]> {
    if (symbols.length === 0) {
      return [];
    }

    const tickers = await this.getAllTickers();
    if (!tickers) {
      return [];
    }

    const bestTickerBySymbol = new Map<string, CoinPaprikaTicker>();
    for (const ticker of tickers) {
      const key = ticker.symbol.toLowerCase();
      const existing = bestTickerBySymbol.get(key);
      // CoinPaprika reuses tickers across unrelated coins; keep the
      // highest-ranked (lowest rank number) match, same tie-break CMC uses.
      if (!existing || ticker.rank < existing.rank) {
        bestTickerBySymbol.set(key, ticker);
      }
    }

    const results: CoinMarketData[] = [];
    for (const rawSymbol of symbols) {
      const symbol = rawSymbol.trim().toLowerCase();
      const ticker = bestTickerBySymbol.get(symbol);
      if (!ticker) {
        continue;
      }
      results.push({
        id: ticker.id,
        symbol,
        name: ticker.name,
        priceUsd: ticker.quotes.USD.price,
        changePercent24h: ticker.quotes.USD.percent_change_24h,
        marketCapUsd: ticker.quotes.USD.market_cap,
      });
    }

    return results;
  }

  private async getAllTickers(): Promise<CoinPaprikaTicker[] | undefined> {
    const cached = await this.safeCacheGet<CoinPaprikaTicker[]>(COINPAPRIKA_TICKERS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<CoinPaprikaTicker[]>(`${COINPAPRIKA_API_BASE_URL}/tickers`, {
          params: { quotes: 'USD' },
          timeout: 8000,
        }),
      );
      await this.safeCacheSet(COINPAPRIKA_TICKERS_CACHE_KEY, response.data);
      return response.data;
    } catch (error) {
      this.logger.warn(`CoinPaprika tickers fallback call failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async safeCacheGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.cacheManager.get<T>(key);
    } catch (error) {
      this.logger.warn(`Cache read failed for key "${key}": ${(error as Error).message}`);
      return undefined;
    }
  }

  private async safeCacheSet<T>(key: string, value: T): Promise<void> {
    try {
      await this.cacheManager.set(key, value, this.cacheTtlMs);
    } catch (error) {
      this.logger.warn(`Cache write failed for key "${key}": ${(error as Error).message}`);
    }
  }
}
