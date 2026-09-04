import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { buildSanitizedErrorBody } from './http-exception.filter';

/**
 * Global catch-all exception filter. Guarantees two things:
 *  1. No stack trace or internal error detail is ever sent to the client.
 *  2. An *unexpected* (non-HttpException) error on a /webhook request still
 *     acks with 200, because Zalo (like most bot platforms) retries on
 *     non-2xx responses — a bug must never turn into a retry storm. This
 *     does NOT apply to deliberate HttpExceptions such as
 *     WebhookSecretGuard's 401 or DTO validation's 400: those are
 *     intentional rejections and must keep their real status code, or auth
 *     enforcement would be silently defeated. The WebhookController itself
 *     already catches business errors (unknown coin, CoinGecko outage) and
 *     replies in-chat; this filter is the last resort for anything else.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttpException ? exception.message : 'Internal server error';

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}: ${
        exception instanceof Error ? exception.stack : String(exception)
      }`,
    );

    if (!isHttpException && request.path?.startsWith('/webhook')) {
      response.status(HttpStatus.OK).json({ ok: true });
      return;
    }

    response.status(status).json(buildSanitizedErrorBody(status, message, request.url));
  }
}
