#!/usr/bin/env node
/**
 * Read-only admin report for portfolio tracking (EPIC-003): reads the
 * per-chat per-day usage counter (`portfolio_usage`, no amounts) and prints,
 * per chat, its first day, days used, views/writes and whether it came back
 * after its first day — the intent.md §5 success metric (>= 1 chat other
 * than the owner recorded a portfolio and still used it after its first day).
 *
 * Never writes anything. Reads POSTGRES_URL and OWNER_CHAT_ID (optional,
 * excluded from the metric) from the shell environment, else `.env`.
 *
 * Usage:
 *   npm run portfolio:report
 */
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { summarizeUsage, successMetric } = require('./portfolio-usage-report.lib');

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
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    result[key] = value;
  }
  return result;
}

function printReport(chats, ownerChatId) {
  console.log(`Chats that used /danhmuc: ${chats.length}`);
  for (const chat of chats) {
    const owner = chat.chatId === ownerChatId ? ' (owner)' : '';
    console.log(
      `  ${chat.chatId}${owner}: first ${chat.firstDay}, ${chat.activeDays} day(s), ` +
        `${chat.views} view(s), ${chat.writes} write(s)` +
        (chat.usedAfterFirstDay ? ', used after first day' : ''),
    );
  }
  const metric = successMetric(chats, ownerChatId);
  console.log(
    `\nSuccess metric (>= 1 non-owner chat recorded a portfolio and came back): ${
      metric.met ? 'MET' : 'not yet'
    }${metric.qualifying.length ? ` — ${metric.qualifying.join(', ')}` : ''}`,
  );
  if (!ownerChatId) {
    console.log('(OWNER_CHAT_ID not set: the owner chat is not excluded above.)');
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const env = { ...loadEnvFile(path.join(root, '.env')), ...process.env };
  if (!env.POSTGRES_URL) {
    console.error('POSTGRES_URL is missing. Set it in .env or the shell environment.');
    process.exit(1);
  }
  const sql = neon(env.POSTGRES_URL);
  const rows = await sql`SELECT chat_id, day, views, writes FROM portfolio_usage`;
  printReport(summarizeUsage(rows), env.OWNER_CHAT_ID || undefined);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { printReport };
