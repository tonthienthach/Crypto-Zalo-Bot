import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoingeckoService, CoingeckoUnavailableError } from '../coingecko/coingecko.service';
import { ZaloService } from '../zalo/zalo.service';
import { PriceAlert } from './interfaces/price-alert.interface';
import { PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 1,
    chatId: 'chat-1',
    symbol: 'btc',
    direction: 'above',
    threshold: 100000,
    state: 'armed',
    lastFiredAt: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('PriceAlertsController', () => {
  let controller: PriceAlertsController;
  let getPricesBySymbols: jest.Mock;
  let sendTextMessage: jest.Mock;
  const alerts = {
    acquireRunLock: jest.fn(),
    releaseRunLock: jest.fn(),
    listAll: jest.fn(),
    updateState: jest.fn(),
    recordDelivery: jest.fn(),
    recordRun: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    alerts.acquireRunLock.mockResolvedValue(true);
    alerts.releaseRunLock.mockResolvedValue(undefined);
    alerts.updateState.mockResolvedValue(true);
    alerts.recordDelivery.mockResolvedValue(undefined);
    alerts.recordRun.mockResolvedValue(undefined);
    getPricesBySymbols = jest.fn();
    sendTextMessage = jest.fn().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      controllers: [PriceAlertsController],
      providers: [
        { provide: PriceAlertsService, useValue: alerts },
        { provide: CoingeckoService, useValue: { getPricesBySymbols } },
        { provide: ZaloService, useValue: { sendTextMessage } },
        { provide: ConfigService, useValue: { get: () => 25400 } },
      ],
    }).compile();

    controller = moduleRef.get(PriceAlertsController);
  });

  it('fires a crossed alert: one message, state -> fired, delivery recorded (AC02, AC17)', async () => {
    alerts.listAll.mockResolvedValue([alert()]);
    getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 100200 }]);

    await expect(controller.checkPriceAlerts()).resolves.toEqual({ ok: true });

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendTextMessage.mock.calls[0];
    expect(chatId).toBe('chat-1');
    expect(text).toContain('BTC > $100,000.00');
    expect(text).toContain('$100,200.00');
    expect(alerts.updateState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, state: 'fired', lastFiredAt: expect.any(String) }),
    );
    expect(alerts.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 1, chatId: 'chat-1', priceUsd: 100200, delivered: true }),
    );
    expect(alerts.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluated: 1,
        fired: 1,
        failed: 0,
        rearmed: 0,
        durationMs: expect.any(Number),
        driftMs: expect.any(Number),
      }),
    );
    expect(alerts.releaseRunLock).toHaveBeenCalled();
  });

  it('re-arms silently without sending (AC04)', async () => {
    alerts.listAll.mockResolvedValue([
      alert({ state: 'fired', lastFiredAt: '2026-09-23T00:00:00.000Z' }),
    ]);
    getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 99400 }]);

    await controller.checkPriceAlerts();

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(alerts.updateState).toHaveBeenCalledWith(expect.objectContaining({ state: 'armed' }));
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ rearmed: 1 }));
  });

  it('sends nothing and changes no state when the price source is down (AC12)', async () => {
    alerts.listAll.mockResolvedValue([alert()]);
    getPricesBySymbols.mockRejectedValue(new CoingeckoUnavailableError('down'));

    await expect(controller.checkPriceAlerts()).resolves.toEqual({ ok: true });

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(alerts.updateState).not.toHaveBeenCalled();
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ evaluated: 0 }));
    expect(alerts.releaseRunLock).toHaveBeenCalled();
  });

  it('keeps going after a failed send, leaving that alert armed for a retry (AC13)', async () => {
    alerts.listAll.mockResolvedValue([
      alert({ id: 1, chatId: 'chat-1' }),
      alert({ id: 2, chatId: 'chat-2' }),
    ]);
    getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 100200 }]);
    sendTextMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await controller.checkPriceAlerts();

    expect(sendTextMessage).toHaveBeenCalledWith('chat-2', expect.any(String));
    expect(alerts.updateState).toHaveBeenCalledTimes(1);
    expect(alerts.updateState).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(alerts.recordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 1, delivered: false }),
    );
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ fired: 1, failed: 1 }));
  });

  it('isolates an unexpected per-alert error from the other alerts (NFR07)', async () => {
    alerts.listAll.mockResolvedValue([alert({ id: 1 }), alert({ id: 2, chatId: 'chat-2' })]);
    getPricesBySymbols.mockResolvedValue([{ symbol: 'btc', priceUsd: 100200 }]);
    alerts.recordDelivery.mockRejectedValueOnce(new Error('redis blip'));

    await controller.checkPriceAlerts();

    expect(sendTextMessage).toHaveBeenCalledWith('chat-2', expect.any(String));
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ fired: 1, failed: 1 }));
  });

  it('skips the whole run when another run holds the lock (AC14)', async () => {
    alerts.acquireRunLock.mockResolvedValue(false);

    await expect(controller.checkPriceAlerts()).resolves.toEqual({ ok: true });

    expect(alerts.listAll).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(alerts.releaseRunLock).not.toHaveBeenCalled();
  });

  it('looks up prices once for all distinct coins, however many alerts (AC15)', async () => {
    const symbols = ['btc', 'eth', 'sol', 'bnb', 'xrp'];
    alerts.listAll.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => alert({ id: i + 1, symbol: symbols[i % 5] })),
    );
    getPricesBySymbols.mockResolvedValue(symbols.map((symbol) => ({ symbol, priceUsd: 1 })));

    await controller.checkPriceAlerts();

    expect(getPricesBySymbols).toHaveBeenCalledTimes(1);
    expect(getPricesBySymbols).toHaveBeenCalledWith(symbols);
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ evaluated: 50 }));
  });

  it('makes no price call at all when there are no alerts', async () => {
    alerts.listAll.mockResolvedValue([]);

    await controller.checkPriceAlerts();

    expect(getPricesBySymbols).not.toHaveBeenCalled();
    expect(alerts.recordRun).toHaveBeenCalledWith(expect.objectContaining({ evaluated: 0 }));
  });

  it('still releases the lock and acks 200 when Redis fails mid-run', async () => {
    alerts.listAll.mockRejectedValue(new Error('redis down'));

    await expect(controller.checkPriceAlerts()).resolves.toEqual({ ok: true });
    expect(alerts.releaseRunLock).toHaveBeenCalled();
  });
});
