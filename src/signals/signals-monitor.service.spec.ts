import { ConfigService } from '@nestjs/config';
import { ZaloService } from '../zalo/zalo.service';
import { SignalsMonitorService } from './signals-monitor.service';
import { SignalsStateService } from './signals-state.service';
import { SIGNALS_REMINDER_MS, SIGNALS_STALE_MS } from './signals.constants';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('SignalsMonitorService', () => {
  const getHealthAndOutage = jest.fn();
  let lastHealthy: string | null = null;
  let outageState: unknown = null;
  const setHealthy = (value: string | null) => {
    lastHealthy = value;
  };
  const setOutageState = (value: unknown) => {
    outageState = value;
  };
  const claimOutage = jest.fn();
  const setOutage = jest.fn();
  const clearOutage = jest.fn();
  const takeOutage = jest.fn();
  const listRecentRuns = jest.fn();
  const sendTextMessage = jest.fn();

  const build = (ownerChatId: string | undefined = 'owner-chat') =>
    new SignalsMonitorService(
      {
        getHealthAndOutage,
        claimOutage,
        setOutage,
        clearOutage,
        takeOutage,
        listRecentRuns,
      } as unknown as SignalsStateService,
      { sendTextMessage } as unknown as ZaloService,
      { get: () => ownerChatId } as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    lastHealthy = null;
    outageState = null;
    getHealthAndOutage.mockImplementation(async () => [lastHealthy, outageState]);
    claimOutage.mockResolvedValue(true);
    listRecentRuns.mockResolvedValue([]);
    sendTextMessage.mockResolvedValue(true);
  });

  it('does nothing and sends nothing while the check is healthy', async () => {
    setHealthy(iso(T0));
    await build().check(new Date(T0 + 10 * 60_000));
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(claimOutage).not.toHaveBeenCalled();
  });

  it('messages the owner when the check has been down 90 minutes, and records the outage first', async () => {
    setHealthy(iso(T0));
    listRecentRuns.mockResolvedValue([{ outcome: 'failed' }]);

    await build().check(new Date(T0 + SIGNALS_STALE_MS));

    expect(claimOutage).toHaveBeenCalledWith({
      since: iso(T0),
      notifiedAt: iso(T0 + SIGNALS_STALE_MS),
    });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendTextMessage.mock.calls[0];
    expect(chatId).toBe('owner-chat');
    expect(text).toContain('ngừng chạy');
    expect(text).toContain('bị lỗi');
  });

  it('does not send a second "down" when another watcher call already claimed the outage', async () => {
    setHealthy(iso(T0));
    claimOutage.mockResolvedValue(false);
    await build().check(new Date(T0 + SIGNALS_STALE_MS));
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('gives the claim back when the "down" message could not be delivered, so it is retried', async () => {
    setHealthy(iso(T0));
    sendTextMessage.mockResolvedValue(false);

    await build().check(new Date(T0 + SIGNALS_STALE_MS));

    expect(clearOutage).toHaveBeenCalledTimes(1);
  });

  it('hints that the job may have stopped when no run is logged at all', async () => {
    setHealthy(iso(T0));
    await build().check(new Date(T0 + SIGNALS_STALE_MS));
    expect(sendTextMessage.mock.calls[0][1]).toContain('cron-job.org');
  });

  it('sends a reminder after 6 hours and moves the notified time forward', async () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    setHealthy(iso(T0));
    setOutageState(outage);
    const now = new Date(T0 + SIGNALS_STALE_MS + SIGNALS_REMINDER_MS);

    await build().check(now);

    expect(sendTextMessage.mock.calls[0][1]).toContain('vẫn chưa chạy lại');
    expect(setOutage).toHaveBeenCalledWith({ since: iso(T0), notifiedAt: now.toISOString() });
  });

  it('says "recovered" once, taking the outage so a second call cannot repeat it', async () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    const healthyAgain = T0 + 3 * 60 * 60_000;
    setHealthy(iso(healthyAgain));
    setOutageState(outage);
    takeOutage.mockResolvedValueOnce(outage).mockResolvedValueOnce(null);

    await build().check(new Date(healthyAgain + 60_000));
    await build().check(new Date(healthyAgain + 60_000));

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage.mock.calls[0][1]).toContain('chạy lại');
  });

  it('puts the outage back when the "recovered" message could not be delivered', async () => {
    const outage = { since: iso(T0), notifiedAt: iso(T0 + SIGNALS_STALE_MS) };
    const healthyAgain = T0 + 3 * 60 * 60_000;
    setHealthy(iso(healthyAgain));
    setOutageState(outage);
    takeOutage.mockResolvedValue(outage);
    sendTextMessage.mockResolvedValue(false);

    await build().check(new Date(healthyAgain + 60_000));

    expect(setOutage).toHaveBeenCalledWith(outage);
  });

  it('sends nothing, and records nothing, when OWNER_CHAT_ID is not set', async () => {
    setHealthy(iso(T0));
    await build('').check(new Date(T0 + SIGNALS_STALE_MS));
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(claimOutage).not.toHaveBeenCalled();
  });

  it('never throws out of a failed send', async () => {
    setHealthy(iso(T0));
    sendTextMessage.mockRejectedValue(new Error('zalo down'));
    await expect(build().check(new Date(T0 + SIGNALS_STALE_MS))).resolves.toBeUndefined();
    expect(clearOutage).toHaveBeenCalled();
  });
});
