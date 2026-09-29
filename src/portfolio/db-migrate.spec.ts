import path from 'path';

// scripts/db-migrate.js is a plain Node script, tested from here so it runs under `npm test`.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { applyMigrations, splitStatements } = require('../../scripts/db-migrate');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations');

describe('db-migrate (EPIC-003 migration 0002)', () => {
  it('drops comment lines and splits on semicolons', () => {
    expect(splitStatements('-- a comment; with a semicolon\nCREATE A;\n\nCREATE B;\n')).toEqual([
      'CREATE A',
      'CREATE B',
    ]);
  });

  it('runs every file in order, one idempotent statement per call', async () => {
    const statements: string[] = [];
    const sql = { query: jest.fn(async (statement: string) => statements.push(statement)) };

    const files = await applyMigrations(sql, MIGRATIONS_DIR, () => undefined);

    expect(files).toBe(2);
    expect(statements.map((statement) => statement.split('\n')[0])).toEqual([
      'CREATE TABLE IF NOT EXISTS subscribers (',
      'CREATE INDEX IF NOT EXISTS subscribers_is_active_idx ON subscribers (is_active)',
      'CREATE TABLE IF NOT EXISTS portfolio_trades (',
      'ALTER TABLE portfolio_trades',
      'CREATE UNIQUE INDEX IF NOT EXISTS portfolio_trades_chat_source_message_idx',
      'CREATE TABLE IF NOT EXISTS portfolio_usage (',
    ]);
    // Every statement is re-runnable: db-migrate.js applies every file on every call.
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS |ALTER TABLE \w+\s+ADD COLUMN IF NOT EXISTS )/,
      );
    }
  });

  it('adds source_message_id to a portfolio_trades table created before the column existed', async () => {
    const statements: string[] = [];
    const sql = { query: jest.fn(async (statement: string) => statements.push(statement)) };

    await applyMigrations(sql, MIGRATIONS_DIR, () => undefined);

    const alter = statements.find((statement) => statement.startsWith('ALTER TABLE'));
    expect(alter).toContain('ADD COLUMN IF NOT EXISTS source_message_id TEXT');
    // The unique index needs the column, so it must come after the ALTER.
    const index = statements.findIndex((statement) => statement.includes('source_message_idx'));
    expect(index).toBeGreaterThan(statements.indexOf(alter!));
  });
});
