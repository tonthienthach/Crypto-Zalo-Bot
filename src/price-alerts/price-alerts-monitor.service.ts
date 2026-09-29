import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watchSecretReusedAs } from '../common/guards/secret-equals';
import {
  formatMonitorMessage,
  formatMonitorStateUnreadableMessage,
} from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import {
  MonitorAction,
  MonitorNotice,
  MonitorState,
  NoticeHold,
  NoticeHoldKind,
  WatchdogState,
} from './interfaces/price-alert.interface';
import { evaluateMonitor, evaluateWatchdog } from './price-alert-monitor';
import {
  MONITOR_RUNS_WINDOW,
  STATE_UNREADABLE_NOTICE_MS,
  WATCHER_STATE_STALE_MS,
} from './price-alerts.constants';
import { PriceAlertsService } from './price-alerts.service';

/** Delivered (now, or earlier and held): when the owner got the message. */
interface Sent {
  at: string;
  held: boolean;
}

/** The hold a message falls under, and the outage it is about. */
function holdOf(action: MonitorAction): { kind: NoticeHoldKind; since: string } {
  switch (action.kind) {
    case 'down':
    case 'reminder':
      return { kind: 'outage', since: action.since };
    case 'recovered':
      return { kind: 'recovered', since: action.since };
    case 'watcher-down':
      return { kind: 'watcher-down', since: action.lastWatcherRunAt };
    case 'watcher-recovered':
      return { kind: 'watcher-recovered', since: action.since };
  }
}

/**
 * Runs the EPIC-002-FIX monitoring rules against Redis and messages the
 * owner. The rules themselves are pure (price-alert-monitor.ts); this class
 * only reads state, sends, and stores the state matching what was actually
 * delivered.
 *
 * Redis trouble is handled here (spec EPIC-002-FIX-NFR05): when state can't
 * be read, or a delivered message's state can't be saved, repeats of THAT
 * message are held to one per STATE_UNREADABLE_NOTICE_MS. Each kind of
 * message has its own hold, about one outage, so a "can't read state" notice
 * never delays a real "down" or "recovered" (NFR01), and a new outage is
 * still reported. Holds live in Redis (keys with that TTL), so every
 * instance and every cold start sees them; only when Redis can't take a hold
 * does this instance's memory stand in.
 */
@Injectable()
export class PriceAlertsMonitorService {
  private readonly logger = new Logger(PriceAlertsMonitorService.name);
  private readonly ownerChatId: string | undefined;
  /** Messages this instance sent without being able to store that it did (the fallback holds). */
  private readonly memoryHolds = new Map<NoticeHoldKind, NoticeHold>();

  constructor(
    private readonly priceAlertsService: PriceAlertsService,
    private readonly zaloService: ZaloService,
    configService: ConfigService,
  ) {
    this.ownerChatId = configService.get<string>('monitoring.ownerChatId') || undefined;
    // Boot-time check of spec EPIC-002-FIX-NFR08: warns, never blocks boot.
    const reused = watchSecretReusedAs({
      watch: configService.get<string>('priceAlerts.watchSecretToken'),
      digest: configService.get<string>('cron.secretToken'),
      check: configService.get<string>('priceAlerts.cronSecretToken'),
    });
    if (reused.length > 0) {
      this.logger.warn(
        `PRICE_ALERTS_WATCH_SECRET equals ${reused.join(' and ')}: it lives at a different ` +
          'scheduler and must be its own secret (docs/DEPLOYMENT.md §8b)',
      );
    }
  }

