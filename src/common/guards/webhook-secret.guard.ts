import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const SECRET_HEADER = 'x-webhook-secret';
const SECRET_QUERY_PARAM = 'secret';

/**
 * Protects the /webhook endpoint: only requests carrying the configured
 * WEBHOOK_SECRET_TOKEN (as header or query param) are accepted. This is a
 * lightweight substitute for Zalo Bot Platform request signing — configure
 * the same secret as part of the webhook URL or headers when registering
 * the webhook (see docs/SETUP.md and docs/DEPLOYMENT.md).
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSecretGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedSecret = this.configService.get<string>('zalo.webhookSecretToken');

    const providedSecret =
      (request.headers[SECRET_HEADER] as string | undefined) ??
      (request.query[SECRET_QUERY_PARAM] as string | undefined);

    if (!providedSecret || providedSecret !== expectedSecret) {
      this.logger.warn(`Rejected webhook call with invalid secret from ${request.ip}`);
      throw new UnauthorizedException('Invalid webhook secret');
    }

    return true;
  }
}
