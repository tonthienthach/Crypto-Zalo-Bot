import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watchSecretReusedAs } from '../common/guards/secret-equals';
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
 * are held to one per STATE_UNREADABLE_NOTICE_MS. The hold lives in Redis
 * (a key with that TTL), so every instance and every cold start sees it, and
 * a later successful save does not lift it early. Only when Redis can't hold
 * it either does this instance's memory stand in — the one thing left to
 * remember with.
 */
@Injectable()
export class PriceAlertsMonitorService {
  private readonly logger = new Logger(PriceAlertsMonitorService.name);
  private readonly ownerChatId: string | undefined;
  /** Last message this instance sent without being able to store that it did (the fallback hold). */
  private lastUnrecordedSendAt: number | null = null;

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
    } catch (error) {
      this.logger.error(`Price-alert watcher can't save its state: ${String(error)}`);
      if (delivered) await this.holdAfterUnrecordedSend(now);
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
    if (JSON.stringify(next) === JSON.stringify(watchdog ?? { outage: null })) {
      return;
    }
    try {
      await this.priceAlertsService.setWatchdogState(next);
    } catch (error) {
      // Same rule as the watcher: a delivered message we couldn't record
      // must not repeat every 5 minutes (spec EPIC-002-FIX-NFR05).
      if (delivered) await this.holdAfterUnrecordedSend(now);
      throw error;
    }
  }

  private async notify(action: MonitorAction, now: Date): Promise<boolean> {
    if (await this.isHeld(now)) {
      return false;
    }
    const activeAlerts =
      action.kind === 'down' || action.kind === 'reminder'
        ? await this.priceAlertsService.countAlerts().catch(() => 0)
        : 0;
    return this.send(action.kind, formatMonitorMessage(action, activeAlerts), now);
  }

  /**
   * For messages whose sending can't be stored in the monitoring state: at
   * most one per window across instances. The hold is claimed before sending
   * (SET NX), so two instances can't both send; a send that fails gives the
   * claim back. When Redis can't take the claim, this instance's memory is
   * the hold.
   */
  private async sendUnrecorded(kind: MonitorNotice['kind'], text: string, now: Date) {
    if (this.withinMemoryHold(now)) {
      return;
    }
    const claimed = await this.priceAlertsService
      .claimNoticeHold(now, STATE_UNREADABLE_NOTICE_MS)
      .catch(() => null);
    if (claimed === false) {
      return; // Another instance (or an earlier run) already told the owner this hour.
    }
    if (await this.send(kind, text, now)) {
      this.lastUnrecordedSendAt = now.getTime();
    } else if (claimed) {
      await this.priceAlertsService.releaseNoticeHold().catch(() => undefined);
    }
  }

  /** A message went out but its state didn't save: hold repeats, in Redis if it will take it. */
  private async holdAfterUnrecordedSend(now: Date): Promise<void> {
    this.lastUnrecordedSendAt = now.getTime();
    await this.priceAlertsService
      .setNoticeHold(now, STATE_UNREADABLE_NOTICE_MS)
      .catch((error: unknown) => {
        this.logger.error(`Failed to store the price-alert monitor hold: ${String(error)}`);
      });
  }

  /** Held by this instance's memory, or by the shared hold in Redis (unreadable counts as not held). */
  private async isHeld(now: Date): Promise<boolean> {
    if (this.withinMemoryHold(now)) {
      return true;
    }
    return this.priceAlertsService.hasNoticeHold().catch(() => false);
  }

  private withinMemoryHold(now: Date): boolean {
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
