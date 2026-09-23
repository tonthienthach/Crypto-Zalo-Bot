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
const BEARER_PREFIX = 'Bearer ';

/**
 * Protects internal, machine-triggered endpoints (e.g. the daily digest cron
 * hook) that have no Zalo signature to verify — only the configured
 * CRON_SECRET_TOKEN, sent either as the `X-Cron-Secret-Token` header (manual
 * curl calls, legacy GitHub Actions workflow) or as `Authorization: Bearer
 * <CRON_SECRET>` — the header Vercel Cron automatically attaches when a
 * project env var named exactly `CRON_SECRET` is set, so keep that var equal
 * to `CRON_SECRET_TOKEN` (see docs/DEPLOYMENT.md).
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly logger = new Logger(CronSecretGuard.name);
  /** Config path of the secret this guard checks — overridden by subclasses with their own secret. */
  protected readonly secretConfigKey: string = 'cron.secretToken';

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedSecret = this.configService.get<string>(this.secretConfigKey);
    const providedSecret = this.extractProvidedSecret(request);

    // An unset expected secret rejects every call instead of matching nothing-vs-nothing.
    if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
      this.logger.warn(`Rejected cron call with invalid secret from ${request.ip}`);
      throw new UnauthorizedException('Invalid cron secret');
    }

    return true;
  }

  private extractProvidedSecret(request: Request): string | undefined {
    const customHeader = request.headers[SECRET_HEADER] as string | undefined;
    if (customHeader) return customHeader;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      return authHeader.slice(BEARER_PREFIX.length);
    }

    return undefined;
  }
}
