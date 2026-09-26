/**
 * Opt-in integration test: runs the real PortfolioService and the real
 * scripts/db-migrate.js through the real @neondatabase/serverless driver
 * against a scratch Postgres (EPIC-001 lesson: prove the driver actually
 * used in production, not psql). Skipped unless PORTFOLIO_INT_DATABASE_URL
 * is set, so CI's `npm run test:e2e` stays self-contained. Local setup
 * (docs/epics/EPIC-003/artifacts/plan.md §6):
 *
 *   docker run -d --name pf-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16-alpine
 *   docker run -d --name pf-neon-proxy -p 4444:4444 \
 *     -e PG_CONNECTION_STRING=postgres://postgres:postgres@host.docker.internal:5432/postgres \
 *     ghcr.io/timowilhelm/local-neon-http-proxy:main
 *   PORTFOLIO_INT_DATABASE_URL=postgres://postgres:postgres@db.localtest.me:4444/postgres \
 *   PORTFOLIO_INT_FETCH_ENDPOINT=http://db.localtest.me:4444/sql \
 *     npm run test:e2e -- portfolio.postgres
 *
 * Or a throwaway Neon branch (leave PORTFOLIO_INT_FETCH_ENDPOINT unset).
 * WARNING: deletes every portfolio row before each test — never point it at
 * production.
 */
import path from 'path';
import { neon, neonConfig } from '@neondatabase/serverless';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PortfolioService } from '../src/portfolio/portfolio.service';
import { definePortfolioStoreScenarios } from './support/portfolio-store.scenarios';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { applyMigrations } = require('../scripts/db-migrate');

const url = process.env.PORTFOLIO_INT_DATABASE_URL;
const fetchEndpoint = process.env.PORTFOLIO_INT_FETCH_ENDPOINT;
const describeIfPostgres = url ? describe : describe.skip;

describeIfPostgres('PortfolioService against a real Postgres (integration)', () => {
  let service: PortfolioService;
  const sql = () => neon(url!);

  beforeAll(async () => {
    if (fetchEndpoint) {
      neonConfig.fetchEndpoint = fetchEndpoint;
    }
    const migrationsDir = path.resolve(__dirname, '..', 'db', 'migrations');
    // Twice, as every deploy re-runs every file: the migrations must be idempotent.
    await applyMigrations(sql(), migrationsDir, () => undefined);
    await applyMigrations(sql(), migrationsDir, () => undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [PortfolioService, { provide: ConfigService, useValue: { get: () => url } }],
    }).compile();
    service = moduleRef.get(PortfolioService);
  });

  definePortfolioStoreScenarios({
    service: () => service,
    exec: async (text, params = []) =>
      (await sql().query(text, params)) as Record<string, unknown>[],
  });
});
