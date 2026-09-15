import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { ZaloModule } from '../zalo/zalo.module';
import { DigestController } from './digest.controller';

@Module({
  imports: [ConfigModule, CoingeckoModule, ZaloModule],
  controllers: [DigestController],
})
export class DigestModule {}
