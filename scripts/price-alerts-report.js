#!/usr/bin/env node
/**
 * Read-only admin report for price alerts (EPIC-002, EPIC-002-FIX): reads
 * what the /cron/price-alerts check and the /cron/price-alerts-watch watcher
 * write to Upstash Redis, and prints:
 *
 *   - runs by outcome (healthy / no-price / failed / skipped) and rejected
 *     calls, over the logged window (~24h)
 *   - every stretch of >= 15 min without a healthy run, with what was seen
 *     in it ("not called", rejected, no price, failed, skipped)
 *   - last healthy run, last watcher run, whether OWNER_CHAT_ID is set, and
 *     the last monitoring messages
 *   - gap between healthy runs (EPIC-002 AC18: p95 <= 90s) and healthy run
 *     duration (NFR02: <= 15s)
 *   - deliveries per chat — the EPIC-002 intent success metric
 *
 * Never writes anything, and only uses read commands, so an Upstash
 * read-only token is enough (EPIC-002-FIX-NFR11). Reads KV_REST_API_URL /
 * KV_REST_API_TOKEN from the shell environment, else `.env.alerts`, else
 * `.env`. The production values are Sensitive on Vercel, so `vercel env
 * pull` can't fetch them: copy them from Upstash Console (see
 * docs/DEPLOYMENT.md §8a).
 *
 * Usage:
 *   npm run alerts:report
 */
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');
const {
  countOutcomes,
  flattenRejections,
  buildOutages,
  healthyStats,
} = require('./price-alerts-report.lib');

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

function seconds(ms) {
  return ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)}s`;
}

function minutes(ms) {
  return `${Math.round(ms / 60_000)} min`;
}

function time(ms) {
  return ms === null || ms === undefined ? 'never' : new Date(ms).toISOString();
}

/** Every read the report makes, in one place — read-only commands only. */
async function readAll(redis, now) {
  const days = [0, 1].map((i) => new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  const [runs, successes, failures, alertCount, monitor, notices, ...rejectedHashes] =
    await Promise.all([
      redis.lrange('price-alerts:runs', 0, -1),
      redis.lrange('price-alerts:deliveries', 0, -1),
      redis.lrange('price-alerts:delivery-failures', 0, -1),
      redis.scard('price-alerts:ids'),
      redis.get('price-alerts:monitor'),
      redis.lrange('price-alerts:monitor-notices', 0, 4),
      ...days.map((day) => redis.hgetall(`price-alerts:rejected:${day}`)),
    ]);
  const hashesByDay = Object.fromEntries(days.map((day, i) => [day, rejectedHashes[i]]));
  return { runs, successes, failures, alertCount, monitor, notices, hashesByDay };
}

function printReport(data, now) {
  const { runs, successes, failures, alertCount, monitor, notices, hashesByDay } = data;
  const rejected = flattenRejections(hashesByDay);
  const starts = runs.map((run) => Date.parse(run.startedAt)).sort((a, b) => a - b);
  const windowStart = starts.length ? starts[0] : now;

  console.log(`Active alerts: ${alertCount}`);
  console.log(
    `Runs logged: ${runs.length}` +
      (starts.length ? ` (${time(starts[0])} -> ${time(starts[starts.length - 1])})` : ''),
  );
  const counts = countOutcomes(runs, rejected);
  console.log(
    `By outcome: healthy ${counts.healthy}, no-price ${counts['no-price']}, failed ${counts.failed}, ` +
      `skipped ${counts.skipped}; rejected calls (last 2 UTC days, lower bound) ${counts.rejected}`,
  );

  const stats = healthyStats(runs);
  const lastHealthy = Math.max(
    stats.lastHealthyAt ?? -Infinity,
    monitor?.lastHealthyAt ? Date.parse(monitor.lastHealthyAt) : -Infinity,
  );
  console.log(`Last healthy run: ${time(Number.isFinite(lastHealthy) ? lastHealthy : null)}`);
  console.log(
    `Gap between healthy runs: p50 ${seconds(stats.gapP50)}, p95 ${seconds(stats.gapP95)}, ` +
      `max ${seconds(stats.gapMax)}  [AC18: p95 <= 90s]`,
  );
  console.log(
    `Healthy run duration: p95 ${seconds(stats.durationP95)}, max ${seconds(stats.durationMax)}  ` +
      `[NFR02: <= 15s]`,
  );
  console.log(
    `Totals over logged runs: fired ${runs.reduce((n, r) => n + r.fired, 0)}, failed sends ${runs.reduce(
      (n, r) => n + r.failed,
      0,
    )}, rearmed ${runs.reduce((n, r) => n + r.rearmed, 0)}, deferred ${runs.reduce(
      (n, r) => n + (r.deferred ?? 0),
      0,
    )}`,
  );

  const outages = buildOutages(runs, rejected, windowStart, now);
  console.log(`\nOutages (>= 15 min without a healthy run): ${outages.length}`);
  for (const outage of outages) {
    const seen = [];
    if (outage.notCalled) seen.push('not called');
    for (const kind of ['rejected', 'no-price', 'failed', 'skipped']) {
      if (outage.counts[kind] > 0) seen.push(`${kind} x${outage.counts[kind]}`);
    }
    console.log(
      `  ${time(outage.start)} -> ${outage.ongoing ? 'ongoing' : time(outage.end)} ` +
        `(${minutes(outage.durationMs)}): ${seen.join(', ') || 'not called'}`,
    );
  }

  console.log('\nMonitoring:');
  console.log(
    monitor
      ? `  Watcher last ran: ${monitor.lastWatcherRunAt} (started ${monitor.watcherStartedAt})`
      : '  Watcher last ran: never (not set up yet?)',
  );
  console.log(
    `  Owner chat: ${
      monitor
        ? monitor.ownerChatConfigured
          ? 'configured'
          : 'NOT configured (OWNER_CHAT_ID)'
        : 'unknown'
    }`,
  );
  if (monitor?.outage) {
    console.log(
      `  Open outage since ${monitor.outage.since}, owner told: ${monitor.outage.notifiedAt ?? 'not yet'}`,
    );
  }
  console.log(`  Last monitoring messages: ${notices.length ? '' : 'none'}`);
  for (const notice of notices) {
    console.log(
      `    ${notice.at} ${notice.kind} ${notice.delivered ? 'delivered' : 'NOT delivered'}`,
    );
  }

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

async function main() {
  // `.env.alerts` (a throwaway file holding the production KV values) wins
  // over the dev `.env`; the shell environment wins over both.
  const root = path.resolve(__dirname, '..');
  const env = {
    ...loadEnvFile(path.join(root, '.env')),
    ...loadEnvFile(path.join(root, '.env.alerts')),
    ...process.env,
  };
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN || env.KV_REST_API_URL.includes('SENSITIVE')) {
    console.error(
      'KV_REST_API_URL / KV_REST_API_TOKEN missing. Copy them from Upstash Console -> your database ' +
        '-> REST API (the read-only token is enough) into .env.alerts. `vercel env pull` cannot fetch ' +
        'them: they are Sensitive on Vercel.',
    );
    process.exit(1);
  }
  const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
  const now = Date.now();
  printReport(await readAll(redis, now), now);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { readAll, printReport };
