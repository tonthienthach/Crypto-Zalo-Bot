import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { CoinPaprikaService } from '../coinpaprika/coinpaprika.service';
import {
  DEFAULT_TOP_MARKETS_LIMIT,
  SYMBOL_TO_COINGECKO_ID,
  VS_CURRENCY,
} from './coingecko.constants';
import {
  CoinGeckoMarketChartResponse,
  CoinGeckoMarketCoin,
  CoinGeckoSimplePriceResponse,
  CoinMarketData,
  MarketChartPoint,
} from './interfaces/coingecko-response.interface';

/**
 * Thrown whenever CoinGecko can't be reached or returns no usable data.
 * Callers (CommandParser consumers / WebhookController) catch this and turn
 * it into a friendly chat message instead of letting it bubble up raw.
 */
export class CoingeckoUnavailableError extends Error {}

/** CoinGecko answered 404 for a coin id: it does not know the coin (it may still be known to CoinPaprika). */
export class CoingeckoCoinNotFoundError extends CoingeckoUnavailableError {}

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
    private readonly coinPaprikaService: CoinPaprikaService,
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
    const resolvedSymbols = new Set<string>();
    for (const [id, entry] of Object.entries(data)) {
      const symbol = idToSymbol.get(id) ?? id;
      resolvedSymbols.add(symbol);
      results.push({
        id,
        symbol,
        name: symbol.toUpperCase(),
        priceUsd: entry.usd,
        changePercent24h: entry.usd_24h_change ?? null,
        marketCapUsd: entry.usd_market_cap,
      });
    }

    // CoinGecko didn't know one or more symbols (missing from
    // SYMBOL_TO_COINGECKO_ID, or genuinely absent) — fall back to
    // CoinPaprika's free ticker snapshot for just those before giving up.
    const unresolvedSymbols = uniqueSymbols.filter((symbol) => !resolvedSymbols.has(symbol));
    if (unresolvedSymbols.length > 0) {
      const fallbackResults = await this.coinPaprikaService.getPricesBySymbols(unresolvedSymbols);
      results.push(...fallbackResults);
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

  /**
   * Price history for one symbol, oldest first. CoinGecko returns hourly
   * points for 2-90 days. Not cached (the response is large and callers
   * ask once per coin) and CoinGecko-only: CoinPaprika's free tier has no
   * history. Any failure — including an unknown coin or a rate limit —
   * throws CoingeckoUnavailableError.
   */
  async getMarketChart(symbol: string, days: number): Promise<MarketChartPoint[]> {
    const id = this.resolveSymbolToId(symbol);
    try {
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoMarketChartResponse>(
          `${this.baseUrl}/coins/${encodeURIComponent(id)}/market_chart`,
          {
            params: { vs_currency: VS_CURRENCY, days },
            headers: this.apiKeyHeaders(),
            timeout: 8000,
          },
        ),
      );
      const prices = response.data?.prices;
      if (!Array.isArray(prices) || prices.length === 0) {
        throw new Error('empty price history');
      }
      return prices.map(([t, p]) => ({ t, p }));
    } catch (error) {
      this.logger.error(
        `CoinGecko market_chart call failed for ${id}: ${(error as Error).message}`,
      );
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        throw new CoingeckoCoinNotFoundError(`CoinGecko has no price history for ${id}`);
      }
      throw new CoingeckoUnavailableError(`Failed to fetch price history for ${id} from CoinGecko`);
    }
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
