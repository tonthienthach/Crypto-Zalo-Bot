process.env.NODE_ENV = 'test';
process.env.ZALO_BOT_TOKEN = 'test-bot-token';
process.env.ZALO_API_BASE_URL = 'https://bot-api.zaloplatforms.com/bot';
process.env.WEBHOOK_SECRET_TOKEN = 'test-webhook-secret-1234';
process.env.COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3';
process.env.USD_TO_VND_RATE = '25400';
process.env.THROTTLE_TTL_SECONDS = '10';
process.env.THROTTLE_LIMIT = '100';
process.env.CRON_SECRET_TOKEN = 'test-cron-secret-1234';
process.env.DIGEST_CHAT_ID = 'test-digest-chat-id';
// Syntactically valid only — SubscribersService is overridden below, so this
// is never actually connected to; it only has to satisfy env.validation.ts's
// postgres/postgresql URI shape check.
process.env.POSTGRES_URL = 'postgres://test:test@localhost:5432/test';
// Same for Upstash Redis — PriceAlertsService is overridden below, so these
// only have to pass env.validation.ts.
process.env.KV_REST_API_URL = 'https://test-redis.upstash.io';
process.env.KV_REST_API_TOKEN = 'test-redis-token';
process.env.PRICE_ALERTS_CRON_SECRET = 'test-price-alerts-secret-1234';
process.env.PRICE_ALERTS_WATCH_SECRET = 'test-price-alerts-watch-secret-1234';
// OWNER_CHAT_ID deliberately unset: the app must boot without it (EPIC-002-FIX-AC11).
delete process.env.OWNER_CHAT_ID;

import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CoingeckoService,
  CoingeckoUnavailableError,
  UnknownCoinSymbolsError,
} from '../src/coingecko/coingecko.service';
import {
  PortfolioLimitError,
  PortfolioOversellError,
  PortfolioService,
  PortfolioUnavailableError,
} from '../src/portfolio/portfolio.service';
import {
  AlertConditionAlreadyMetError,
  AlertNotFoundError,
  PriceAlertsService,
} from '../src/price-alerts/price-alerts.service';
import { SubscribersService } from '../src/subscribers/subscribers.service';
import { ZaloService } from '../src/zalo/zalo.service';

