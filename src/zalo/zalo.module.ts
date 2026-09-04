import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZaloService } from './zalo.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [ZaloService],
  exports: [ZaloService],
})
export class ZaloModule {}
