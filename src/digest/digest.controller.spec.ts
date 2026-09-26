import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoingeckoService, UnknownCoinSymbolsError } from '../coingecko/coingecko.service';
import { PortfolioTrade } from '../portfolio/interfaces/portfolio.interface';
import { PortfolioService } from '../portfolio/portfolio.service';
import { SubscribersService } from '../subscribers/subscribers.service';
import { formatDailyDigestReply } from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { DigestController } from './digest.controller';

describe('DigestController', () => {
  let controller: DigestController;
  let getPricesBySymbols: jest.Mock;
  let sendTextMessage: jest.Mock;
  let listActive: jest.Mock;
  let listTradesForChats: jest.Mock;

  const config: Record<string, unknown> = {
    'currency.usdToVndRate': 25400,
    'digest.cronTrackingEnabled': false,
  };

  beforeEach(async () => {
    getPricesBySymbols = jest.fn();
    sendTextMessage = jest.fn().mockResolvedValue(true);
    listActive = jest.fn();
    listTradesForChats = jest.fn().mockResolvedValue(new Map());

    const moduleRef = await Test.createTestingModule({
      controllers: [DigestController],
      providers: [
        {
          provide: CoingeckoService,
          useValue: { getPricesBySymbols, resolveSymbolToId: (symbol: string) => symbol },
        },
        { provide: ZaloService, useValue: { sendTextMessage } },
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
        { provide: SubscribersService, useValue: { listActive } },
        { provide: PortfolioService, useValue: { listTradesForChats } },
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

  describe('portfolio section (EPIC-003)', () => {
    const at = new Date('2026-09-25T00:00:00.000Z');
    function trade(
      seq: number,
      side: 'buy' | 'sell',
      symbol: string,
      quantity: string,
      priceUsd: number,
    ): PortfolioTrade {
      return { seq, side, symbol, quantity, priceUsd, createdAt: at };
    }
    function coin(symbol: string, priceUsd: number, changePercent24h: number | null = 1) {
      return { id: symbol, symbol, name: symbol.toUpperCase(), priceUsd, changePercent24h };
    }
    const sub = (chatId: string, watchlist: string[]) => ({
      chatId,
      watchlist,
      isActive: true,
      createdAt: at,
    });
    function messageTo(chatId: string): string {
      const call = sendTextMessage.mock.calls.find((c) => c[0] === chatId);
      return call ? String(call[1]) : '';
    }

    it('AC10: A gets a portfolio part, B gets exactly the old digest, C (not subscribed) nothing', async () => {
      // C has a portfolio but no subscription, so listActive never returns it.
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['btc'])]);
      listTradesForChats.mockResolvedValue(
        new Map([
          ['chat-a', [trade(1, 'buy', 'btc', '0.5', 60000), trade(2, 'buy', 'eth', '10', 2000)]],
        ]),
      );
      getPricesBySymbols.mockImplementation(async (symbols: string[]) =>
        symbols.map((symbol) => coin(symbol, symbol === 'btc' ? 70000 : 2500)),
      );

      await controller.sendDailyDigest();

      expect(listTradesForChats).toHaveBeenCalledTimes(1);
      expect(listTradesForChats).toHaveBeenCalledWith(['chat-a', 'chat-b']);
      // One lookup per subscriber: A's is the watchlist plus its held coins.
      expect(getPricesBySymbols).toHaveBeenCalledTimes(2);
      expect(getPricesBySymbols).toHaveBeenCalledWith(['btc', 'eth']);
      const a = messageTo('chat-a');
      expect(a).toContain('💼 Danh mục: $60,000.00');
      expect(a).toContain('Lãi/lỗ chưa chốt');
      expect(a).toContain('Biến động 24h');
      // The watchlist part lists only the watchlist coin, not the held ETH.
      expect(a).not.toContain('(ETH):');
      expect(messageTo('chat-b')).toBe(formatDailyDigestReply([coin('btc', 70000)], 25400));
      expect(sendTextMessage).not.toHaveBeenCalledWith('chat-c', expect.anything());
    });

    it('a chat whose coins are all sold gets the plain digest', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      listTradesForChats.mockResolvedValue(
        new Map([
          ['chat-a', [trade(1, 'buy', 'sol', '1', 100), trade(2, 'sell', 'sol', '1', 120)]],
        ]),
      );
      getPricesBySymbols.mockResolvedValue([coin('btc', 70000)]);

      await controller.sendDailyDigest();

      expect(getPricesBySymbols).toHaveBeenCalledWith(['btc']);
      expect(messageTo('chat-a')).toBe(formatDailyDigestReply([coin('btc', 70000)], 25400));
    });

    it('AC11: a portfolio that fails to compute still sends the watchlist, and the run log counts it', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['eth'])]);
      // A sells more than it bought: the trades can't be replayed.
      listTradesForChats.mockResolvedValue(
        new Map([
          ['chat-a', [trade(1, 'buy', 'btc', '0.5', 60000), trade(2, 'sell', 'btc', '1', 60000)]],
          ['chat-b', [trade(1, 'buy', 'eth', '1', 2000)]],
        ]),
      );
      getPricesBySymbols.mockImplementation(async (symbols: string[]) =>
        symbols.map((symbol) => coin(symbol, 100)),
      );

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toContain('(BTC):');
      expect(messageTo('chat-a')).toContain('Danh mục: tạm thời không có số liệu');
      expect(messageTo('chat-b')).toContain('💼 Danh mục: $100.00');
      const runLine = log.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('daily-digest-run'));
      expect(JSON.parse(runLine!)).toEqual(
        expect.objectContaining({
          event: 'daily-digest-run',
          subscribers: 2,
          sent: 2,
          failed: 0,
          portfolioSections: 1,
          portfolioFailures: 1,
          portfolioLoadFailed: false,
        }),
      );
      jest.restoreAllMocks();
    });

    it('NFR09: a send Zalo refused counts as failed in the run log, not as sent', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['btc'])]);
      getPricesBySymbols.mockResolvedValue([coin('btc', 70000)]);
      sendTextMessage.mockResolvedValueOnce(false);

      await controller.sendDailyDigest();

      const runLine = log.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('daily-digest-run'));
      expect(JSON.parse(runLine!)).toEqual(expect.objectContaining({ sent: 1, failed: 1 }));
      jest.restoreAllMocks();
    });

    it('AC11: when loading the portfolios fails, everyone gets their digest as before', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      listTradesForChats.mockRejectedValue(new Error('neon down'));
      getPricesBySymbols.mockResolvedValue([coin('btc', 70000)]);

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toBe(formatDailyDigestReply([coin('btc', 70000)], 25400));
      jest.restoreAllMocks();
    });

    it('a held coin with no price is noted in the portfolio part', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      listTradesForChats.mockResolvedValue(
        new Map([
          ['chat-a', [trade(1, 'buy', 'btc', '1', 60000), trade(2, 'buy', 'tiny', '5', 1)]],
        ]),
      );
      getPricesBySymbols.mockResolvedValue([coin('btc', 70000)]);

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toContain('Tổng chưa gồm TINY');
    });

    it('a watchlist of only unknown coins sends nothing, even when a held coin is priced', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['nosuchcoin'])]);
      listTradesForChats.mockResolvedValue(
        new Map([['chat-a', [trade(1, 'buy', 'btc', '1', 60000)]]]),
      );
      getPricesBySymbols.mockResolvedValue([coin('btc', 70000)]);

      await controller.sendDailyDigest();

      expect(sendTextMessage).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });
  });
});
