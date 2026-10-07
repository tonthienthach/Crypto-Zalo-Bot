import { CoingeckoService } from '../coingecko/coingecko.service';
import { ZaloService } from '../zalo/zalo.service';
import { ChatSignalState, CoinSignal, SignalResult } from './interfaces/signal.interface';
import { SignalsController } from './signals.controller';
import { SignalsStateService } from './signals-state.service';
import { SignalsService } from './signals.service';
import { HOUR_MS, SIGNALS_SEND_BUDGET_MS } from './signals.constants';

const T0 = Date.UTC(2026, 9, 7, 10, 0, 0);

function signal(
  symbol: string,
  movePct: number,
  verdict: 'buy' | 'sell' | 'watch' | null = 'buy',
): CoinSignal {
  const strong = verdict !== null;
  const result: SignalResult = {
    insufficientData: false,
    change24hPct: movePct,
    change72hPct: movePct,
    strong,
    direction: strong ? (movePct >= 0 ? 'up' : 'down') : null,
    movePct: strong ? movePct : null,
    window: strong ? '24h' : null,
    rangeLow: 80_000,
    rangeHigh: 120_000,
    positionPct: 10,
    verdict,
    priceUsd: 84_000,
  };
  return { symbol, result };
}

describe('SignalsController', () => {
  const getPricesBySymbols = jest.fn();
  const resolveSymbolToId = jest.fn((symbol: string) => symbol);
  const sendTextMessage = jest.fn();
  const evaluateWithPrices = jest.fn();
  const recordSentVerdicts = jest.fn();
  const getWatchlists = jest.fn();
  const listExtra = jest.fn();
  const listDisabled = jest.fn();
  const getSentStates = jest.fn();
  const setSentState = jest.fn();
  const recordUsage = jest.fn();
  const acquireRunLock = jest.fn();
  const releaseRunLock = jest.fn();
  const recordRun = jest.fn();
  let controller: SignalsController;
  let sentStates: Record<string, ChatSignalState>;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(T0);
    sentStates = {};
    resolveSymbolToId.mockImplementation((symbol: string) => symbol);
    getWatchlists.mockResolvedValue({ chat1: ['btc', 'eth'] });
    listExtra.mockResolvedValue([]);
    listDisabled.mockResolvedValue(new Set());
    getSentStates.mockImplementation(async () => sentStates);
    setSentState.mockImplementation(async (chatId: string, state: ChatSignalState) => {
      sentStates[chatId] = state;
    });
    acquireRunLock.mockResolvedValue('token');
    releaseRunLock.mockResolvedValue(undefined);
    recordRun.mockResolvedValue(undefined);
    recordUsage.mockResolvedValue(undefined);
    recordSentVerdicts.mockResolvedValue(undefined);
    sendTextMessage.mockResolvedValue(true);
    getPricesBySymbols.mockResolvedValue([
      { id: 'btc', symbol: 'btc', priceUsd: 84_000 },
      { id: 'eth', symbol: 'eth', priceUsd: 2_500 },
    ]);
    evaluateWithPrices.mockResolvedValue([signal('btc', -16), signal('eth', 3, null)]);

    controller = new SignalsController(
      { evaluateWithPrices, recordSentVerdicts } as unknown as SignalsService,
      {
        getWatchlists,
        listExtra,
        listDisabled,
        getSentStates,
        setSentState,
        recordUsage,
        acquireRunLock,
        releaseRunLock,
        recordRun,
      } as unknown as SignalsStateService,
      { getPricesBySymbols, resolveSymbolToId } as unknown as CoingeckoService,
      { sendTextMessage } as unknown as ZaloService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const lastRun = () => recordRun.mock.calls[recordRun.mock.calls.length - 1][0];

  it('AC04: sends one message with the verdict, reason and disclaimer to a chat with a strong coin', async () => {
    await controller.checkSignals();

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendTextMessage.mock.calls[0];
    expect(chatId).toBe('chat1');
    expect(text).toContain('BTC');
    expect(text).toContain('Cân nhắc mua');
    expect(text).toContain('Lý do');
    expect(text).toContain('không phải lời khuyên đầu tư');
    expect(lastRun()).toMatchObject({ outcome: 'healthy', chatsAlerted: 1, coins: 2, failures: 0 });
  });

  it('AC03: sends nothing when no coin swings strongly', async () => {
    evaluateWithPrices.mockResolvedValue([signal('btc', 3, null), signal('eth', 3, null)]);
    await controller.checkSignals();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('records what was sent only after Zalo accepted it (state, verdicts, usage)', async () => {
    await controller.checkSignals();

    expect(setSentState).toHaveBeenCalledWith(
      'chat1',
      expect.objectContaining({ lastSentAt: T0, coins: { btc: expect.any(Object) } }),
    );
    expect(recordSentVerdicts).toHaveBeenCalledWith(
      'chat1',
      [expect.objectContaining({ symbol: 'btc' })],
      T0,
    );
    expect(recordUsage).toHaveBeenCalledWith('chat1', 'alert', T0);
  });

  it('AC05: holds the next signals for an hour, then sends the new coin', async () => {
    await controller.checkSignals();
    sendTextMessage.mockClear();
    evaluateWithPrices.mockResolvedValue([signal('btc', -16), signal('eth', 9)]);

    jest.setSystemTime(T0 + 20 * 60_000);
    await controller.checkSignals();
    jest.setSystemTime(T0 + 50 * 60_000);
    await controller.checkSignals();
    expect(sendTextMessage).not.toHaveBeenCalled();

    jest.setSystemTime(T0 + HOUR_MS);
    await controller.checkSignals();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const text = sendTextMessage.mock.calls[0][1] as string;
    expect(text).toContain('ETH');
    expect(text).not.toContain('BTC');
  });

  it('AC05: a second run in the same minute sends nothing more', async () => {
    await controller.checkSignals();
    await controller.checkSignals();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('AC05: a run that finds the lock held does nothing and says skipped', async () => {
    acquireRunLock.mockResolvedValue(null);
    await controller.checkSignals();
    expect(getPricesBySymbols).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(releaseRunLock).not.toHaveBeenCalled();
    expect(lastRun().outcome).toBe('skipped');
  });

  it('AC06: puts BTC, ETH and SOL in a single message', async () => {
    getWatchlists.mockResolvedValue({ chat1: ['btc', 'eth', 'sol'] });
    evaluateWithPrices.mockResolvedValue([
      signal('btc', -16),
      signal('eth', -12),
      signal('sol', 20, 'sell'),
    ]);

    await controller.checkSignals();

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const text = sendTextMessage.mock.calls[0][1] as string;
    for (const coin of ['BTC', 'ETH', 'SOL']) expect(text).toContain(coin);
  });

  it('AC14: skips a chat that turned signals off', async () => {
    listDisabled.mockResolvedValue(new Set(['chat1']));
    await controller.checkSignals();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('AC15: a price source failure sends nothing, saves nothing and logs a failed run', async () => {
    getPricesBySymbols.mockRejectedValue(new Error('coingecko down'));

    await controller.checkSignals();

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(setSentState).not.toHaveBeenCalled();
    expect(lastRun().outcome).toBe('failed');
  });

  it('AC15: one chat failing to send does not stop the others, and is retried next run', async () => {
    getWatchlists.mockResolvedValue({ chat1: ['btc'], chat2: ['btc'] });
    sendTextMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await controller.checkSignals();

    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    expect(setSentState).toHaveBeenCalledTimes(1);
    expect(setSentState).toHaveBeenCalledWith('chat2', expect.anything());
    expect(lastRun()).toMatchObject({ outcome: 'healthy', chatsAlerted: 1, failures: 1 });

    sendTextMessage.mockClear();
    sendTextMessage.mockResolvedValue(true);
    await controller.checkSignals();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage.mock.calls[0][0]).toBe('chat1');
  });

  it('AC15: a chat that throws is counted and the others still get their message', async () => {
    getWatchlists.mockResolvedValue({ chat1: ['btc'], chat2: ['btc'] });
    sendTextMessage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);

    await controller.checkSignals();

    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    expect(lastRun()).toMatchObject({ chatsAlerted: 1, failures: 1 });
  });

  it('keeps a delivered message delivered when the bookkeeping fails', async () => {
    recordSentVerdicts.mockRejectedValue(new Error('redis'));
    await controller.checkSignals();
    expect(lastRun()).toMatchObject({ chatsAlerted: 1, failures: 0 });
  });

  it('AC16: prices 30 coins for 50 chats with at most two price lookups', async () => {
    const symbols = Array.from({ length: 30 }, (_, i) => `c${i}`);
    getWatchlists.mockResolvedValue(
      Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`chat${i}`, symbols])),
    );
    getPricesBySymbols.mockResolvedValue(symbols.map((s) => ({ id: s, symbol: s, priceUsd: 1 })));
    evaluateWithPrices.mockResolvedValue(symbols.map((s) => signal(s, -16)));

    await controller.checkSignals();

    expect(getPricesBySymbols.mock.calls.length).toBeLessThanOrEqual(2);
    expect(evaluateWithPrices).toHaveBeenCalledTimes(1);
    expect(sendTextMessage).toHaveBeenCalledTimes(50);
  });

  it('prices tracked extra coins too, and does nothing when there is nothing to watch', async () => {
    getWatchlists.mockResolvedValue({});
    listExtra.mockResolvedValue(['doge']);
    getPricesBySymbols.mockResolvedValue([{ id: 'doge', symbol: 'doge', priceUsd: 1 }]);
    evaluateWithPrices.mockResolvedValue([]);
    await controller.checkSignals();
    expect(getPricesBySymbols).toHaveBeenCalledWith(['doge']);

    getPricesBySymbols.mockClear();
    listExtra.mockResolvedValue([]);
    await controller.checkSignals();
    expect(getPricesBySymbols).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({ outcome: 'healthy', coins: 0 });
  });

  it('defers chats left when the send budget runs out', async () => {
    getWatchlists.mockResolvedValue({ chat1: ['btc'], chat2: ['btc'] });
    sendTextMessage.mockImplementation(async () => {
      jest.setSystemTime(Date.now() + SIGNALS_SEND_BUDGET_MS + 1);
      return true;
    });

    await controller.checkSignals();

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(lastRun()).toMatchObject({ chatsAlerted: 1, deferred: 1 });
  });

  it('logs a run without any verdict text (AC17)', async () => {
    const logs: string[] = [];
    const spy = jest
      .spyOn((controller as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation((message: string) => {
        logs.push(message);
      });

    await controller.checkSignals();
    spy.mockRestore();

    const line = logs.find((entry) => entry.includes('signals-run'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/Cân nhắc|buy|sell|chat1/);
  });

  it('always releases the lock, even when the run throws', async () => {
    getWatchlists.mockRejectedValue(new Error('redis down'));
    await controller.checkSignals();
    expect(releaseRunLock).toHaveBeenCalledWith('token');
    expect(lastRun().outcome).toBe('failed');
  });
});
