import { Module } from '@nestjs/common';
import { CommandParserService } from './command-parser.service';

@Module({
  providers: [CommandParserService],
  exports: [CommandParserService],
})
export class CommandParserModule {}
