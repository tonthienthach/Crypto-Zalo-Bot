import { Logger } from '@nestjs/common';
import { createApp } from './create-app';

/**
 * Local-only entry point (`npm run start:dev` / `npm run start:prod`).
 * On Vercel, api/index.ts builds the same Nest application via createApp()
 * and wraps it as a serverless handler instead of calling listen() — see
 * docs/ARCHITECTURE.md and docs/DEPLOYMENT.md for the local-vs-serverless
 * distinction.
 */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`zalo-crypto-bot listening on port ${port}`, 'Bootstrap');
}

bootstrap();
