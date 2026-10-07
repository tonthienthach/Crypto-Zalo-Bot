/**
 * Pure calculations behind `npm run signals:report` (EPIC-004-FR12, AC17),
 * kept apart from the Redis I/O in signals-report.js so they can be
 * unit-tested (src/signals/report-lib.spec.ts).
 */

/** The success window of the intent: 30 days after launch (spec EPIC-004 §1, Open Q7). */
const SUCCESS_WINDOW_DAYS = 30;

/** A verdict is scored by the first stored price this long after it (same rule as scoreRecords in src/signals). */
const HORIZON_MS = 3 * 86_400_000;

/** HGETALL replies come back as a flat [field, value, ...] list when not auto-parsed. */
function hashToRecord(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Per chat, from the daily usage hashes ({ 'YYYY-MM-DD': { 'chat|kind': n } }):
 * the first day it was seen, the days it used the command, the days it
 * received anything, and counts per kind. `ownerChatId` is left out.
 */
function summarizeChats(usageByDay, ownerChatId) {
  const chats = new Map();
  for (const day of Object.keys(usageByDay).sort()) {
    for (const [field, count] of Object.entries(hashToRecord(usageByDay[day]))) {
      const split = field.lastIndexOf('|');
      if (split < 1) continue;
      const chatId = field.slice(0, split);
      const kind = field.slice(split + 1);
      if (ownerChatId && chatId === ownerChatId) continue;
      const entry = chats.get(chatId) ?? {
        chatId,
        firstDay: day,
        activeDays: new Set(),
        commandDays: new Set(),
        counts: { command: 0, alert: 0, digest: 0 },
      };
      entry.activeDays.add(day);
      if (kind === 'command') entry.commandDays.add(day);
      entry.counts[kind] = (entry.counts[kind] ?? 0) + Number(count);
      chats.set(chatId, entry);
    }
  }
  return Array.from(chats.values());
}

/**
 * The success metric: chats other than the owner that used the command, then
 * used it again on a later day ("returned"). `receivedAgain` counts chats
 * that got signal messages on a later day too, which is passive and shown
 * separately.
 */
function successSummary(chats) {
  const returned = chats.filter((chat) => chat.commandDays.size >= 2);
  const usedCommand = chats.filter((chat) => chat.commandDays.size >= 1);
  const receivedAgain = chats.filter((chat) => chat.activeDays.size >= 2);
  return {
    chatsSeen: chats.length,
    usedCommand: usedCommand.length,
    returned: returned.length,
    receivedAgain: receivedAgain.length,
    met: returned.length >= 1,
  };
}

/** One chat's records hash ({ 'btc:buy:2026-10-07': '84000:1791...' }) as records. */
function parseRecords(raw) {
  const records = [];
  for (const [field, value] of Object.entries(hashToRecord(raw))) {
    const [symbol, verdict] = field.split(':');
    const [price, at] = String(value).split(':');
    if (verdict !== 'buy' && verdict !== 'sell') continue;
    const record = { symbol, verdict, priceUsd: Number(price), at: Number(at) };
    if (Number.isFinite(record.priceUsd) && Number.isFinite(record.at)) records.push(record);
  }
  return records;
}

/** Sorted-set members ("<ms>:<usd>") as points, oldest first. */
function parsePoints(members) {
  const points = [];
  for (const member of members ?? []) {
    const [t, p] = String(member).split(':');
    const point = { t: Number(t), p: Number(p) };
    if (Number.isFinite(point.t) && Number.isFinite(point.p)) points.push(point);
  }
  return points.sort((a, b) => a.t - b.t);
}

/**
 * Accuracy of every verdict sent, across chats: right when the first stored
 * price at or after `at + 3 days` is higher (buy) or lower (sell). Same rule
 * as scoreRecords in src/signals/signal-backtest.ts; a spec checks they agree.
 */
function scoreAll(recordsByChat, historyBySymbol, now) {
  const tally = { buy: { scored: 0, correct: 0 }, sell: { scored: 0, correct: 0 }, pending: 0 };
  for (const records of Object.values(recordsByChat)) {
    for (const record of records) {
      const due = record.at + HORIZON_MS;
      const later =
        now >= due ? (historyBySymbol[record.symbol] ?? []).find((point) => point.t >= due) : null;
      if (!later) {
        tally.pending++;
        continue;
      }
      tally[record.verdict].scored++;
      const right =
        record.verdict === 'buy' ? later.p > record.priceUsd : later.p < record.priceUsd;
      if (right) tally[record.verdict].correct++;
    }
  }
  return tally;
}

module.exports = {
  SUCCESS_WINDOW_DAYS,
  hashToRecord,
  parsePoints,
  parseRecords,
  scoreAll,
  successSummary,
  summarizeChats,
};
