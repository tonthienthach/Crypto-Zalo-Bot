import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoinPaprikaModule } from '../coinpaprika/coinpaprika.module';
import { CoingeckoService } from './coingecko.service';

@Module({
  imports: [HttpModule, ConfigModule, CacheModule.register({ isGlobal: false }), CoinPaprikaModule],
  providers: [CoingeckoService],
  exports: [CoingeckoService],
})
export class CoingeckoModule {}
