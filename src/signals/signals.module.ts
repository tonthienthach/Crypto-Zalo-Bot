import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { SignalsHistoryService } from './signals-history.service';
import { SignalsStateService } from './signals-state.service';
import { SignalsSubscriptionsMirror } from './signals-subscriptions-mirror';
import { SignalsService } from './signals.service';

@Module({
  imports: [ConfigModule, CoingeckoModule],
  providers: [
    SignalsHistoryService,
    SignalsStateService,
    SignalsService,
    SignalsSubscriptionsMirror,
  ],
  exports: [SignalsService, SignalsStateService, SignalsSubscriptionsMirror],
})
export class SignalsModule {}
