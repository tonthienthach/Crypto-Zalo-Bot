import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoingeckoService } from './coingecko.service';

@Module({
  imports: [HttpModule, ConfigModule, CacheModule.register({ isGlobal: false })],
  providers: [CoingeckoService],
  exports: [CoingeckoService],
})
export class CoingeckoModule {}
