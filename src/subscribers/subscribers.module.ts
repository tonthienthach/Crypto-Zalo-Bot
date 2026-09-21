import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SubscribersService } from './subscribers.service';

@Module({
  imports: [ConfigModule],
  providers: [SubscribersService],
  exports: [SubscribersService],
})
export class SubscribersModule {}
