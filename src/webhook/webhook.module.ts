import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoModule } from '../coingecko/coingecko.module';
import { CommandParserModule } from '../command-parser/command-parser.module';
import { PriceAlertsModule } from '../price-alerts/price-alerts.module';
import { SubscribersModule } from '../subscribers/subscribers.module';
import { ZaloModule } from '../zalo/zalo.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [
    ConfigModule,
    CoingeckoModule,
    CommandParserModule,
    ZaloModule,
    SubscribersModule,
    PriceAlertsModule,
  ],
  controllers: [WebhookController],
})
export class WebhookModule {}
