import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { ZaloModule } from '../zalo/zalo.module';
import { PriceAlertsService } from './price-alerts.service';

@Module({
  imports: [ConfigModule, CoingeckoModule, ZaloModule],
  providers: [PriceAlertsService],
  exports: [PriceAlertsService],
})
export class PriceAlertsModule {}
