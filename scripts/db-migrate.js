#!/usr/bin/env node
/**
 * One-off admin script: applies every .sql file under db/migrations/, in
 * filename order, against POSTGRES_URL. Not part of the running app — run
 * manually after `vercel env pull` or whenever a new migration file is
 * added (see docs/DEPLOYMENT.md).
 *
 * Usage:
 *   npm run db:migrate
 */
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Neon's HTTP driver executes each call as a single prepared statement —
 * it rejects a file with multiple ;-separated statements in one call
 * ("cannot insert multiple commands into a prepared statement"), unlike
 * psql. Split on ';' and run each statement separately. Naive split is
 * fine here: these migration files are plain DDL with no string literals
 * containing a semicolon.
 */
function splitStatements(content) {
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Applies every .sql file of `migrationsDir`, in filename order, one
 * statement per `sql.query` call. Exported so the tests run this exact code
 * against a real Postgres (EPIC-001 lesson). Returns how many files ran.
 */
async function applyMigrations(sql, migrationsDir, log = console.log) {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    log(`Applying ${file}...`);
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const statement of splitStatements(content)) {
      await sql.query(statement);
    }
  }
  return files.length;
}

async function main() {
  const envFromFile = loadEnvFile(path.resolve(__dirname, '..', '.env'));
  const env = { ...envFromFile, ...process.env };

  const connectionString = env.POSTGRES_URL;
  if (!connectionString) {
    console.error('POSTGRES_URL is missing. Set it in .env or the shell environment.');
    process.exit(1);
  }

  const sql = neon(connectionString);
  const migrationsDir = path.resolve(__dirname, '..', 'db', 'migrations');
  const applied = await applyMigrations(sql, migrationsDir);
  if (applied === 0) {
    console.log('No migration files found.');
    return;
  }
  console.log(`Applied ${applied} migration(s) successfully.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { splitStatements, applyMigrations };
