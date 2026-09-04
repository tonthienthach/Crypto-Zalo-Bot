import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Builds and configures the Nest application without calling listen().
 * Shared by src/main.ts (local dev server) and api/index.ts (Vercel
 * serverless handler) so both entry points apply identical global pipes —
 * see docs/ARCHITECTURE.md for why the two entry points exist.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  return app;
}
