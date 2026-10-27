import { Injectable, Logger } from '@nestjs/common';
import { SignalsStateService } from './signals-state.service';

/**
 * Keeps the Redis copy of each chat's watchlist in step with Postgres, so the
 * periodic signals check never has to query Postgres (that would keep the
 * Neon compute awake, see docs/ARCHITECTURE.md). Every method swallows and
 * logs its failure: a missed update must never break the command that
 * caused it, and the daily digest resyncs the whole copy.
 */
@Injectable()
export class SignalsSubscriptionsMirror {
  private readonly logger = new Logger(SignalsSubscriptionsMirror.name);

  constructor(private readonly state: SignalsStateService) {}

  async onSubscribed(chatId: string, watchlist: string[]): Promise<void> {
    await this.guard(`subscribe ${chatId}`, () => this.state.setWatchlist(chatId, watchlist));
  }

  async onWatchlistChanged(chatId: string, watchlist: string[]): Promise<void> {
    await this.guard(`watchlist ${chatId}`, () => this.state.setWatchlist(chatId, watchlist));
  }

  async onUnsubscribed(chatId: string): Promise<void> {
    await this.guard(`unsubscribe ${chatId}`, () => this.state.removeWatchlist(chatId));
  }

  /** Replaces the whole copy from the active subscribers (the daily digest does this). */
  async syncAll(subscribers: { chatId: string; watchlist: string[] }[]): Promise<void> {
    await this.guard('sync', () =>
      this.state.replaceWatchlists(
        Object.fromEntries(subscribers.map((s) => [s.chatId, s.watchlist])),
      ),
    );
  }

  private async guard(what: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error(`Watchlist mirror ${what} failed: ${(error as Error).message}`);
    }
  }
}
