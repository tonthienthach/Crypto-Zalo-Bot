import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { ZaloModule } from '../zalo/zalo.module';
import { PriceAlertsMonitorService } from './price-alerts-monitor.service';
import { PriceAlertsWatchController } from './price-alerts-watch.controller';
import { PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';

@Module({
  imports: [ConfigModule, CoingeckoModule, ZaloModule],
  controllers: [PriceAlertsController, PriceAlertsWatchController],
  providers: [PriceAlertsService, PriceAlertsMonitorService],
  exports: [PriceAlertsService],
})
export class PriceAlertsModule {}
