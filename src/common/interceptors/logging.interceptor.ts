import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Structured request/response logging: method, path, status, duration. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          this.logger.log(JSON.stringify({ method, path: originalUrl, durationMs, status: 'ok' }));
        },
        error: (error: unknown) => {
          const durationMs = Date.now() - start;
          this.logger.warn(
            JSON.stringify({
              method,
              path: originalUrl,
              durationMs,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      }),
    );
  }
}