describe('WebhookController (e2e)', () => {
  let app: INestApplication;
  const sendTextMessage = jest.fn().mockResolvedValue(undefined);
  const getPricesBySymbols = jest.fn();
  const getTopMarkets = jest.fn();
  const subscribe = jest.fn();
  const unsubscribe = jest.fn().mockResolvedValue(undefined);
  const updateWatchlist = jest.fn();
  const findActiveByChatId = jest.fn();
  const createAlert = jest.fn();
  const listByChat = jest.fn();
  const deleteByIndex = jest.fn();
  const listAll = jest.fn();
  const acquireRunLock = jest.fn();
  const recordRun = jest.fn().mockResolvedValue(undefined);
  const recordRejections = jest.fn().mockResolvedValue(undefined);
  const getMonitorState = jest.fn();
  const setMonitorState = jest.fn().mockResolvedValue(undefined);
  const listRecentRuns = jest.fn();
  const recordTrade = jest.fn();
  const listTrades = jest.fn();
  const listTradesPage = jest.fn();
  const deleteTrade = jest.fn();
  const clearTrades = jest.fn();
  const listTradesForChats = jest.fn();
  const resolveSymbolToId = jest.fn((symbol: string) => symbol);

  const SECRET = process.env.WEBHOOK_SECRET_TOKEN as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ZaloService)
      .useValue({ sendTextMessage })
      .overrideProvider(CoingeckoService)
      .useValue({ getPricesBySymbols, getTopMarkets, resolveSymbolToId })
      .overrideProvider(SubscribersService)
      .useValue({ subscribe, unsubscribe, updateWatchlist, findActiveByChatId })
      .overrideProvider(PriceAlertsService)
      .useValue({
        create: createAlert,
        listByChat,
        deleteByIndex,
        listAll,
        acquireRunLock,
        recordRun,
        recordRejections,
        getMonitorState,
        setMonitorState,
        listRecentRuns,
      })
      .overrideProvider(PortfolioService)
      .useValue({
        recordTrade,
        listTrades,
        listTradesPage,
        deleteTrade,
        clearTrades,
        listTradesForChats,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GET /health returns ok status', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('rejects webhook calls without the correct secret', async () => {
    await request(app.getHttpServer())
      .post('/webhook')
      .send({
        event_name: 'message.text.received',
        message: { text: '/gia btc', chat: { id: '123' } },
      })
      .expect(401);
  });

  it('acknowledges and replies with a price for "/gia btc"', async () => {
    getPricesBySymbols.mockResolvedValue([
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'BTC',
        priceUsd: 65000,
        changePercent24h: 2.5,
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/gia btc', chat: { id: 'chat-1', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(getPricesBySymbols).toHaveBeenCalledWith(['btc']);
    expect(sendTextMessage).toHaveBeenCalledWith('chat-1', expect.stringContaining('BTC'));
  });

  it('replies with top markets for "/gia" with no symbols', async () => {
    getTopMarkets.mockResolvedValue([
      {
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        priceUsd: 65000,
        changePercent24h: 2.5,
      },
    ]);

    await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/gia', chat: { id: 'chat-2', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(getTopMarkets).toHaveBeenCalled();
    expect(sendTextMessage).toHaveBeenCalledWith('chat-2', expect.stringContaining('Top'));
  });

  it('always acks with 200 even when the price lookup throws', async () => {
    getPricesBySymbols.mockRejectedValue(new Error('boom'));

    const response = await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/gia btc', chat: { id: 'chat-3', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(sendTextMessage).toHaveBeenCalledWith('chat-3', expect.any(String));
  });

  it('acks silently when the payload has no message', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({ event_name: 'bot_added' })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('subscribes and confirms the watchlist for "/dangky btc eth"', async () => {
    subscribe.mockResolvedValue({
      chatId: 'chat-4',
      watchlist: ['btc', 'eth'],
      isActive: true,
      createdAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/dangky btc eth', chat: { id: 'chat-4', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(subscribe).toHaveBeenCalledWith('chat-4', ['btc', 'eth']);
    expect(sendTextMessage).toHaveBeenCalledWith('chat-4', expect.stringContaining('BTC'));
  });

  it('subscribes with the default watchlist for "/dangky" with no symbols', async () => {
    subscribe.mockResolvedValue({
      chatId: 'chat-4b',
      watchlist: ['btc', 'eth'],
      isActive: true,
      createdAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/dangky', chat: { id: 'chat-4b', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(subscribe).toHaveBeenCalledWith('chat-4b', ['btc', 'eth']);
  });

  it('unsubscribes and confirms for "/huy"', async () => {
    await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/huy', chat: { id: 'chat-5', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(unsubscribe).toHaveBeenCalledWith('chat-5');
    expect(sendTextMessage).toHaveBeenCalledWith('chat-5', expect.stringContaining('Đã hủy'));
  });

  it('shows the current watchlist for "/watchlist" with no symbols', async () => {
    findActiveByChatId.mockResolvedValue({
      chatId: 'chat-6',
      watchlist: ['sol'],
      isActive: true,
      createdAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/watchlist', chat: { id: 'chat-6', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(findActiveByChatId).toHaveBeenCalledWith('chat-6');
    expect(sendTextMessage).toHaveBeenCalledWith('chat-6', expect.stringContaining('SOL'));
  });

  it('replies "not subscribed" for "/watchlist <symbols>" from a chat with no active subscription', async () => {
    updateWatchlist.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/webhook')
      .set('x-bot-api-secret-token', SECRET)
      .send({
        event_name: 'message.text.received',
        message: { text: '/watchlist sol', chat: { id: 'chat-7', chat_type: 'PRIVATE' } },
      })
      .expect(200);

    expect(updateWatchlist).toHaveBeenCalledWith('chat-7', ['sol']);
    expect(sendTextMessage).toHaveBeenCalledWith('chat-7', expect.stringContaining('chưa đăng ký'));
  });

  describe('/canhbao (price alerts)', () => {
    const alert = {
      id: 1,
      chatId: 'chat-a1',
      symbol: 'btc',
      direction: 'above',
      threshold: 100000,
      state: 'armed',
      lastFiredAt: null,
      createdAt: '2026-09-23T00:00:00.000Z',
    };

    const sendText = (text: string, chatId: string) =>
      request(app.getHttpServer())
        .post('/webhook')
        .set('x-bot-api-secret-token', SECRET)
        .send({ event_name: 'message.text.received', message: { text, chat: { id: chatId } } })
        .expect(200);

    it('creates an alert and confirms with its position and current price (AC01)', async () => {
      createAlert.mockResolvedValue({ alert, position: 1, currentPriceUsd: 95000 });

      await sendText('/canhbao btc > 100000', 'chat-a1');

      expect(createAlert).toHaveBeenCalledWith('chat-a1', 'btc', 'above', 100000);
      expect(sendTextMessage).toHaveBeenCalledWith('chat-a1', expect.stringContaining('#1'));
      expect(sendTextMessage).toHaveBeenCalledWith(
        'chat-a1',
        expect.stringContaining('$95,000.00'),
      );
    });

    it('replies with the current price when the condition is already met (AC07)', async () => {
      createAlert.mockRejectedValue(new AlertConditionAlreadyMetError('btc', 'above', 110000));

      await sendText('/canhbao btc > 100000', 'chat-a2');

      expect(sendTextMessage).toHaveBeenCalledWith(
        'chat-a2',
        expect.stringContaining('$110,000.00'),
      );
    });

    it('rejects invalid syntax with an example, without creating anything (AC08)', async () => {
      await sendText('/canhbao btc > 100k', 'chat-a3');

      expect(createAlert).not.toHaveBeenCalled();
      expect(sendTextMessage).toHaveBeenCalledWith(
        'chat-a3',
        expect.stringContaining('/canhbao btc > 100000'),
      );
    });

    it('replies like /gia for an unknown coin (AC09)', async () => {
      createAlert.mockRejectedValue(new UnknownCoinSymbolsError(['xyzabc']));

      await sendText('/canhbao xyzabc > 1', 'chat-a4');

      expect(sendTextMessage).toHaveBeenCalledWith('chat-a4', expect.stringContaining('XYZABC'));
    });

    it('lists and deletes the chat own alerts, and reports a missing position (AC11)', async () => {
      listByChat.mockResolvedValue([alert]);
      await sendText('/canhbao', 'chat-a5');
      expect(listByChat).toHaveBeenCalledWith('chat-a5');
      expect(sendTextMessage).toHaveBeenCalledWith('chat-a5', expect.stringContaining('1. BTC >'));

      deleteByIndex.mockResolvedValue(alert);
      await sendText('/canhbao xoa 1', 'chat-a5');
      expect(deleteByIndex).toHaveBeenCalledWith('chat-a5', 1);

      deleteByIndex.mockRejectedValue(new AlertNotFoundError(99));
      await sendText('/canhbao xoa 99', 'chat-a5');
      expect(sendTextMessage).toHaveBeenCalledWith('chat-a5', expect.stringContaining('#99'));
    });

    it('leaves alerts alone when the chat unsubscribes from the digest (AC19)', async () => {
      await sendText('/huy', 'chat-a6');

      expect(unsubscribe).toHaveBeenCalledWith('chat-a6');
      expect(createAlert).not.toHaveBeenCalled();
      expect(deleteByIndex).not.toHaveBeenCalled();
      expect(listByChat).not.toHaveBeenCalled();
    });

    // DTO validation failures are the one documented non-2xx webhook answer
    // (docs/API.md: malformed bodies -> 400, before the controller runs).
    it('rejects a chat id longer than 64 chars with 400, persisting nothing (NFR06)', async () => {
      await request(app.getHttpServer())
        .post('/webhook')
        .set('x-bot-api-secret-token', SECRET)
        .send({
          event_name: 'message.text.received',
          message: { text: '/canhbao btc > 100000', chat: { id: 'x'.repeat(65) } },
        })
        .expect(400);

      expect(createAlert).not.toHaveBeenCalled();
      expect(sendTextMessage).not.toHaveBeenCalled();
    });
  });

  describe('GET /cron/price-alerts', () => {
    it('rejects a call with no secret or a wrong secret, evaluating nothing (AC16)', async () => {
      await request(app.getHttpServer()).get('/cron/price-alerts').expect(401);
      await request(app.getHttpServer())
        .get('/cron/price-alerts')
        .set('x-cron-secret-token', 'wrong-secret-0000')
        .expect(401);
      // The digest secret must not open the price-alert endpoint (separate secrets).
      await request(app.getHttpServer())
        .get('/cron/price-alerts')
        .set('x-cron-secret-token', process.env.CRON_SECRET_TOKEN as string)
        .expect(401);

      expect(acquireRunLock).not.toHaveBeenCalled();
      expect(listAll).not.toHaveBeenCalled();
      // Counted (at most one write a minute), never with the secret that was sent (FIX-AC03).
      expect(recordRejections.mock.calls.length).toBeLessThanOrEqual(1);
      expect(JSON.stringify(recordRejections.mock.calls)).not.toContain('wrong-secret');
      expect(recordRun).not.toHaveBeenCalled();
    });

    it('runs the check for the scheduler secret sent as a header', async () => {
      acquireRunLock.mockResolvedValue(false);

      await request(app.getHttpServer())
        .get('/cron/price-alerts')
        .set('x-cron-secret-token', process.env.PRICE_ALERTS_CRON_SECRET as string)
        .expect(200, { ok: true });

      expect(acquireRunLock).toHaveBeenCalled();
      expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'skipped' }));
    });
  });

  describe('GET /cron/price-alerts-watch (EPIC-002-FIX)', () => {
    it('rejects the digest secret, the check secret and no secret, sending nothing (FIX-AC20)', async () => {
      for (const secret of [
        process.env.CRON_SECRET_TOKEN as string,
        process.env.PRICE_ALERTS_CRON_SECRET as string,
      ]) {
        await request(app.getHttpServer())
          .get('/cron/price-alerts-watch')
          .set('x-cron-secret-token', secret)
          .expect(401);
      }
      await request(app.getHttpServer()).get('/cron/price-alerts-watch').expect(401);

      expect(getMonitorState).not.toHaveBeenCalled();
      expect(sendTextMessage).not.toHaveBeenCalled();
    });

    it('runs the watcher for its own secret, as a header or bearer token, and answers 200', async () => {
      getMonitorState.mockResolvedValue(null);
      listRecentRuns.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/cron/price-alerts-watch')
        .set('x-cron-secret-token', process.env.PRICE_ALERTS_WATCH_SECRET as string)
        .expect(200, { ok: true });
      await request(app.getHttpServer())
        .post('/cron/price-alerts-watch')
        .set('authorization', `Bearer ${process.env.PRICE_ALERTS_WATCH_SECRET}`)
        .expect(200, { ok: true });

      expect(setMonitorState).toHaveBeenCalledWith(
        expect.objectContaining({ ownerChatConfigured: false, outage: null }),
      );
      expect(sendTextMessage).not.toHaveBeenCalled();
    });

    it('still answers 200 when Redis fails', async () => {
      getMonitorState.mockRejectedValue(new Error('redis down'));

      await request(app.getHttpServer())
        .get('/cron/price-alerts-watch')
        .set('x-cron-secret-token', process.env.PRICE_ALERTS_WATCH_SECRET as string)
        .expect(200, { ok: true });
    });
  });

  describe('/danhmuc (EPIC-003)', () => {
    const PRIVATE_CHAT = { id: 'pf-chat', chat_type: 'PRIVATE' };
    const at = new Date('2026-09-25T02:00:00.000Z');
    const btcBuy = {
      seq: 1,
      side: 'buy',
      symbol: 'btc',
      quantity: '0.5',
      priceUsd: 60000,
      createdAt: at,
    };

    function send(text: string, chat: Record<string, unknown> = PRIVATE_CHAT, messageId?: string) {
      return request(app.getHttpServer())
        .post('/webhook')
        .set('x-bot-api-secret-token', SECRET)
        .send({
          event_name: 'message.text.received',
          message: { text, chat, ...(messageId ? { message_id: messageId } : {}) },
        })
        .expect(200, { ok: true });
    }

    function reply(): string {
      return sendTextMessage.mock.calls.map((call) => String(call[1])).join('\n');
    }

    const portfolioMocks = [
      recordTrade,
      listTrades,
      listTradesPage,
      deleteTrade,
      clearTrades,
      listTradesForChats,
    ];

    beforeEach(() => {
      for (const mock of portfolioMocks) mock.mockReset();
    });

    it('AC01: records a buy after checking the coin, and confirms it', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockResolvedValue({ trade: btcBuy, trades: [btcBuy] });

      await send('/danhmuc mua btc 0.5 60000');

      expect(getPricesBySymbols).toHaveBeenCalledWith(['btc']);
      expect(recordTrade).toHaveBeenCalledWith('pf-chat', 'buy', 'btc', '0.5', 60000, undefined);
      expect(reply()).toContain('#1 Mua 0.5 BTC × $60,000.00');
      expect(reply()).toContain('Đang giữ: 0.5 BTC, giá vốn TB $60,000.00');
    });

    it('a redelivered webhook (same message_id) is passed on, and the reply says it was not recorded again', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockResolvedValue({ trade: btcBuy, trades: [btcBuy], duplicate: true });

      await send('/danhmuc mua btc 0.5 60000', PRIVATE_CHAT, '02b8d8946c41fe18a757');

      expect(recordTrade).toHaveBeenCalledWith(
        'pf-chat',
        'buy',
        'btc',
        '0.5',
        60000,
        '02b8d8946c41fe18a757',
      );
      expect(reply()).toContain('đã được ghi trước đó, không ghi lại');
      expect(reply()).not.toContain('Giống hệt');
    });

    it('the same trade sent twice within 2 minutes is recorded twice (AC19), and the reply flags it', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      const second = { ...btcBuy, seq: 2, createdAt: new Date(at.getTime() + 30_000) };
      recordTrade.mockResolvedValue({ trade: second, trades: [btcBuy, second], duplicate: false });

      await send('/danhmuc mua btc 0.5 60000', PRIVATE_CHAT, 'msg-second');

      expect(reply()).toContain('✅ Đã ghi giao dịch #2');
      expect(reply()).toContain('Giống hệt giao dịch #1 vừa ghi');
      expect(reply()).toContain('/danhmuc xoa 2');
    });

    it('AC03: "/danhmuc" prices every held coin in one lookup', async () => {
      listTrades.mockResolvedValue([
        btcBuy,
        { ...btcBuy, seq: 2, quantity: '0.5', priceUsd: 70000 },
        { ...btcBuy, seq: 3, side: 'sell', quantity: '0.4', priceUsd: 80000 },
        { ...btcBuy, seq: 4, symbol: 'eth', quantity: '10', priceUsd: 2000 },
      ]);
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 70000, changePercent24h: 2 },
        { id: 'ethereum', symbol: 'eth', name: 'ETH', priceUsd: 2500, changePercent24h: -5 },
      ]);

      await send('/danhmuc');

      expect(listTrades).toHaveBeenCalledWith('pf-chat');
      expect(getPricesBySymbols).toHaveBeenCalledTimes(1);
      expect(getPricesBySymbols).toHaveBeenCalledWith(['btc', 'eth']);
      expect(reply()).toContain('Tổng giá trị: $67,000.00');
      expect(reply()).toContain('Lãi/lỗ đã chốt: +$6,000.00');
    });

    it('AC04: an oversell is refused with the held quantity', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockRejectedValue(new PortfolioOversellError('btc', '0.6'));

      await send('/danhmuc ban btc 2 80000');

      expect(reply()).toContain('đang giữ 0.6 BTC');
    });

    it('AC05: bad syntax shows the correct syntax and records nothing', async () => {
      await send('/danhmuc mua btc 0.5 60k');

      expect(recordTrade).not.toHaveBeenCalled();
      expect(reply()).toContain('/danhmuc mua btc 0.5 60000');
    });

    it('AC05: a comma in the quantity is refused with the number rule, and records nothing', async () => {
      await send('/danhmuc mua btc 1,500 60,000');

      expect(getPricesBySymbols).not.toHaveBeenCalled();
      expect(recordTrade).not.toHaveBeenCalled();
      expect(reply()).toContain('1.5, không phải 1,5');
    });

    it('AC06: an unknown coin gets the "/gia" unknown-coin reply and records nothing', async () => {
      getPricesBySymbols.mockRejectedValue(new UnknownCoinSymbolsError(['xyzabc']));

      await send('/danhmuc mua xyzabc 10 1');

      expect(recordTrade).not.toHaveBeenCalled();
      expect(reply()).toContain('Không tìm thấy đồng coin: XYZABC');
    });

    it('AC07: an empty portfolio shows an example and calls no price source', async () => {
      listTrades.mockResolvedValue([]);

      await send('/danhmuc');

      expect(getPricesBySymbols).not.toHaveBeenCalled();
      expect(reply()).toContain('/danhmuc mua btc 0.5 60000');
    });

    it('AC08/AC09: history and delete reach the store with the chat id', async () => {
      listTradesPage.mockResolvedValue({ trades: [btcBuy], total: 1, page: 1, pageCount: 1 });
      await send('/danhmuc lichsu');
      expect(listTradesPage).toHaveBeenCalledWith('pf-chat', 1);
      expect(reply()).toContain('#1 Mua 0.5 BTC');

      sendTextMessage.mockClear();
      deleteTrade.mockResolvedValue({ trade: btcBuy, trades: [] });
      await send('/danhmuc xoa 1');
      expect(deleteTrade).toHaveBeenCalledWith('pf-chat', 1);
      expect(reply()).toContain('Đã xoá giao dịch #1');
    });

    it.each([
      ['a group chat', { id: 'group-1', chat_type: 'GROUP' }],
      ['a chat with no chat_type', { id: 'group-2' }],
    ])('AC12: refuses every /danhmuc command in %s, touching no store', async (_label, chat) => {
      await send('/danhmuc', chat);
      await send('/danhmuc mua btc 1 60000', chat);

      for (const mock of portfolioMocks) expect(mock).not.toHaveBeenCalled();
      expect(getPricesBySymbols).not.toHaveBeenCalled();
      expect(sendTextMessage).toHaveBeenCalledTimes(2);
      expect(reply()).toContain('nhắn riêng');
    });

    it('AC13: a price source outage when viewing gets the outage reply and no numbers', async () => {
      listTrades.mockResolvedValue([btcBuy]);
      getPricesBySymbols.mockRejectedValue(new CoingeckoUnavailableError('down'));

      await send('/danhmuc');

      expect(reply()).toContain('Không thể lấy dữ liệu giá lúc này');
      expect(reply()).not.toContain('Tổng giá trị');
    });

    it('AC14: the trade limit is explained', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockRejectedValue(new PortfolioLimitError('trades', 200));

      await send('/danhmuc mua btc 1 1');

      expect(reply()).toContain('tối đa 200 giao dịch');
    });

    it('AC15: "xoahet" alone asks to confirm and deletes nothing; confirmed, it clears', async () => {
      await send('/danhmuc xoahet');
      expect(clearTrades).not.toHaveBeenCalled();
      expect(reply()).toContain('/danhmuc xoahet xacnhan');

      sendTextMessage.mockClear();
      clearTrades.mockResolvedValue(3);
      await send('/danhmuc xoahet xacnhan');
      expect(clearTrades).toHaveBeenCalledWith('pf-chat');
      expect(reply()).toContain('Đã xoá 3 giao dịch');
    });

    it('AC16: no amount the user sent reaches the logs', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(),
      );
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockResolvedValue({ trade: btcBuy, trades: [btcBuy] });
      listTrades.mockResolvedValue([btcBuy]);
      deleteTrade.mockResolvedValue({ trade: btcBuy, trades: [] });

      await send('/danhmuc mua btc 0.5 60000');
      await send('/danhmuc');
      await send('/danhmuc xoa 1');
      await send('/danhmuc mua btc 0.5 60000', { id: 'group-3', chat_type: 'GROUP' });

      const logged = spies
        .flatMap((spy) => spy.mock.calls)
        .map((call) => call.map(String).join(' '))
        .join('\n');
      for (const spy of spies) spy.mockRestore();
      expect(logged).toContain('portfolio-view');
      for (const amount of ['0.5', '60000', '60,000', '65000']) {
        expect(logged).not.toContain(amount);
      }
    });

    it('AC18: "/huy" never touches the portfolio, which still answers afterwards', async () => {
      await send('/huy');
      for (const mock of portfolioMocks) expect(mock).not.toHaveBeenCalled();

      listTrades.mockResolvedValue([]);
      await send('/danhmuc');
      expect(listTrades).toHaveBeenCalledWith('pf-chat');
    });

    it('AC19: a store failure gets a friendly reply and a 200', async () => {
      getPricesBySymbols.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc', name: 'BTC', priceUsd: 65000, changePercent24h: 1 },
      ]);
      recordTrade.mockRejectedValue(new PortfolioUnavailableError());

      await send('/danhmuc mua btc 1 60000');

      expect(reply()).toContain('Tạm thời không truy cập được dữ liệu danh mục');
    });
  });
});
