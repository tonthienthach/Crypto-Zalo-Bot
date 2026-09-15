import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const SECRET_HEADER = 'x-cron-secret-token';

/**
 * Protects internal, machine-triggered endpoints (e.g. the daily digest cron
 * hook) that have no Zalo signature to verify — only the configured
 * CRON_SECRET_TOKEN, sent as the `X-Cron-Secret-Token` header by whatever
 * scheduler calls it (GitHub Actions workflow, Vercel Cron, etc.).
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly logger = new Logger(CronSecretGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedSecret = this.configService.get<string>('cron.secretToken');
    const providedSecret = request.headers[SECRET_HEADER] as string | undefined;

    if (!providedSecret || providedSecret !== expectedSecret) {
      this.logger.warn(`Rejected cron call with invalid secret from ${request.ip}`);
      throw new UnauthorizedException('Invalid cron secret');
    }

    return true;
  }
}
