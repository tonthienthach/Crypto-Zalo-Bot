import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoingeckoService, UnknownCoinSymbolsError } from '../coingecko/coingecko.service';
import { SubscribersService } from '../subscribers/subscribers.service';
import { ZaloService } from '../zalo/zalo.service';
import { DigestController } from './digest.controller';

describe('DigestController', () => {
  let controller: DigestController;
  let getPricesBySymbols: jest.Mock;
  let sendTextMessage: jest.Mock;
  let listActive: jest.Mock;

  const config: Record<string, unknown> = {
    'currency.usdToVndRate': 25400,
    'digest.cronTrackingEnabled': false,
  };

  beforeEach(async () => {
    getPricesBySymbols = jest.fn();
    sendTextMessage = jest.fn().mockResolvedValue(undefined);
    listActive = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [DigestController],
      providers: [
        { provide: CoingeckoService, useValue: { getPricesBySymbols } },
        { provide: ZaloService, useValue: { sendTextMessage } },
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        { provide: SubscribersService, useValue: { listActive } },
      ],
    }).compile();

    controller = moduleRef.get(DigestController);
  });

  it('sends a digest to every active subscriber, each with their own watchlist', async () => {
    listActive.mockResolvedValue([
      { chatId: 'chat-1', watchlist: ['btc'], isActive: true, createdAt: new Date() },
      { chatId: 'chat-2', watchlist: ['eth', 'sol'], isActive: true, createdAt: new Date() },
    ]);
    getPricesBySymbols.mockImplementation(async (symbols: string[]) =>
      symbols.map((symbol) => ({
        id: symbol,
        symbol,
        name: symbol.toUpperCase(),
        priceUsd: 100,
        changePercent24h: 1,
      })),
    );

    const result = await controller.sendDailyDigest();

    expect(result).toEqual({ ok: true });
    expect(getPricesBySymbols).toHaveBeenCalledWith(['btc']);
    expect(getPricesBySymbols).toHaveBeenCalledWith(['eth', 'sol']);
    expect(sendTextMessage).toHaveBeenCalledWith('chat-1', expect.any(String));
    expect(sendTextMessage).toHaveBeenCalledWith('chat-2', expect.any(String));
  });

  it("one subscriber's failure does not block another subscriber's digest", async () => {
    listActive.mockResolvedValue([
      { chatId: 'chat-bad', watchlist: ['unknown'], isActive: true, createdAt: new Date() },
      { chatId: 'chat-good', watchlist: ['btc'], isActive: true, createdAt: new Date() },
    ]);
    getPricesBySymbols.mockImplementation(async (symbols: string[]) => {
      if (symbols.includes('unknown')) {
        throw new UnknownCoinSymbolsError(['unknown']);
      }
      return symbols.map((symbol) => ({
        id: symbol,
        symbol,
        name: symbol.toUpperCase(),
        priceUsd: 100,
        changePercent24h: 1,
      }));
    });

    const result = await controller.sendDailyDigest();

    expect(result).toEqual({ ok: true });
    // The failing subscriber never got a message (their lookup threw)...
    expect(sendTextMessage).not.toHaveBeenCalledWith('chat-bad', expect.anything());
    // ...but the healthy subscriber right after it in the loop still did.
    expect(sendTextMessage).toHaveBeenCalledWith('chat-good', expect.any(String));
  });

  it('still returns { ok: true } when loading the subscriber list itself fails', async () => {
    listActive.mockRejectedValue(new Error('connection refused'));

    const result = await controller.sendDailyDigest();

    expect(result).toEqual({ ok: true });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when there are no active subscribers', async () => {
    listActive.mockResolvedValue([]);

    const result = await controller.sendDailyDigest();

    expect(result).toEqual({ ok: true });
    expect(getPricesBySymbols).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
