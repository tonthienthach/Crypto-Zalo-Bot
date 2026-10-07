import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatSignalsMonitorMessage } from '../utils/format-signals.util';
import { ZaloService } from '../zalo/zalo.service';
import { SignalsMonitorAction } from './interfaces/signal.interface';
import { evaluateSignalsMonitor } from './signals-monitor';
import { SignalsStateService } from './signals-state.service';

/**
 * Messages the owner when the signals check stops (spec EPIC-004-NFR07). It
 * rides on the existing watcher (QStash, every 5 minutes, see
 * PriceAlertsWatchController) instead of adding a scheduler: a stopped
 * check can't report itself, and that watcher is already independent of
 * cron-job.org. Uses the same owner chat (OWNER_CHAT_ID) as the price-alert
 * monitoring, with its own state, so it never changes how that one works.
 */
@Injectable()
export class SignalsMonitorService {
  private readonly logger = new Logger(SignalsMonitorService.name);
  private readonly ownerChatId: string | undefined;

  constructor(
    private readonly state: SignalsStateService,
    private readonly zaloService: ZaloService,
    configService: ConfigService,
  ) {
    this.ownerChatId = configService.get<string>('monitoring.ownerChatId') || undefined;
  }

  /**
   * One look at the check's health. The outage is recorded before a "down" is
   * sent (SET NX), so two overlapping watcher calls can't both send it; a
   * failed send gives the claim back so the next call retries. Reads cost one
   * Redis command per call while healthy.
   */
  async check(now: Date = new Date()): Promise<void> {
    const [lastHealthyAt, outage] = await this.state.getHealthAndOutage();
    const action = evaluateSignalsMonitor(lastHealthyAt, outage, now);
    if (!action) return;
    if (!this.ownerChatId) {
      this.logger.warn(
        `Signals monitor has a "${action.kind}" message but OWNER_CHAT_ID is not set`,
      );
      return;
    }

    switch (action.kind) {
      case 'down': {
        const claimed = await this.state.claimOutage({
          since: action.lastHealthyAt,
          notifiedAt: now.toISOString(),
        });
        if (!claimed) return;
        if (!(await this.send(action, now))) await this.state.clearOutage();
        return;
      }
      case 'reminder': {
        if (await this.send(action, now)) {
          await this.state.setOutage({ since: action.since, notifiedAt: now.toISOString() });
        }
        return;
      }
      case 'recovered': {
        const taken = await this.state.takeOutage();
        if (!taken) return;
        if (!(await this.send(action, now))) await this.state.setOutage(taken);
        return;
      }
    }
  }

  /** Never throws. The latest run's outcome is added to a down/reminder message as a hint at the cause. */
  private async send(action: SignalsMonitorAction, now: Date): Promise<boolean> {
    let lastRunOutcome: string | null = null;
    if (action.kind !== 'recovered') {
      lastRunOutcome = await this.state
        .listRecentRuns(1)
        .then((runs) => runs[0]?.outcome ?? null)
        .catch(() => null);
    }
    let delivered = false;
    try {
      delivered = await this.zaloService.sendTextMessage(
        this.ownerChatId!,
        formatSignalsMonitorMessage(action, lastRunOutcome),
      );
    } catch (error) {
      this.logger.error(`Failed to send signals monitor message: ${String(error)}`);
    }
    this.logger.log(
      JSON.stringify({
        event: 'signals-monitor-notice',
        kind: action.kind,
        delivered,
        at: now.toISOString(),
      }),
    );
    return delivered;
  }
}
