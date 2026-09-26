import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [ConfigModule],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
