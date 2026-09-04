process.env.NODE_ENV = 'test';
process.env.ZALO_BOT_TOKEN = 'test-bot-token';
process.env.ZALO_API_BASE_URL = 'https://bot-api.zaloplatforms.com/bot';
process.env.WEBHOOK_SECRET_TOKEN = 'test-webhook-secret-1234';
process.env.COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3';
process.env.USD_TO_VND_RATE = '25400';
process.env.THROTTLE_TTL_SECONDS = '10';
process.env.THROTTLE_LIMIT = '100';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CoingeckoService } from '../src/coingecko/coingecko.service';
import { ZaloService } from '../src/zalo/zalo.service';

describe('WebhookController (e2e)', () => {
  let app: INestApplication;
  const sendTextMessage = jest.fn().mockResolvedValue(undefined);
  const getPricesBySymbols = jest.fn();
  const getTopMarkets = jest.fn();

  const SECRET = process.env.WEBHOOK_SECRET_TOKEN as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ZaloService)
      .useValue({ sendTextMessage })
      .overrideProvider(CoingeckoService)
      .useValue({ getPricesBySymbols, getTopMarkets })
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
});
