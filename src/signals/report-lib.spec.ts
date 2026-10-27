import { scoreRecords } from './signal-backtest';
import { PricePoint, SignalRecord } from './interfaces/signal.interface';
import { DAY_MS, HOUR_MS } from './signals.constants';

// The report is a plain Node script (scripts/), tested from here so it runs under `npm test`.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const lib = require('../../scripts/signals-report.lib');

describe('signals report lib (EPIC-004-FR12, AC17)', () => {
  describe('summarizeChats', () => {
    const usage = {
      '2026-10-07': {
        'chat-a|command': '2',
        'chat-a|alert': '1',
        'owner|command': '9',
        'chat-b|digest': '1',
      },
      '2026-10-08': { 'chat-a|command': '1' },
      '2026-10-09': { 'chat-b|alert': '1' },
    };

    it('leaves the owner out and counts days per chat', () => {
      const chats = lib.summarizeChats(usage, 'owner');
      expect(chats.map((chat: { chatId: string }) => chat.chatId).sort()).toEqual([
        'chat-a',
        'chat-b',
      ]);
      const a = chats.find((chat: { chatId: string }) => chat.chatId === 'chat-a');
      expect(a.firstDay).toBe('2026-10-07');
      expect(a.commandDays.size).toBe(2);
      expect(a.activeDays.size).toBe(2);
      expect(a.counts).toEqual({ command: 3, alert: 1, digest: 0 });
    });

    it('counts the owner like any chat when no owner is given', () => {
      expect(lib.summarizeChats(usage, undefined)).toHaveLength(3);
    });

    it('reads flat HGETALL replies and chat ids that contain "|" or look numeric', () => {
      const chats = lib.summarizeChats(
        { '2026-10-07': ['12345678901234567890|command', '1', 'a|b|alert', '1'] },
        undefined,
      );
      expect(chats.map((chat: { chatId: string }) => chat.chatId).sort()).toEqual([
        '12345678901234567890',
        'a|b',
      ]);
    });
  });

  describe('successSummary', () => {
    it('is met when a non-owner chat used the command on two different days (AC17)', () => {
      const chats = lib.summarizeChats(
        { '2026-10-07': { 'c|command': '1' }, '2026-10-09': { 'c|command': '1' } },
        'owner',
      );
      expect(lib.successSummary(chats)).toMatchObject({ returned: 1, met: true });
    });

    it('is not met by a chat that only received messages, or used it on one day', () => {
      const chats = lib.summarizeChats(
        {
          '2026-10-07': { 'p|digest': '1', 'q|command': '5' },
          '2026-10-09': { 'p|digest': '1' },
        },
        'owner',
      );
      const summary = lib.successSummary(chats);
      expect(summary).toMatchObject({ returned: 0, met: false, receivedAgain: 1, usedCommand: 1 });
    });
  });

  describe('scoreAll agrees with scoreRecords', () => {
    const T0 = Date.UTC(2026, 9, 1, 10);
    const history: Record<string, PricePoint[]> = {
      btc: [
        { t: T0 + DAY_MS, p: 85_000 },
        { t: T0 + 3 * DAY_MS + HOUR_MS, p: 90_000 },
      ],
      eth: [{ t: T0 + 3 * DAY_MS + HOUR_MS, p: 2_000 }],
    };
    const records: SignalRecord[] = [
      { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: T0 },
      { symbol: 'eth', verdict: 'sell', priceUsd: 2_500, at: T0 },
      { symbol: 'eth', verdict: 'buy', priceUsd: 2_100, at: T0 + 2 * DAY_MS },
      { symbol: 'sol', verdict: 'buy', priceUsd: 100, at: T0 },
    ];

    it.each([T0 + 2 * DAY_MS, T0 + 4 * DAY_MS, T0 + 10 * DAY_MS])('at %s', (now) => {
      const mine = scoreRecords(records, history, now);
      const report = lib.scoreAll({ chat: records }, history, now);
      expect(report).toEqual(mine);
    });
  });

  describe('parsing', () => {
    it('parses a records hash, skipping malformed rows', () => {
      const records = lib.parseRecords([
        'btc:buy:2026-10-07',
        '84000:1791375600000',
        'x:watch:d',
        '1:2',
        'bad',
        'zz',
      ]);
      expect(records).toEqual([
        { symbol: 'btc', verdict: 'buy', priceUsd: 84_000, at: 1_791_375_600_000 },
      ]);
    });

    it('parses sorted-set members into points, oldest first', () => {
      expect(lib.parsePoints(['20:2', '10:1', 'junk'])).toEqual([
        { t: 10, p: 1 },
        { t: 20, p: 2 },
      ]);
    });
  });
});