  /** One watcher run (spec EPIC-002-FIX-FR03–FR06), triggered every 5 minutes. */
  async runWatcher(now: Date = new Date()): Promise<void> {
    let state;
    let runs;
    try {
      state = await this.priceAlertsService.getMonitorState();
      runs = await this.priceAlertsService.listRecentRuns(MONITOR_RUNS_WINDOW);
    } catch (error) {
      this.logger.error(`Price-alert watcher can't read its state: ${String(error)}`);
      await this.sendUnrecorded('state-unreadable', formatMonitorStateUnreadableMessage(), now);
      return;
    }

    state = await this.withUnrecordedOutage(state, now);
    let decision = evaluateMonitor(state, runs, now, () => 0);
    const action = decision.action;
    if (action && (action.kind === 'down' || action.kind === 'reminder')) {
      // Rejections are only read when a message is actually due.
      const rejected = await this.priceAlertsService
        .countRejectionsSince(action.since, now)
        .catch((error: unknown) => {
          this.logger.error(`Failed to read rejected price-alert calls: ${String(error)}`);
          return 0;
        });
      decision = evaluateMonitor(state, runs, now, () => rejected);
    }

    const sent = decision.action ? await this.notify(decision.action, now) : null;
    let next: MonitorState = sent ? decision.onSent : decision.onNotSent;
    if (sent && next.outage?.notifiedAt) {
      // A held message was delivered when the hold was taken, not now: the
      // 6-hour reminder counts from then.
      next = { ...next, outage: { ...next.outage, notifiedAt: sent.at } };
    }
    next = { ...next, ownerChatConfigured: this.ownerChatId !== undefined };
    try {
      await this.priceAlertsService.setMonitorState(next);
    } catch (error) {
      this.logger.error(`Price-alert watcher can't save its state: ${String(error)}`);
      if (sent && !sent.held) await this.holdAfterUnrecordedSend(decision.action!, now);
    }
  }

  /**
   * A "down" delivered on a run whose state then failed to save leaves the
   * stored state without that outage, so its recovery would end silently
   * (verify rev 2). The outage hold remembers it: when the stored state is
   * stale (the last save failed, or the watcher was down) and says the owner
   * wasn't told, it's put back from the hold. A fresh state skips this, so a
   * healthy watcher reads nothing extra.
   */
  private async withUnrecordedOutage(
    state: MonitorState | null,
    now: Date,
  ): Promise<MonitorState | null> {
    if (!state || state.outage?.notifiedAt) return state;
    if (now.getTime() - Date.parse(state.lastWatcherRunAt) <= WATCHER_STATE_STALE_MS) return state;
    const hold = await this.findHold('outage', now);
    if (!hold?.since) return state;
    if (state.outage && state.outage.since !== hold.since) return state;
    // A hold about an outage that already ended (a healthy run since) is stale.
    if (state.lastHealthyAt && Date.parse(state.lastHealthyAt) > Date.parse(hold.since)) {
      return state;
    }
    return { ...state, outage: { since: hold.since, notifiedAt: hold.at } };
  }

  /**
   * The check's look at the watcher (spec EPIC-002-FIX-FR07). Only writes
   * when the watchdog state changes, so a healthy watcher costs one read.
   */
  async checkWatcher(now: Date = new Date()): Promise<void> {
    const [monitor, watchdog] = await this.priceAlertsService.getMonitorAndWatchdogState();
    const decision = evaluateWatchdog(watchdog, monitor?.lastWatcherRunAt ?? null, now);
    const sent = decision.action ? await this.notify(decision.action, now) : null;
    let next: WatchdogState = sent ? decision.onSent : decision.onNotSent;
    if (sent && next.outage?.notifiedAt) {
      next = { outage: { ...next.outage, notifiedAt: sent.at } };
    }
    if (JSON.stringify(next) === JSON.stringify(watchdog ?? { outage: null })) {
      return;
    }
    try {
      await this.priceAlertsService.setWatchdogState(next);
    } catch (error) {
      // Same rule as the watcher: a delivered message we couldn't record
      // must not repeat every 5 minutes (spec EPIC-002-FIX-NFR05).
      if (sent && !sent.held) await this.holdAfterUnrecordedSend(decision.action!, now);
      throw error;
    }
  }

