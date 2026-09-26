// The report is a plain Node script (scripts/), tested from here so it runs under `npm test`.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const usageLib = require('../../scripts/portfolio-usage-report.lib');

describe('portfolio usage report lib (EPIC-003-FR13, AC16)', () => {
  const rows = [
    { chat_id: 'owner', day: '2026-09-25', views: 3, writes: 2 },
    { chat_id: 'owner', day: '2026-09-26', views: 1, writes: 0 },
    { chat_id: 'friend', day: new Date('2026-09-25T00:00:00.000Z'), views: '1', writes: '1' },
    { chat_id: 'friend', day: '2026-09-27', views: '2', writes: '0' },
    { chat_id: 'one-day', day: '2026-09-26', views: 5, writes: 1 },
    { chat_id: 'viewer', day: '2026-09-25', views: 1, writes: 0 },
    { chat_id: 'viewer', day: '2026-09-26', views: 1, writes: 0 },
  ];

  it('summarizes each chat: first day, days used, totals, and whether it came back', () => {
    expect(usageLib.summarizeUsage(rows)).toEqual([
      {
        chatId: 'friend',
        firstDay: '2026-09-25',
        activeDays: 2,
        views: 3,
        writes: 1,
        usedAfterFirstDay: true,
      },
      {
        chatId: 'owner',
        firstDay: '2026-09-25',
        activeDays: 2,
        views: 4,
        writes: 2,
        usedAfterFirstDay: true,
      },
      {
        chatId: 'viewer',
        firstDay: '2026-09-25',
        activeDays: 2,
        views: 2,
        writes: 0,
        usedAfterFirstDay: true,
      },
      {
        chatId: 'one-day',
        firstDay: '2026-09-26',
        activeDays: 1,
        views: 5,
        writes: 1,
        usedAfterFirstDay: false,
      },
    ]);
  });

  it('the metric counts non-owner chats that recorded a trade and came back after day one', () => {
    const chats = usageLib.summarizeUsage(rows);

    expect(usageLib.successMetric(chats, 'owner')).toEqual({ qualifying: ['friend'], met: true });
    expect(
      usageLib.successMetric(
        chats.filter((c: { chatId: string }) => c.chatId !== 'friend'),
        'owner',
      ),
    ).toEqual({
      qualifying: [],
      met: false,
    });
  });
});
