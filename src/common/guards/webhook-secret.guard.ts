import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Confirmed against https://bot.zaloplatforms.com/docs/webhook/: Zalo signs
 * every webhook request with this exact header, carrying the `secret_token`
 * value that was registered via the `setWebhook` API call (see
 * docs/SETUP.md). Express lowercases incoming header names.
 */
const SECRET_HEADER = 'x-bot-api-secret-token';
/** Fallback query param, for manual/local testing only — Zalo itself only ever sends the header above. */
const SECRET_QUERY_PARAM = 'secret';

/**
 * Protects the /webhook endpoint: only requests carrying the configured
 * WEBHOOK_SECRET_TOKEN (as the `X-Bot-Api-Secret-Token` header Zalo sends,
 * or a `?secret=` query param for manual testing) are accepted.
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
