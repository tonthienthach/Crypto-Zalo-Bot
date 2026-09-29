import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZaloService } from '../zalo/zalo.service';
import {
  AlertRunSummary,
  MonitorState,
  NoticeHold,
  NoticeHoldKind,
} from './interfaces/price-alert.interface';
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
  /** The shared hold keys, one per kind, as Redis would keep them: each expires `holdMs` after it was set. */
  let holds: Map<NoticeHoldKind, { hold: NoticeHold; until: number }>;
  let clock: number;

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
    holds = new Map();
    clock = T;
    const live = (kind: NoticeHoldKind) => {
      const entry = holds.get(kind);
      return entry && clock < entry.until ? entry.hold : null;
    };
    alerts = {
      getNoticeHold: jest.fn(async (kind: NoticeHoldKind) => live(kind)),
      claimNoticeHold: jest.fn(async (kind: NoticeHoldKind, hold: NoticeHold, holdMs: number) => {
        if (live(kind)) return false;
        holds.set(kind, { hold, until: Date.parse(hold.at) + holdMs });
        return true;
      }),
      setNoticeHold: jest.fn(async (kind: NoticeHoldKind, hold: NoticeHold, holdMs: number) => {
        holds.set(kind, { hold, until: Date.parse(hold.at) + holdMs });
      }),
      releaseNoticeHold: jest.fn(async (kind: NoticeHoldKind) => {
        holds.delete(kind);
      }),
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

  it('warns at boot when the watch secret equals another secret, and still boots (FIX-NFR08)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      'monitoring.ownerChatId': 'owner-chat',
      'priceAlerts.watchSecretToken': 'same-secret-0123456789',
      'cron.secretToken': 'digest-secret-0123456789',
      'priceAlerts.cronSecretToken': 'same-secret-0123456789',
    } as Record<string, string>;

    const service = new PriceAlertsMonitorService(
      alerts as unknown as PriceAlertsService,
      { sendTextMessage } as unknown as ZaloService,
      { get: (key: string) => config[key] } as unknown as ConfigService,
    );

    expect(service).toBeDefined();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('PRICE_ALERTS_WATCH_SECRET equals PRICE_ALERTS_CRON_SECRET');
    expect(logged).not.toContain('same-secret');
  });

  describe('the hold across flaky Redis and many instances (FIX-NFR05, verify finding #2)', () => {
    /** Runs the watcher every 5 minutes for `hours`, on the instance `pick(i)` returns. */
    async function runEveryFiveMinutes(
      hours: number,
      pick: (i: number) => PriceAlertsMonitorService,
    ) {
      for (let i = 0; i < hours * 12; i++) {
        clock = T + min(16 + 5 * i);
        await pick(i).runWatcher(at(min(16 + 5 * i)));
      }
    }

    it('flaky state reads (every other one fails) send each message at most once an hour', async () => {
      let reads = 0;
      alerts.getMonitorState.mockImplementation(async () => {
        if (reads++ % 2 === 0) throw new Error('redis timeout');
        return stored;
      });
      const service = create();

      await runEveryFiveMinutes(1, () => service);

      // Before rev 2 a successful save lifted the hold: 6 messages an hour.
      // Now one "can't read state" and the real "down" it must not hold back
      // (NFR01 before NFR05, verify rev 2): one of each.
      const texts = sendTextMessage.mock.calls.map((call) => String(call[1]));
      expect(texts).toHaveLength(2);
      expect(texts.filter((text) => text.includes('không đọc được trạng thái'))).toHaveLength(1);
      expect(texts.filter((text) => text.includes('Ngừng canh giá'))).toHaveLength(1);
    });

    it('a fresh instance on every run (cold starts) still sends at most one an hour', async () => {
      alerts.getMonitorState.mockRejectedValue(new Error('redis timeout'));

      await runEveryFiveMinutes(3, () => create());

      // Before the fix each instance had its own memory: 36 messages in 3 hours.
      expect(sendTextMessage).toHaveBeenCalledTimes(3);
      expect(sendTextMessage.mock.calls[0][1]).toContain('không đọc được trạng thái');
    });

    it('two instances taking turns share the hold after a delivered message fails to save', async () => {
      alerts.setMonitorState.mockRejectedValue(new Error('redis write failed'));
      const a = create();
      const b = create();

      await runEveryFiveMinutes(3, (i) => (i % 2 === 0 ? a : b));

      expect(sendTextMessage).toHaveBeenCalledTimes(3);
      expect(alerts.setNoticeHold).toHaveBeenCalled();
    });

    it('gives the claim back when the message could not be delivered, so the next run retries', async () => {
      alerts.getMonitorState.mockRejectedValue(new Error('redis timeout'));
      sendTextMessage.mockResolvedValueOnce(false).mockResolvedValue(true);
      const service = create();

      clock = T + min(16);
      await service.runWatcher(at(min(16)));
      expect(alerts.releaseNoticeHold).toHaveBeenCalledWith('state-unreadable');
      clock = T + min(21);
      await service.runWatcher(at(min(21)));

      expect(sendTextMessage).toHaveBeenCalledTimes(2);
      expect(holds.get('state-unreadable')?.until).toBe(T + min(21) + min(60));
    });
  });

  describe('holds per message kind (verify rev 2)', () => {
    async function runAt(offsetMs: number, service: PriceAlertsMonitorService) {
      clock = T + offsetMs;
      await service.runWatcher(at(offsetMs));
    }

    it('one failed state read at T+10 does not delay the real "down": it still arrives by T+20 (NFR01)', async () => {
      alerts.getMonitorState.mockRejectedValueOnce(new Error('redis timeout'));
      const service = create();

      await runAt(min(10), service);
      expect(sendTextMessage.mock.calls[0][1]).toContain('không đọc được trạng thái');
      await runAt(min(15), service);

      expect(sendTextMessage).toHaveBeenCalledTimes(2);
      expect(sendTextMessage.mock.calls[1][1]).toContain('Ngừng canh giá');
      expect(stored?.outage).toEqual({ since: iso(0), notifiedAt: iso(min(15)) });
    });

    it('a "can\'t read state" hold does not hold back the recovery, which carries the right end time', async () => {
      const service = create();
      await runAt(min(16), service); // "down"
      alerts.getMonitorState.mockRejectedValueOnce(new Error('redis timeout'));
      await runAt(min(37), service); // "can't read state", holds that kind for an hour
      alerts.listRecentRuns.mockResolvedValue([healthyRun(0), healthyRun(min(42))]);

      await runAt(min(42), service);

      expect(sendTextMessage).toHaveBeenCalledTimes(3);
      const recovery = String(sendTextMessage.mock.calls[2][1]);
      expect(recovery).toContain('Canh giá đã chạy lại');
      expect(recovery).toContain('10:42');
      expect(stored?.outage).toBeNull();
    });

    it('a new outage within the hour of a held one is still reported', async () => {
      alerts.setMonitorState.mockRejectedValueOnce(new Error('redis write failed'));
      const service = create();
      await runAt(min(16), service); // "down" #1, held
      alerts.listRecentRuns.mockResolvedValue([healthyRun(min(20)), healthyRun(min(25))]);
      await runAt(min(26), service); // recovery
      alerts.listRecentRuns.mockResolvedValue([healthyRun(min(25))]);

      await runAt(min(41), service); // 16 minutes without a healthy run again

      const texts = sendTextMessage.mock.calls.map((call) => String(call[1]));
      expect(texts.filter((text) => text.includes('Ngừng canh giá'))).toHaveLength(2);
      expect(stored?.outage).toEqual({ since: iso(min(25)), notifiedAt: iso(min(41)) });
    });
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
