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

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CoingeckoService, UnknownCoinSymbolsError } from '../src/coingecko/coingecko.service';
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

  const SECRET = process.env.WEBHOOK_SECRET_TOKEN as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ZaloService)
      .useValue({ sendTextMessage })
      .overrideProvider(CoingeckoService)
      .useValue({ getPricesBySymbols, getTopMarkets })
      .overrideProvider(SubscribersService)
      .useValue({ subscribe, unsubscribe, updateWatchlist, findActiveByChatId })
      .overrideProvider(PriceAlertsService)
      .useValue({ create: createAlert, listByChat, deleteByIndex, listAll, acquireRunLock })
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
});
