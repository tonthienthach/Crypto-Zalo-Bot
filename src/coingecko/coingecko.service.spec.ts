import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from './coingecko.service';

describe('CoingeckoService', () => {
  let service: CoingeckoService;
  let httpGet: jest.Mock;
  let cacheGet: jest.Mock;
  let cacheSet: jest.Mock;

  const config: Record<string, unknown> = {
    'coingecko.apiBaseUrl': 'https://api.coingecko.com/api/v3',
    'coingecko.apiKey': '',
    'coingecko.cacheTtlSeconds': 30,
  };

  beforeEach(async () => {
    httpGet = jest.fn();
    cacheGet = jest.fn().mockResolvedValue(undefined);
    cacheSet = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoingeckoService,
        { provide: HttpService, useValue: { get: httpGet } },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        { provide: CACHE_MANAGER, useValue: { get: cacheGet, set: cacheSet } },
      ],
    }).compile();

    service = moduleRef.get(CoingeckoService);
  });

  describe('resolveSymbolToId', () => {
    it('maps a known ticker to its CoinGecko id', () => {
      expect(service.resolveSymbolToId('btc')).toBe('bitcoin');
      expect(service.resolveSymbolToId('BTC')).toBe('bitcoin');
    });

    it('falls back to the lowercase symbol for unknown tickers', () => {
      expect(service.resolveSymbolToId('unknowncoin')).toBe('unknowncoin');
    });
  });

  describe('getPricesBySymbols', () => {
    it('returns normalized market data for known symbols', async () => {
      httpGet.mockReturnValueOnce(
        of({
          data: {
            bitcoin: { usd: 65000, usd_24h_change: 2.5, usd_market_cap: 1_000_000_000 },
          },
        }),
      );

      const result = await service.getPricesBySymbols(['btc']);

      expect(result).toEqual([
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'BTC',
          priceUsd: 65000,
          changePercent24h: 2.5,
          marketCapUsd: 1_000_000_000,
        },
      ]);
      expect(cacheSet).toHaveBeenCalled();
    });

    it('serves from cache without calling the HTTP API again', async () => {
      cacheGet.mockResolvedValueOnce({
        bitcoin: { usd: 65000, usd_24h_change: 2.5 },
      });

      const result = await service.getPricesBySymbols(['btc']);

      expect(httpGet).not.toHaveBeenCalled();
      expect(result[0].priceUsd).toBe(65000);
    });

    it('throws UnknownCoinSymbolsError when CoinGecko returns no data', async () => {
      httpGet.mockReturnValueOnce(of({ data: {} }));

      await expect(service.getPricesBySymbols(['doesnotexist'])).rejects.toBeInstanceOf(
        UnknownCoinSymbolsError,
      );
    });

    it('throws CoingeckoUnavailableError when the HTTP call fails', async () => {
      httpGet.mockReturnValueOnce(throwError(() => new Error('network down')));

      await expect(service.getPricesBySymbols(['btc'])).rejects.toBeInstanceOf(
        CoingeckoUnavailableError,
      );
    });

    it('never throws when the cache itself is broken', async () => {
      cacheGet.mockRejectedValueOnce(new Error('cache exploded'));
      cacheSet.mockRejectedValueOnce(new Error('cache exploded'));
      httpGet.mockReturnValueOnce(of({ data: { bitcoin: { usd: 65000 } } }));

      const result = await service.getPricesBySymbols(['btc']);
      expect(result[0].priceUsd).toBe(65000);
    });
  });

  describe('getTopMarkets', () => {
    it('returns normalized market data ordered by market cap', async () => {
      httpGet.mockReturnValueOnce(
        of({
          data: [
            {
              id: 'bitcoin',
              symbol: 'btc',
              name: 'Bitcoin',
              current_price: 65000,
              market_cap: 1_000_000_000,
              market_cap_rank: 1,
              price_change_percentage_24h: 2.5,
            },
          ],
        }),
      );

      const result = await service.getTopMarkets(1);

      expect(result).toEqual([
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          priceUsd: 65000,
          changePercent24h: 2.5,
          marketCapUsd: 1_000_000_000,
        },
      ]);
    });
  });
});
