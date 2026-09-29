/**
 * Pure calculations behind `npm run alerts:report` (EPIC-002 / EPIC-002-FIX),
 * kept apart from the Redis I/O in price-alerts-report.js so they can be
 * unit-tested (src/price-alerts/report-lib.spec.ts).
 */

/** No healthy run for this long is an outage — the same threshold the watcher alerts on. */
const OUTAGE_THRESHOLD_MS = 15 * 60_000;

/**
 * Inside an outage, a stretch this long with nothing recorded at all (no run
 * of any outcome, no rejected call) counts as "not called". Rejected calls
 * are only written about once a minute, so shorter gaps are expected noise.
 */
const NOT_CALLED_GAP_MS = 3 * 60_000;

/** Runs logged before EPIC-002-FIX have no outcome; only completed runs were logged then. */
function outcomeOf(run) {
  return run.outcome ?? 'healthy';
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function countOutcomes(runs, rejectedByMinute) {
  const counts = { healthy: 0, 'no-price': 0, failed: 0, skipped: 0, rejected: 0 };
  for (const run of runs) counts[outcomeOf(run)] = (counts[outcomeOf(run)] ?? 0) + 1;
  for (const count of rejectedByMinute.values()) counts.rejected += count;
  return counts;
}

/**
 * Flattens per-day rejection hashes ({ 'YYYY-MM-DD': { 'HH:MM': count } })
 * into a Map of minute start (ms) -> count.
 */
function flattenRejections(hashesByDay) {
  const byMinute = new Map();
  for (const [day, hash] of Object.entries(hashesByDay)) {
    for (const [minute, count] of Object.entries(hash ?? {})) {
      const at = Date.parse(`${day}T${minute}:00.000Z`);
      if (!Number.isNaN(at)) byMinute.set(at, (byMinute.get(at) ?? 0) + Number(count));
    }
  }
  return byMinute;
}

/**
 * Stretches of at least OUTAGE_THRESHOLD_MS without a healthy run, between
 * `from` and `to` (ms), each with what was seen inside it (spec
 * EPIC-002-FIX-FR09b). `ongoing` marks one still open at `to`.
 */
function buildOutages(runs, rejectedByMinute, from, to) {
  const healthy = runs
    .filter((run) => outcomeOf(run) === 'healthy')
    .map((run) => Date.parse(run.startedAt))
    .sort((a, b) => a - b);
  const bounds = [from, ...healthy.filter((at) => at > from && at < to), to];

  const outages = [];
  for (let i = 1; i < bounds.length; i++) {
    const start = bounds[i - 1];
    const end = bounds[i];
    if (end - start < OUTAGE_THRESHOLD_MS) continue;

    const counts = { 'no-price': 0, failed: 0, skipped: 0, rejected: 0 };
    const seen = [];
    for (const run of runs) {
      const at = Date.parse(run.startedAt);
      if (at > start && at < end && outcomeOf(run) !== 'healthy') {
        counts[outcomeOf(run)]++;
        seen.push(at);
      }
    }
    for (const [at, count] of rejectedByMinute) {
      if (at >= start && at < end) {
        counts.rejected += count;
        seen.push(at);
      }
    }
    seen.sort((a, b) => a - b);
    const marks = [start, ...seen, end];
    const notCalled = marks.slice(1).some((at, j) => at - marks[j] >= NOT_CALLED_GAP_MS);

    outages.push({
      start,
      end,
      durationMs: end - start,
      ongoing: i === bounds.length - 1,
      notCalled,
      counts,
    });
  }
  return outages;
}

/** Gap and duration stats over healthy runs only (EPIC-002 AC18 / NFR02). */
function healthyStats(runs) {
  const healthy = runs.filter((run) => outcomeOf(run) === 'healthy');
  const starts = healthy.map((run) => Date.parse(run.startedAt)).sort((a, b) => a - b);
  const gaps = starts
    .slice(1)
    .map((start, i) => start - starts[i])
    .sort((a, b) => a - b);
  const durations = healthy.map((run) => run.durationMs).sort((a, b) => a - b);
  return {
    count: healthy.length,
    gapP50: percentile(gaps, 50),
    gapP95: percentile(gaps, 95),
    gapMax: gaps.length ? gaps[gaps.length - 1] : null,
    durationP95: percentile(durations, 95),
    durationMax: durations.length ? durations[durations.length - 1] : null,
    lastHealthyAt: starts.length ? starts[starts.length - 1] : null,
  };
}

/** How far back the "right now" line looks — the deploy check of docs/DEPLOYMENT.md §8a.4. */
const RECENT_WINDOW_MS = 5 * 60_000;

/**
 * Runs by outcome started in the last `windowMs`, plus rejected calls in
 * that time. Unlike countOutcomes over the whole log, this keeps moving once
 * the run log is full (MAX_RUN_LOG_ENTRIES): the confirmation right after
 * enabling or changing the job must not depend on the log still growing.
 */
function recentActivity(runs, rejectedByMinute, now, windowMs = RECENT_WINDOW_MS) {
  const from = now - windowMs;
  const recent = runs.filter((run) => {
    const at = Date.parse(run.startedAt);
    return at > from && at <= now;
  });
  const recentRejected = new Map(
    [...rejectedByMinute].filter(([at]) => at + 60_000 > from && at <= now),
  );
  return { windowMs, counts: countOutcomes(recent, recentRejected) };
}

/**
 * The outages of the report's window. With runs logged, the window starts at
 * the oldest one. With none at all — the check was never reached, e.g. a job
 * with the wrong URL or secret from the start (the EPIC-002 launch incident)
 * — that is itself one ongoing outage, flagged `noRunsLogged`: since the
 * first rejected call when there is one, else with no known start.
 */
function reportOutages(runs, rejectedByMinute, now) {
  if (runs.length > 0) {
    const windowStart = Math.min(...runs.map((run) => Date.parse(run.startedAt)));
    return buildOutages(runs, rejectedByMinute, windowStart, now);
  }
  const rejectedAt = [...rejectedByMinute.keys()].filter((at) => at <= now);
  const start = rejectedAt.length ? Math.min(...rejectedAt) : null;
  let rejected = 0;
  for (const [at, count] of rejectedByMinute) if (at <= now) rejected += count;
  return [
    {
      start,
      end: now,
      durationMs: start === null ? null : now - start,
      ongoing: true,
      notCalled: rejected === 0,
      noRunsLogged: true,
      counts: { 'no-price': 0, failed: 0, skipped: 0, rejected },
    },
  ];
}

module.exports = {
  OUTAGE_THRESHOLD_MS,
  NOT_CALLED_GAP_MS,
  RECENT_WINDOW_MS,
  recentActivity,
  reportOutages,
  outcomeOf,
  percentile,
  countOutcomes,
  flattenRejections,
  buildOutages,
  healthyStats,
};