  /**
   * Sends `action` unless its hold says this very message (same kind, same
   * outage) already went out — then it counts as delivered at the hold's
   * time, so the state catches up without messaging the owner twice.
   */
  private async notify(action: MonitorAction, now: Date): Promise<Sent | null> {
    const { kind, since } = holdOf(action);
    const hold = await this.findHold(kind, now);
    if (hold && hold.since === since) {
      return { at: hold.at, held: true };
    }
    const activeAlerts =
      action.kind === 'down' || action.kind === 'reminder'
        ? await this.priceAlertsService.countAlerts().catch(() => 0)
        : 0;
    const delivered = await this.send(action.kind, formatMonitorMessage(action, activeAlerts), now);
    return delivered ? { at: now.toISOString(), held: false } : null;
  }

  /**
   * The "can't read state" notice, which the state can never record: at most
   * one per window across instances. Its hold is claimed before sending
   * (SET NX), so two instances can't both send; a send that fails gives the
   * claim back. When Redis can't take the claim, this instance's memory is
   * the hold. It holds only this notice, never a "down" or "recovered".
   */
  private async sendUnrecorded(kind: MonitorNotice['kind'], text: string, now: Date) {
    if (this.memoryHold('state-unreadable', now)) {
      return;
    }
    const hold: NoticeHold = { at: now.toISOString() };
    const claimed = await this.priceAlertsService
      .claimNoticeHold('state-unreadable', hold, STATE_UNREADABLE_NOTICE_MS)
      .catch(() => null);
    if (claimed === false) {
      return; // Another instance (or an earlier run) already told the owner this hour.
    }
    if (await this.send(kind, text, now)) {
      this.memoryHolds.set('state-unreadable', hold);
    } else if (claimed) {
      await this.priceAlertsService.releaseNoticeHold('state-unreadable').catch(() => undefined);
    }
  }

  /** A message went out but its state didn't save: hold repeats of it, in Redis if it will take it. */
  private async holdAfterUnrecordedSend(action: MonitorAction, now: Date): Promise<void> {
    const { kind, since } = holdOf(action);
    const hold: NoticeHold = { at: now.toISOString(), since };
    this.memoryHolds.set(kind, hold);
    await this.priceAlertsService
      .setNoticeHold(kind, hold, STATE_UNREADABLE_NOTICE_MS)
      .catch((error: unknown) => {
        this.logger.error(`Failed to store the price-alert monitor hold: ${String(error)}`);
      });
  }

  /** This instance's memory hold, else the shared one in Redis (unreadable counts as none). */
  private async findHold(kind: NoticeHoldKind, now: Date): Promise<NoticeHold | null> {
    return (
      this.memoryHold(kind, now) ??
      (await this.priceAlertsService.getNoticeHold(kind).catch(() => null))
    );
  }

  private memoryHold(kind: NoticeHoldKind, now: Date): NoticeHold | null {
    const hold = this.memoryHolds.get(kind);
    return hold && now.getTime() - Date.parse(hold.at) < STATE_UNREADABLE_NOTICE_MS ? hold : null;
  }

  /** Never throws. No owner chat configured: nothing is sent (spec EPIC-002-FIX-AC11). */
  private async send(kind: MonitorNotice['kind'], text: string, now: Date): Promise<boolean> {
    if (!this.ownerChatId) {
      this.logger.warn(`Price-alert monitor has a "${kind}" message but OWNER_CHAT_ID is not set`);
      return false;
    }
    let delivered = false;
    try {
      delivered = await this.zaloService.sendTextMessage(this.ownerChatId, text);
    } catch (error) {
      this.logger.error(`Failed to send price-alert monitor message: ${String(error)}`);
    }
    this.logger.log(JSON.stringify({ event: 'price-alert-monitor-notice', kind, delivered }));
    await this.priceAlertsService
      .recordMonitorNotice({ kind, at: now.toISOString(), delivered })
      .catch((error: unknown) => {
        this.logger.error(`Failed to record price-alert monitor notice: ${String(error)}`);
      });
    return delivered;
  }
}
