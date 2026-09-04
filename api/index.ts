import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../src/create-app';

/**
 * Vercel serverless entry point. Each Lambda invocation may land on a
 * previously "warm" instance or a brand-new ("cold") one; `cachedApp` is
 * module-level state that only survives across invocations on the SAME warm
 * instance, so the Nest application context is built at most once per
 * instance instead of once per request. See docs/ARCHITECTURE.md for the
 * full cold-start / in-memory-cache discussion.
 */
let cachedAppPromise: Promise<NestExpressApplication> | null = null;

async function getApp(): Promise<NestExpressApplication> {
  if (!cachedAppPromise) {
    cachedAppPromise = (async () => {
      const app = await createApp();
      await app.init();
      return app as unknown as NestExpressApplication;
    })();
  }
  return cachedAppPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance(req, res);
}
