import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
