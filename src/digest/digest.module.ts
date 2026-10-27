import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { SignalsModule } from '../signals/signals.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { ZaloModule } from '../zalo/zalo.module';
import { DigestController } from './digest.controller';

@Module({
  imports: [
    ConfigModule,
    CoingeckoModule,
    ZaloModule,
    SubscribersModule,
    PortfolioModule,
    SignalsModule,
  ],
  controllers: [DigestController],
})
export class DigestModule {}
