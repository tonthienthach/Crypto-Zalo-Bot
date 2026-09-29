/**
 * Pure calculations behind `npm run portfolio:report` (EPIC-003), kept apart
 * from the Postgres I/O in portfolio-usage-report.js so they can be
 * unit-tested (src/portfolio/usage-report-lib.spec.ts).
 */

/** "2026-09-25" from a DATE column, whether it came back as a string or a Date. */
function dayOf(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * One entry per chat from `portfolio_usage` rows: first day seen, number of
 * days with any use, totals, and whether it came back after its first day.
 * A chat "recorded a portfolio" if it ever wrote a trade.
 */
function summarizeUsage(rows) {
  const byChat = new Map();
  for (const row of rows) {
    const chat = byChat.get(row.chat_id) ?? {
      chatId: row.chat_id,
      days: new Set(),
      views: 0,
      writes: 0,
    };
    chat.days.add(dayOf(row.day));
    chat.views += Number(row.views);
    chat.writes += Number(row.writes);
    byChat.set(row.chat_id, chat);
  }
  return [...byChat.values()]
    .map((chat) => {
      const days = [...chat.days].sort();
      return {
        chatId: chat.chatId,
        firstDay: days[0],
        activeDays: days.length,
        views: chat.views,
        writes: chat.writes,
        usedAfterFirstDay: days.length > 1,
      };
    })
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.chatId.localeCompare(b.chatId));
}

/**
 * The intent.md §5 success metric: chats other than the owner that recorded
 * a portfolio and used it again after their first day. `writes` only counts
 * trades actually written (PortfolioService.recordTrade bumps it from the
 * INSERT's own rows), so a chat whose every trade was refused doesn't qualify.
 */
function successMetric(chats, ownerChatId) {
  const qualifying = chats.filter(
    (chat) => chat.chatId !== ownerChatId && chat.writes > 0 && chat.usedAfterFirstDay,
  );
  return { qualifying: qualifying.map((chat) => chat.chatId), met: qualifying.length >= 1 };
}

module.exports = { summarizeUsage, successMetric };
