import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoinPaprikaService } from './coinpaprika.service';

@Module({
  imports: [HttpModule, ConfigModule, CacheModule.register({ isGlobal: false })],
  providers: [CoinPaprikaService],
  exports: [CoinPaprikaService],
})
export class CoinPaprikaModule {}
