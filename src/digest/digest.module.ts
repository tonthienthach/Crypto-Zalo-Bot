import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { ZaloModule } from '../zalo/zalo.module';
import { DigestController } from './digest.controller';

@Module({
  imports: [ConfigModule, CoingeckoModule, ZaloModule, SubscribersModule],
  controllers: [DigestController],
})
export class DigestModule {}
