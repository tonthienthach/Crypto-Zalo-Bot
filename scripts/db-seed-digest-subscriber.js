#!/usr/bin/env node
/**
 * One-off migration script (Initiative 1, see docs/ROADMAP.md): seeds the
 * pre-multi-tenant DIGEST_CHAT_ID/DIGEST_COIN_SYMBOLS env vars as the first
 * row in `subscribers`, so the existing digest recipient keeps receiving it
 * once DigestController switches to reading from the DB. Idempotent — safe
 * to re-run (upserts on chat_id).
 *
 * Usage:
 *   npm run db:seed-digest-subscriber
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
  const chatId = env.DIGEST_CHAT_ID;
  const coinSymbols = (env.DIGEST_COIN_SYMBOLS ?? 'btc,eth,ygg')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!connectionString) {
    console.error('POSTGRES_URL is missing. Set it in .env or the shell environment.');
    process.exit(1);
  }
  if (!chatId) {
    console.error('DIGEST_CHAT_ID is missing — nothing to seed.');
    process.exit(1);
  }

  const sql = neon(connectionString);
  await sql`
    INSERT INTO subscribers (chat_id, watchlist, is_active)
    VALUES (${chatId}, ${coinSymbols}, true)
    ON CONFLICT (chat_id)
    DO UPDATE SET watchlist = EXCLUDED.watchlist, is_active = true
  `;
  console.log(`Seeded subscriber ${chatId} with watchlist [${coinSymbols.join(', ')}].`);
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
