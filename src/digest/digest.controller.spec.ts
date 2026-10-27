import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoingeckoService, UnknownCoinSymbolsError } from '../coingecko/coingecko.service';
import { PortfolioTrade } from '../portfolio/interfaces/portfolio.interface';
import { PortfolioService } from '../portfolio/portfolio.service';
import { CoinSignal } from '../signals/interfaces/signal.interface';
import { SignalsStateService } from '../signals/signals-state.service';
import { SignalsSubscriptionsMirror } from '../signals/signals-subscriptions-mirror';
import { SignalsService } from '../signals/signals.service';
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
  let getSignalsForSymbols: jest.Mock;
  let recordSentVerdicts: jest.Mock;
  let recordUsage: jest.Mock;
  let syncAll: jest.Mock;

  const config: Record<string, unknown> = {
    'currency.usdToVndRate': 25400,
    'digest.cronTrackingEnabled': false,
  };

  beforeEach(async () => {
    getPricesBySymbols = jest.fn();
    sendTextMessage = jest.fn().mockResolvedValue(true);
    listActive = jest.fn();
    listTradesForChats = jest.fn().mockResolvedValue(new Map());
    // Signals are off unless a test turns them on, so the older tests still see the digest as before.
    getSignalsForSymbols = jest.fn().mockRejectedValue(new Error('signals not under test'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    recordSentVerdicts = jest.fn().mockResolvedValue(undefined);
    recordUsage = jest.fn().mockResolvedValue(undefined);
    syncAll = jest.fn().mockResolvedValue(undefined);

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
        { provide: SignalsService, useValue: { getSignalsForSymbols, recordSentVerdicts } },
        { provide: SignalsSubscriptionsMirror, useValue: { syncAll } },
        { provide: SignalsStateService, useValue: { recordUsage } },
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

  describe('signals section (EPIC-004)', () => {
    const sub = (chatId: string, watchlist: string[]) => ({
      chatId,
      watchlist,
      isActive: true,
      createdAt: new Date(),
    });
    const coin = (symbol: string, priceUsd: number) => ({
      id: symbol,
      symbol,
      name: symbol.toUpperCase(),
      priceUsd,
      changePercent24h: 1,
    });
    const signal = (symbol: string, strong: boolean): CoinSignal => ({
      symbol,
      result: {
        insufficientData: false,
        change24hPct: strong ? -16 : 1,
        change72hPct: strong ? -12 : 1,
        strong,
        direction: strong ? 'down' : null,
        movePct: strong ? -16 : null,
        window: strong ? '24h' : null,
        rangeLow: 80_000,
        rangeHigh: 120_000,
        positionPct: 10,
        verdict: strong ? 'buy' : null,
        priceUsd: 84_000,
      },
    });
    const messageTo = (chatId: string): string =>
      sendTextMessage.mock.calls.find(([id]) => id === chatId)?.[1] as string;

    beforeEach(() => {
      getSignalsForSymbols.mockResolvedValue([]);
      getPricesBySymbols.mockImplementation(async (symbols: string[]) =>
        symbols.map((symbol) => coin(symbol, 100)),
      );
    });

    it('AC08: adds the "Tín hiệu" part with the verdict for a strong coin, after the prices', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      getSignalsForSymbols.mockResolvedValue([signal('btc', true)]);

      await controller.sendDailyDigest();

      const text = messageTo('chat-a');
      expect(text).toContain('📡 Tín hiệu');
      expect(text).toContain('Cân nhắc mua');
      expect(text.indexOf('Giá') === -1 || text.indexOf('📡') > text.indexOf('BTC (BTC)')).toBe(
        true,
      );
    });

    it('AC08: says "Không có coin nào dao động mạnh" in one line when nothing swings', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      getSignalsForSymbols.mockResolvedValue([signal('btc', false)]);

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toContain('Không có coin nào dao động mạnh');
      expect(recordSentVerdicts).toHaveBeenCalledWith(
        'chat-a',
        [expect.anything()],
        expect.any(Number),
      );
    });

    it('AC08: looks signals up once for all chats, over the union of their watchlists', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc', 'eth']), sub('chat-b', ['eth', 'sol'])]);

      await controller.sendDailyDigest();

      expect(getSignalsForSymbols).toHaveBeenCalledTimes(1);
      expect(getSignalsForSymbols).toHaveBeenCalledWith(['btc', 'eth', 'sol'], expect.any(Number));
    });

    it('syncs the watchlist mirror from the active subscribers', async () => {
      const subscribers = [sub('chat-a', ['btc'])];
      listActive.mockResolvedValue(subscribers);

      await controller.sendDailyDigest();

      expect(syncAll).toHaveBeenCalledWith(subscribers);
    });

    it('AC09: when signals cannot be computed the prices still go out, without the part', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['eth'])]);
      getSignalsForSymbols.mockRejectedValue(new Error('redis down'));

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toBe(formatDailyDigestReply([coin('btc', 100)], 25400));
      expect(messageTo('chat-b')).toBe(formatDailyDigestReply([coin('eth', 100)], 25400));
      expect(recordSentVerdicts).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it('AC09: a failure while building one chat part never touches another chat', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['eth'])]);
      const broken = signal('btc', true);
      (broken as unknown as { result: unknown }).result = null;
      getSignalsForSymbols.mockResolvedValue([broken, signal('eth', true)]);

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toBe(formatDailyDigestReply([coin('btc', 100)], 25400));
      expect(messageTo('chat-b')).toContain('📡 Tín hiệu');
      jest.restoreAllMocks();
    });

    it('records the verdicts and the use only after the digest was delivered', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      getSignalsForSymbols.mockResolvedValue([signal('btc', true)]);

      sendTextMessage.mockResolvedValueOnce(false);
      await controller.sendDailyDigest();
      expect(recordSentVerdicts).not.toHaveBeenCalled();
      expect(recordUsage).not.toHaveBeenCalled();

      sendTextMessage.mockResolvedValueOnce(true);
      await controller.sendDailyDigest();
      expect(recordSentVerdicts).toHaveBeenCalledWith(
        'chat-a',
        [expect.anything()],
        expect.any(Number),
      );
      expect(recordUsage).toHaveBeenCalledWith('chat-a', 'digest', expect.any(Number));
    });

    it('does not count a delivered digest as failed when the bookkeeping throws', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      listActive.mockResolvedValue([sub('chat-a', ['btc'])]);
      getSignalsForSymbols.mockResolvedValue([signal('btc', true)]);
      recordSentVerdicts.mockRejectedValue(new Error('redis'));
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await controller.sendDailyDigest();

      const summary = log.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('daily-digest-run'))!;
      expect(JSON.parse(summary)).toMatchObject({ sent: 1, failed: 0, signalSections: 1 });
      jest.restoreAllMocks();
    });

    it('has no signals part for a chat none of whose coins were priced (verify finding 9)', async () => {
      listActive.mockResolvedValue([sub('chat-a', ['btc']), sub('chat-b', ['eth'])]);
      getSignalsForSymbols.mockResolvedValue([signal('eth', false)]);

      await controller.sendDailyDigest();

      expect(messageTo('chat-a')).toBe(formatDailyDigestReply([coin('btc', 100)], 25400));
      expect(messageTo('chat-b')).toContain('Không có coin nào dao động mạnh');
    });

    it('a chat that is not subscribed gets no digest and no signals (AC08)', async () => {
      listActive.mockResolvedValue([]);

      await controller.sendDailyDigest();

      expect(sendTextMessage).not.toHaveBeenCalled();
      expect(getSignalsForSymbols).not.toHaveBeenCalled();
    });
  });
});
