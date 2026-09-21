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
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const statement = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await sql.query(statement);
  }
  console.log(`Applied ${files.length} migration(s) successfully.`);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
