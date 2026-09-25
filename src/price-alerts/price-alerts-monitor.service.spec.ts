import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZaloService } from '../zalo/zalo.service';
import { AlertRunSummary, MonitorState } from './interfaces/price-alert.interface';
import { PriceAlertsMonitorService } from './price-alerts-monitor.service';
import { PriceAlertsService } from './price-alerts.service';

const T = Date.parse('2026-09-25T03:00:00.000Z');
const min = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

function healthyRun(offsetMs: number): AlertRunSummary {
  return {
    startedAt: iso(offsetMs),
    outcome: 'healthy',
    evaluated: 1,
    fired: 0,
    failed: 0,
    rearmed: 0,
    deferred: 0,
    durationMs: 500,
    driftMs: 0,
  };
}

/** Watcher running for an hour, last healthy check run at T. */
const watching: MonitorState = {
  watcherStartedAt: iso(-min(60)),
  lastWatcherRunAt: iso(-min(5)),
  lastHealthyAt: iso(0),
  outage: null,
};

describe('PriceAlertsMonitorService', () => {
  let alerts: Record<string, jest.Mock>;
  let sendTextMessage: jest.Mock;
  let stored: MonitorState | null;

  function create(ownerChatId: string | null = 'owner-chat') {
    return new PriceAlertsMonitorService(
      alerts as unknown as PriceAlertsService,
      { sendTextMessage } as unknown as ZaloService,
      { get: () => ownerChatId ?? undefined } as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stored = watching;
    alerts = {
      getMonitorState: jest.fn(async () => stored),
      setMonitorState: jest.fn(async (state: MonitorState) => {
        stored = state;
      }),
      listRecentRuns: jest.fn().mockResolvedValue([healthyRun(0)]),
      countRejectionsSince: jest.fn().mockResolvedValue(0),
      countAlerts: jest.fn().mockResolvedValue(2),
      recordMonitorNotice: jest.fn().mockResolvedValue(undefined),
      getMonitorAndWatchdogState: jest.fn(),
      setWatchdogState: jest.fn().mockResolvedValue(undefined),
    };
    sendTextMessage = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('messages the owner once the check has been down 15 minutes, with alert count and signal', async () => {
    alerts.countRejectionsSince.mockResolvedValue(12);
    const service = create();

    await service.runWatcher(at(min(14)));
    expect(sendTextMessage).not.toHaveBeenCalled();

    await service.runWatcher(at(min(16)));
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendTextMessage.mock.calls[0];
    expect(chatId).toBe('owner-chat');
    expect(text).toContain('Ngừng canh giá');
    expect(text).toContain('10:00 25/09');
    expect(text).toContain('bị từ chối (sai/thiếu secret) 12 lần');
    expect(text).toContain('Cảnh báo đang không được canh: 2');
    expect(alerts.countRejectionsSince).toHaveBeenCalledWith(iso(0), at(min(16)));
    expect(stored?.outage?.notifiedAt).toBe(iso(min(16)));
    expect(alerts.recordMonitorNotice).toHaveBeenCalledWith({
      kind: 'down',
      at: iso(min(16)),
      delivered: true,
    });

    await service.runWatcher(at(min(21)));
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('does not mark a failed send as notified and retries on the next run (FIX-AC10)', async () => {
    sendTextMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const service = create();

    await service.runWatcher(at(min(16)));
    expect(stored?.outage).toEqual({ since: iso(0), notifiedAt: null });
    expect(alerts.recordMonitorNotice).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false }),
    );

    await service.runWatcher(at(min(21)));
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    expect(stored?.outage?.notifiedAt).toBe(iso(min(21)));
  });

  it('sends one recovery message after a notified outage (FIX-AC08)', async () => {
    const service = create();
    await service.runWatcher(at(min(16)));
    alerts.listRecentRuns.mockResolvedValue([healthyRun(min(30))]);

    await service.runWatcher(at(min(31)));
    await service.runWatcher(at(min(36)));

    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    expect(sendTextMessage.mock.calls[1][1]).toContain('Canh giá đã chạy lại');
    expect(stored?.outage).toBeNull();
  });

  it('sends nothing without an owner chat, but keeps watching and records that (FIX-AC11)', async () => {
    const service = create(null);

    await service.runWatcher(at(min(16)));

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      ownerChatConfigured: false,
      lastWatcherRunAt: iso(min(16)),
      outage: { since: iso(0), notifiedAt: null },
    });
  });

  it('sends at most 3 messages over 3 hours when Redis is unreachable (FIX-AC12)', async () => {
    for (const fn of Object.values(alerts)) {
      fn.mockRejectedValue(new Error('redis down'));
    }
    const service = create();

    for (let i = 0; i < 36; i++) {
      await service.runWatcher(at(min(5 * i)));
    }

    expect(sendTextMessage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(sendTextMessage.mock.calls.length).toBeLessThanOrEqual(3);
    expect(sendTextMessage.mock.calls[0][1]).toContain('không đọc được trạng thái');
  });

  it('holds repeats to one an hour when a delivered message cannot be saved (FIX-NFR05)', async () => {
    alerts.setMonitorState.mockRejectedValue(new Error('redis write failed'));
    const service = create();

    for (let i = 0; i < 12; i++) {
      await service.runWatcher(at(min(16 + 5 * i))); // one hour of watcher runs
    }

    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  describe('checkWatcher (FIX-FR07)', () => {
    it('reads once and writes nothing while the watcher is on time', async () => {
      alerts.getMonitorAndWatchdogState.mockResolvedValue([watching, { outage: null }]);

      await create().checkWatcher(at(0));

      expect(alerts.setWatchdogState).not.toHaveBeenCalled();
      expect(sendTextMessage).not.toHaveBeenCalled();
    });

    it('does not repeat a delivered watcher alarm every 5 minutes when its state cannot be saved', async () => {
      alerts.getMonitorAndWatchdogState.mockResolvedValue([watching, null]);
      alerts.setWatchdogState.mockRejectedValue(new Error('redis write failed'));
      const service = create();

      for (let i = 0; i < 12; i++) {
        await service.checkWatcher(at(min(30 + 5 * i))).catch(() => undefined);
      }

      expect(sendTextMessage).toHaveBeenCalledTimes(1);
    });

    it('messages the owner once the watcher has been silent 30 minutes (FIX-AC13)', async () => {
      alerts.getMonitorAndWatchdogState.mockResolvedValue([watching, null]);

      await create().checkWatcher(at(min(30)));

      expect(sendTextMessage).toHaveBeenCalledWith(
        'owner-chat',
        expect.stringContaining('Bên giám sát canh giá đã im lặng 35 phút'),
      );
      expect(alerts.setWatchdogState).toHaveBeenCalledWith({
        outage: { since: iso(-min(5)), notifiedAt: iso(min(30)) },
      });
    });
  });
});
