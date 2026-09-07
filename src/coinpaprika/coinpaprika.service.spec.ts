import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { CoinPaprikaService } from './coinpaprika.service';

describe('CoinPaprikaService', () => {
  let service: CoinPaprikaService;
  let httpGet: jest.Mock;
  let cacheGet: jest.Mock;
  let cacheSet: jest.Mock;

  const tickers = [
    {
      id: 'yield-guild-games',
      name: 'Yield Guild Games',
      symbol: 'YGG',
      rank: 770,
      quotes: { USD: { price: 0.024, market_cap: 23_000_000, percent_change_24h: 1.5 } },
    },
    {
      id: 'doublezero',
      name: 'DoubleZero',
      symbol: '2Z',
      rank: 189,
      quotes: { USD: { price: 0.051, market_cap: 177_000_000, percent_change_24h: -0.6 } },
    },
  ];

  beforeEach(async () => {
    httpGet = jest.fn();
    cacheGet = jest.fn().mockResolvedValue(undefined);
    cacheSet = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoinPaprikaService,
        { provide: HttpService, useValue: { get: httpGet } },
        { provide: ConfigService, useValue: { get: () => 30 } },
        { provide: CACHE_MANAGER, useValue: { get: cacheGet, set: cacheSet } },
      ],
    }).compile();

    service = moduleRef.get(CoinPaprikaService);
  });

  it('returns an empty array immediately for an empty symbol list', async () => {
    expect(await service.getPricesBySymbols([])).toEqual([]);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('resolves symbols against the cached/fetched ticker snapshot', async () => {
    httpGet.mockReturnValueOnce(of({ data: tickers }));

    const result = await service.getPricesBySymbols(['ygg', '2z']);

    expect(result).toEqual([
      {
        id: 'yield-guild-games',
        symbol: 'ygg',
        name: 'Yield Guild Games',
        priceUsd: 0.024,
        changePercent24h: 1.5,
        marketCapUsd: 23_000_000,
      },
      {
        id: 'doublezero',
        symbol: '2z',
        name: 'DoubleZero',
        priceUsd: 0.051,
        changePercent24h: -0.6,
        marketCapUsd: 177_000_000,
      },
    ]);
    expect(cacheSet).toHaveBeenCalled();
  });

  it('serves the ticker snapshot from cache without calling the HTTP API again', async () => {
    cacheGet.mockResolvedValueOnce(tickers);

    const result = await service.getPricesBySymbols(['ygg']);

    expect(httpGet).not.toHaveBeenCalled();
    expect(result[0].priceUsd).toBe(0.024);
  });

  it('omits symbols with no match instead of throwing', async () => {
    httpGet.mockReturnValueOnce(of({ data: tickers }));

    const result = await service.getPricesBySymbols(['doesnotexist']);

    expect(result).toEqual([]);
  });

  it('returns an empty array (never throws) when the HTTP call fails', async () => {
    httpGet.mockReturnValueOnce(throwError(() => new Error('network down')));

    const result = await service.getPricesBySymbols(['ygg']);

    expect(result).toEqual([]);
  });
});
