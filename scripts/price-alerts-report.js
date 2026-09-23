#!/usr/bin/env node
/**
 * Read-only admin report for price alerts (EPIC-002): reads the capped run
 * and delivery logs the /cron/price-alerts check writes to Upstash Redis and
 * prints what docs/epics/EPIC-002 needs to be checked after deploy:
 *
 *   - gap between consecutive check runs (p50/p95/max) — spec AC18 wants
 *     p95 <= 90s over 24h
 *   - run duration p95 — spec NFR02 wants <= 15s
 *   - deliveries per chat — the intent.md success metric (>=1 alert from a
 *     chat other than the owner delivered within 30 days)
 *
 * Never writes anything. Reads KV_REST_API_URL / KV_REST_API_TOKEN from .env
 * (e.g. after `vercel env pull .env`) or the shell environment.
 *
 * Usage:
 *   npm run alerts:report
 */
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

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

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function seconds(ms) {
  return ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const envFromFile = loadEnvFile(path.resolve(__dirname, '..', '.env'));
  const env = { ...envFromFile, ...process.env };
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) {
    console.error('KV_REST_API_URL / KV_REST_API_TOKEN missing. Run `vercel env pull .env` first.');
    process.exit(1);
  }
  const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });

  const [runs, successes, failures, alertCount] = await Promise.all([
    redis.lrange('price-alerts:runs', 0, -1),
    redis.lrange('price-alerts:deliveries', 0, -1),
    redis.lrange('price-alerts:delivery-failures', 0, -1),
    redis.scard('price-alerts:ids'),
  ]);

  // Logs are newest-first; sort oldest-first by start time to measure gaps.
  const starts = runs.map((run) => Date.parse(run.startedAt)).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((start, i) => start - starts[i]).sort((a, b) => a - b);
  const durations = runs.map((run) => run.durationMs).sort((a, b) => a - b);

  console.log(`Active alerts: ${alertCount}`);
  console.log(
    `Runs logged: ${runs.length}` +
      (starts.length > 0
        ? ` (${new Date(starts[0]).toISOString()} -> ${new Date(starts[starts.length - 1]).toISOString()})`
        : ''),
  );
  console.log(
    `Gap between runs: p50 ${seconds(percentile(gaps, 50))}, p95 ${seconds(
      percentile(gaps, 95),
    )}, max ${seconds(gaps.length ? gaps[gaps.length - 1] : null)}  [AC18: p95 <= 90s]`,
  );
  console.log(
    `Run duration: p95 ${seconds(percentile(durations, 95))}, max ${seconds(
      durations.length ? durations[durations.length - 1] : null,
    )}  [NFR02: <= 15s]`,
  );
  console.log(
    `Totals over logged runs: fired ${runs.reduce((n, r) => n + r.fired, 0)}, failed ${runs.reduce(
      (n, r) => n + r.failed,
      0,
    )}, rearmed ${runs.reduce((n, r) => n + r.rearmed, 0)}, deferred ${runs.reduce(
      (n, r) => n + (r.deferred ?? 0),
      0,
    )}`,
  );

  const byChat = new Map();
  for (const delivery of [...successes, ...failures]) {
    const entry = byChat.get(delivery.chatId) ?? { delivered: 0, failed: 0 };
    entry[delivery.delivered ? 'delivered' : 'failed']++;
    byChat.set(delivery.chatId, entry);
  }
  console.log(`\nDeliveries logged: ${successes.length} delivered, ${failures.length} failed`);
  for (const [chatId, entry] of byChat) {
    console.log(`  ${chatId}: ${entry.delivered} delivered, ${entry.failed} failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
