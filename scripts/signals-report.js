#!/usr/bin/env node
/**
 * Read-only admin report for signals (EPIC-004): reads what the bot writes
 * to Upstash Redis and prints
 *
 *   - the success metric of the intent (spec EPIC-004-FR12, AC17): chats
 *     other than the owner that used `/tinhieu` and came back on a later
 *     day, within the last 45 days of usage counters
 *   - each such chat: first day, days used, signal messages received
 *   - the overall accuracy of the buy/sell verdicts that were sent
 *   - the latest check runs and the last healthy one
 *
 * Never writes anything and only uses read commands (GET, HGETALL, LRANGE,
 * ZRANGE, SCAN), so an Upstash read-only token is enough. Reads
 * KV_REST_API_URL / KV_REST_API_TOKEN (and optionally OWNER_CHAT_ID, to leave
 * the owner out) from the shell environment, else `.env.alerts`, else `.env`
 * — the same files as `npm run alerts:report` (docs/DEPLOYMENT.md §8a).
 * Chat ids are printed in full: run it only on your own machine.
 *
 * Usage:
 *   npm run signals:report
 */
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');
const {
  hashToRecord,
  parsePoints,
  parseRecords,
  scoreAll,
  successSummary,
  summarizeChats,
} = require('./signals-report.lib');

const USAGE_DAYS = 45;

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    result[trimmed.slice(0, eqIndex).trim()] = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
  }
  return result;
}

function rate(tally) {
  return tally.scored === 0
    ? 'no verdict old enough yet'
    : `${tally.correct}/${tally.scored} right (${((tally.correct / tally.scored) * 100).toFixed(1)}%)`;
}

/** Every read the report makes, in one place — read-only commands only. */
async function readAll(redis, now) {
  const days = Array.from({ length: USAGE_DAYS }, (_, i) =>
    new Date(now - i * 86_400_000).toISOString().slice(0, 10),
  );
  const usageHashes = await Promise.all(days.map((day) => redis.hgetall(`signals:use:${day}`)));
  const usageByDay = Object.fromEntries(days.map((day, i) => [day, usageHashes[i]]));

  const recordKeys = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'signals:rec:*', count: 200 });
    cursor = String(next);
    recordKeys.push(...keys);
  } while (cursor !== '0');
  const recordHashes = await Promise.all(recordKeys.map((key) => redis.hgetall(key)));
  const recordsByChat = Object.fromEntries(
    recordKeys.map((key, i) => [key.slice('signals:rec:'.length), parseRecords(recordHashes[i])]),
  );

  const symbols = Array.from(
    new Set(Object.values(recordsByChat).flatMap((records) => records.map((r) => r.symbol))),
  );
  const historyBySymbol = {};
  for (const symbol of symbols) {
    const [hourly, daily] = await Promise.all([
      redis.zrange(`signals:hour:${symbol}`, 0, -1),
      redis.zrange(`signals:day:${symbol}`, 0, -1),
    ]);
    historyBySymbol[symbol] = [...parsePoints(daily), ...parsePoints(hourly)].sort(
      (a, b) => a.t - b.t,
    );
  }

  const [lastHealthy, runs] = await Promise.all([
    redis.get('signals:last-healthy'),
    redis.lrange('signals:runs', 0, 9),
  ]);
  return { usageByDay, recordsByChat, historyBySymbol, lastHealthy, runs };
}

function printReport(data, ownerChatId, now) {
  const chats = summarizeChats(data.usageByDay, ownerChatId);
  const success = successSummary(chats);

  console.log(`Success metric (last ${USAGE_DAYS} days of usage counters, owner excluded):`);
  console.log(`  Chats seen: ${success.chatsSeen}`);
  console.log(`  Used /tinhieu at least once: ${success.usedCommand}`);
  console.log(`  Used /tinhieu on 2+ different days (came back): ${success.returned}`);
  console.log(
    `  Got or used signals on 2+ different days (incl. passive): ${success.receivedAgain}`,
  );
  console.log(
    `  => ${success.met ? 'MET' : 'not met yet'} (target: >= 1 chat other than the owner comes back within 30 days)`,
  );
  if (!ownerChatId) console.log('  (OWNER_CHAT_ID not set: the owner is counted like any chat)');

  console.log('\nChats:');
  for (const chat of chats) {
    console.log(
      `  ${chat.chatId}: first ${chat.firstDay}, command days ${chat.commandDays.size}, ` +
        `active days ${chat.activeDays.size}, commands ${chat.counts.command}, ` +
        `alerts ${chat.counts.alert}, digests ${chat.counts.digest}`,
    );
  }

  const score = scoreAll(data.recordsByChat, data.historyBySymbol, now);
  console.log('\nVerdicts sent (all chats, last 90 days kept):');
  console.log(`  buy:  ${rate(score.buy)}`);
  console.log(`  sell: ${rate(score.sell)}`);
  console.log(`  pending (under 3 days old or no later price): ${score.pending}`);

  console.log(`\nLast healthy check run: ${data.lastHealthy ?? 'never'}`);
  console.log(`Latest runs (newest first): ${data.runs.length ? '' : 'none'}`);
  for (const raw of data.runs) {
    const run = typeof raw === 'string' ? JSON.parse(raw) : raw;
    console.log(
      `  ${run.at} ${run.outcome} coins ${run.coins}, alerted ${run.chatsAlerted}, failures ${run.failures}, ` +
        `deferred ${run.deferred ?? 0}, ${run.durationMs}ms`,
    );
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const env = {
    ...loadEnvFile(path.join(root, '.env')),
    ...loadEnvFile(path.join(root, '.env.alerts')),
    ...process.env,
  };
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN || env.KV_REST_API_URL.includes('SENSITIVE')) {
    console.error(
      'KV_REST_API_URL / KV_REST_API_TOKEN missing. Copy them from Upstash Console -> your database ' +
        '-> REST API (the read-only token is enough) into .env.alerts.',
    );
    process.exit(1);
  }
  const redis = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
    automaticDeserialization: false,
  });
  const now = Date.now();
  printReport(await readAll(redis, now), env.OWNER_CHAT_ID, now);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { readAll, printReport, hashToRecord };
