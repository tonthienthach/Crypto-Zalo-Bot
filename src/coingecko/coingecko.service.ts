import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import {
  DEFAULT_TOP_MARKETS_LIMIT,
  SYMBOL_TO_COINGECKO_ID,
  VS_CURRENCY,
} from './coingecko.constants';
import {
  CoinGeckoMarketCoin,
  CoinGeckoSimplePriceResponse,
  CoinMarketData,
} from './interfaces/coingecko-response.interface';

/**
 * Thrown whenever CoinGecko can't be reached or returns no usable data.
 * Callers (CommandParser consumers / WebhookController) catch this and turn
 * it into a friendly chat message instead of letting it bubble up raw.
 */
export class CoingeckoUnavailableError extends Error {}

/** Raised when none of the requested symbols could be resolved to a known coin id. */
export class UnknownCoinSymbolsError extends Error {
  constructor(public readonly symbols: string[]) {
    super(`Unknown coin symbols: ${symbols.join(', ')}`);
  }
}

@Injectable()
export class CoingeckoService {
  private readonly logger = new Logger(CoingeckoService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.baseUrl = this.configService.get<string>('coingecko.apiBaseUrl')!;
    this.apiKey = this.configService.get<string>('coingecko.apiKey') ?? '';
    this.cacheTtlMs = (this.configService.get<number>('coingecko.cacheTtlSeconds') ?? 30) * 1000;
  }

  /**
   * Resolves user-provided ticker symbols (e.g. ["btc", "eth"]) to CoinGecko
   * coin ids. Symbols with no known mapping are passed through lowercase as
   * a best-effort id guess.
   */
  resolveSymbolToId(symbol: string): string {
    const normalized = symbol.trim().toLowerCase();
    return SYMBOL_TO_COINGECKO_ID[normalized] ?? normalized;
  }

  /**
   * Fetches current USD price + 24h change for a list of ticker symbols.
   * Cache is "best-effort": on a Vercel cold start the in-memory cache is
   * always empty (fresh Lambda instance), so correctness never depends on a
   * cache hit — see docs/ARCHITECTURE.md.
   */
  async getPricesBySymbols(symbols: string[]): Promise<CoinMarketData[]> {
    const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim().toLowerCase())));
    const idToSymbol = new Map<string, string>();
    for (const symbol of uniqueSymbols) {
      idToSymbol.set(this.resolveSymbolToId(symbol), symbol);
    }
    const ids = Array.from(idToSymbol.keys());

    const cacheKey = `coingecko:simple-price:${ids.slice().sort().join(',')}`;
    const cached = await this.safeCacheGet<CoinGeckoSimplePriceResponse>(cacheKey);
    const data = cached ?? (await this.fetchSimplePrice(ids));
    if (!cached) {
      await this.safeCacheSet(cacheKey, data);
    }

    const results: CoinMarketData[] = [];
    for (const [id, entry] of Object.entries(data)) {
      const symbol = idToSymbol.get(id) ?? id;
      results.push({
        id,
        symbol,
        name: symbol.toUpperCase(),
        priceUsd: entry.usd,
        changePercent24h: entry.usd_24h_change ?? null,
        marketCapUsd: entry.usd_market_cap,
      });
    }

    if (results.length === 0) {
      throw new UnknownCoinSymbolsError(uniqueSymbols);
    }

    return results;
  }

  /** Fetches the top N coins by market capitalization. */
  async getTopMarkets(limit = DEFAULT_TOP_MARKETS_LIMIT): Promise<CoinMarketData[]> {
    const cacheKey = `coingecko:markets:top:${limit}`;
    const cached = await this.safeCacheGet<CoinGeckoMarketCoin[]>(cacheKey);
    const data = cached ?? (await this.fetchMarkets(limit));
    if (!cached) {
      await this.safeCacheSet(cacheKey, data);
    }

    return data.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      priceUsd: coin.current_price,
      changePercent24h: coin.price_change_percentage_24h,
      marketCapUsd: coin.market_cap,
    }));
  }

  private async fetchSimplePrice(ids: string[]): Promise<CoinGeckoSimplePriceResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoSimplePriceResponse>(`${this.baseUrl}/simple/price`, {
          params: {
            ids: ids.join(','),
            vs_currencies: VS_CURRENCY,
            include_market_cap: true,
            include_24hr_change: true,
          },
          headers: this.apiKeyHeaders(),
          timeout: 8000,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`CoinGecko simple/price call failed: ${(error as Error).message}`);
      throw new CoingeckoUnavailableError('Failed to fetch prices from CoinGecko');
    }
  }

  private async fetchMarkets(limit: number): Promise<CoinGeckoMarketCoin[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoMarketCoin[]>(`${this.baseUrl}/coins/markets`, {
          params: {
            vs_currency: VS_CURRENCY,
            order: 'market_cap_desc',
            per_page: limit,
            page: 1,
            sparkline: false,
          },
          headers: this.apiKeyHeaders(),
          timeout: 8000,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`CoinGecko coins/markets call failed: ${(error as Error).message}`);
      throw new CoingeckoUnavailableError('Failed to fetch top markets from CoinGecko');
    }
  }

  private apiKeyHeaders(): Record<string, string> {
    return this.apiKey ? { 'x-cg-demo-api-key': this.apiKey } : {};
  }

  /** Cache reads/writes never throw — a cache outage must never break a price lookup. */
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
