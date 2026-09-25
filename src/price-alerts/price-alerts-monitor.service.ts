import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  formatMonitorMessage,
  formatMonitorStateUnreadableMessage,
} from '../utils/format-message.util';
import { ZaloService } from '../zalo/zalo.service';
import { MonitorAction, MonitorNotice, WatchdogState } from './interfaces/price-alert.interface';
import { evaluateMonitor, evaluateWatchdog } from './price-alert-monitor';
import { MONITOR_RUNS_WINDOW, STATE_UNREADABLE_NOTICE_MS } from './price-alerts.constants';
import { PriceAlertsService } from './price-alerts.service';

/**
 * Runs the EPIC-002-FIX monitoring rules against Redis and messages the
 * owner. The rules themselves are pure (price-alert-monitor.ts); this class
 * only reads state, sends, and stores the state matching what was actually
 * delivered.
 *
 * Redis trouble is handled here (spec EPIC-002-FIX-NFR05): when state can't
 * be read, or a delivered message's state can't be saved, further messages
 * are held to one per STATE_UNREADABLE_NOTICE_MS using this instance's
 * memory — the only thing left to remember with.
 */
@Injectable()
export class PriceAlertsMonitorService {
  private readonly logger = new Logger(PriceAlertsMonitorService.name);
  private readonly ownerChatId: string | undefined;
  /** Last message this instance sent without being able to store that it did. */
  private lastUnrecordedSendAt: number | null = null;

  constructor(
    private readonly priceAlertsService: PriceAlertsService,
    private readonly zaloService: ZaloService,
    configService: ConfigService,
  ) {
    this.ownerChatId = configService.get<string>('monitoring.ownerChatId') || undefined;
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

    const delivered = decision.action ? await this.notify(decision.action, now) : false;
    const next = {
      ...(delivered ? decision.onSent : decision.onNotSent),
      ownerChatConfigured: this.ownerChatId !== undefined,
    };
    try {
      await this.priceAlertsService.setMonitorState(next);
      this.lastUnrecordedSendAt = null;
    } catch (error) {
      this.logger.error(`Price-alert watcher can't save its state: ${String(error)}`);
      if (delivered) this.lastUnrecordedSendAt = now.getTime();
    }
  }

  /**
   * The check's look at the watcher (spec EPIC-002-FIX-FR07). Only writes
   * when the watchdog state changes, so a healthy watcher costs one read.
   */
  async checkWatcher(now: Date = new Date()): Promise<void> {
    const [monitor, watchdog] = await this.priceAlertsService.getMonitorAndWatchdogState();
    const decision = evaluateWatchdog(watchdog, monitor?.lastWatcherRunAt ?? null, now);
    const delivered = decision.action ? await this.notify(decision.action, now) : false;
    const next: WatchdogState = delivered ? decision.onSent : decision.onNotSent;
    if (JSON.stringify(next) !== JSON.stringify(watchdog ?? { outage: null })) {
      await this.priceAlertsService.setWatchdogState(next);
    }
  }

  private async notify(action: MonitorAction, now: Date): Promise<boolean> {
    if (this.withinUnrecordedWindow(now)) {
      return false;
    }
    const activeAlerts =
      action.kind === 'down' || action.kind === 'reminder'
        ? await this.priceAlertsService.countAlerts().catch(() => 0)
        : 0;
    return this.send(action.kind, formatMonitorMessage(action, activeAlerts), now);
  }

  /** For messages whose sending can't be stored: at most one per window per instance. */
  private async sendUnrecorded(kind: MonitorNotice['kind'], text: string, now: Date) {
    if (this.withinUnrecordedWindow(now)) {
      return;
    }
    if (await this.send(kind, text, now)) {
      this.lastUnrecordedSendAt = now.getTime();
    }
  }

  private withinUnrecordedWindow(now: Date): boolean {
    return (
      this.lastUnrecordedSendAt !== null &&
      now.getTime() - this.lastUnrecordedSendAt < STATE_UNREADABLE_NOTICE_MS
    );
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
