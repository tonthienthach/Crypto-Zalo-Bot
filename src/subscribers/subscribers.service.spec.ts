import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { InvalidWatchlistError, SubscribersService } from './subscribers.service';

const mockSql = jest.fn();

jest.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));

/** Matches the shape a real `neon()` tagged-template call resolves to for a `RETURNING`/`SELECT`. */
function rows(...rows: Record<string, unknown>[]) {
  return Promise.resolve(rows);
}

describe('SubscribersService', () => {
  let service: SubscribersService;

  beforeEach(async () => {
    mockSql.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscribersService,
        {
          provide: ConfigService,
          useValue: { get: () => 'postgres://test:test@localhost:5432/test' },
        },
      ],
    }).compile();

    service = moduleRef.get(SubscribersService);
  });

  describe('subscribe', () => {
    it('normalizes the watchlist (lowercase, trimmed, deduped) before writing', async () => {
      mockSql.mockReturnValue(
        rows({
          chat_id: 'chat-1',
          watchlist: ['btc', 'eth'],
          is_active: true,
          created_at: '2026-09-21T00:00:00.000Z',
        }),
      );

      const result = await service.subscribe('chat-1', [' BTC ', 'eth', 'btc']);

      expect(result).toEqual({
        chatId: 'chat-1',
        watchlist: ['btc', 'eth'],
        isActive: true,
        createdAt: new Date('2026-09-21T00:00:00.000Z'),
      });
      // The normalized (deduped, lowercased) list is what actually gets sent to the query.
      // Tagged-template call args are (strings, chatId, watchlist) — index 2 is the watchlist.
      const sentWatchlist = mockSql.mock.calls[0][2];
      expect(sentWatchlist).toEqual(['btc', 'eth']);
    });

    it('reactivates an existing (previously unsubscribed) row rather than erroring', async () => {
      // The upsert path (ON CONFLICT ... DO UPDATE) is exercised identically whether the
      // row is new or being reactivated — from the service's point of view there is only
      // one code path, so this proves the same behavior a real re-subscribe would take.
      mockSql.mockReturnValue(
        rows({
          chat_id: 'chat-2',
          watchlist: ['sol'],
          is_active: true,
          created_at: '2026-09-21T00:00:00.000Z',
        }),
      );

      const result = await service.subscribe('chat-2', ['sol']);

      expect(result.isActive).toBe(true);
      const [queryParts] = mockSql.mock.calls[0] as [TemplateStringsArray];
      expect(queryParts.join('')).toContain('ON CONFLICT (chat_id)');
      expect(queryParts.join('')).toContain('is_active = true');
    });

    it('throws InvalidWatchlistError for an empty/whitespace-only watchlist and does not query', async () => {
      await expect(service.subscribe('chat-3', ['', '   ', ''])).rejects.toThrow(
        InvalidWatchlistError,
      );
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('throws InvalidWatchlistError for a watchlist over the 20-symbol cap and does not query', async () => {
      const overLimit = Array.from({ length: 21 }, (_, i) => `coin${i}`);

      await expect(service.subscribe('chat-4', overLimit)).rejects.toThrow(InvalidWatchlistError);
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('accepts exactly 20 symbols (boundary, not over the cap)', async () => {
      const atLimit = Array.from({ length: 20 }, (_, i) => `coin${i}`);
      mockSql.mockReturnValue(
        rows({
          chat_id: 'chat-5',
          watchlist: atLimit,
          is_active: true,
          created_at: '2026-09-21T00:00:00.000Z',
        }),
      );

      await expect(service.subscribe('chat-5', atLimit)).resolves.toMatchObject({
        watchlist: atLimit,
      });
    });
  });

  describe('unsubscribe', () => {
    it('issues an is_active = false update for the given chat', async () => {
      mockSql.mockReturnValue(rows());

      await service.unsubscribe('chat-6');

      const [queryParts, chatId] = mockSql.mock.calls[0] as [TemplateStringsArray, string];
      expect(queryParts.join('')).toContain('is_active = false');
      expect(chatId).toBe('chat-6');
    });
  });

  describe('updateWatchlist', () => {
    it('returns the updated subscriber when the chat is an active subscriber', async () => {
      mockSql.mockReturnValue(
        rows({
          chat_id: 'chat-7',
          watchlist: ['ada'],
          is_active: true,
          created_at: '2026-09-21T00:00:00.000Z',
        }),
      );

      const result = await service.updateWatchlist('chat-7', ['ada']);

      expect(result).toEqual({
        chatId: 'chat-7',
        watchlist: ['ada'],
        isActive: true,
        createdAt: new Date('2026-09-21T00:00:00.000Z'),
      });
    });

    it('returns null when no active row matches (not subscribed)', async () => {
      mockSql.mockReturnValue(rows());

      const result = await service.updateWatchlist('chat-8', ['ada']);

      expect(result).toBeNull();
    });

    it('throws InvalidWatchlistError before querying for an invalid watchlist', async () => {
      await expect(service.updateWatchlist('chat-9', [])).rejects.toThrow(InvalidWatchlistError);
      expect(mockSql).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByChatId', () => {
    it('returns the subscriber when found', async () => {
      mockSql.mockReturnValue(
        rows({
          chat_id: 'chat-10',
          watchlist: ['btc'],
          is_active: true,
          created_at: '2026-09-21T00:00:00.000Z',
        }),
      );

      await expect(service.findActiveByChatId('chat-10')).resolves.toMatchObject({
        chatId: 'chat-10',
      });
    });

    it('returns null when not found', async () => {
      mockSql.mockReturnValue(rows());

      await expect(service.findActiveByChatId('chat-11')).resolves.toBeNull();
    });
  });

  describe('listActive', () => {
    it('maps every active row to a Subscriber', async () => {
      mockSql.mockReturnValue(
        rows(
          {
            chat_id: 'chat-12',
            watchlist: ['btc'],
            is_active: true,
            created_at: '2026-09-21T00:00:00.000Z',
          },
          {
            chat_id: 'chat-13',
            watchlist: ['eth', 'sol'],
            is_active: true,
            created_at: '2026-09-21T00:00:00.000Z',
          },
        ),
      );

      const result = await service.listActive();

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.chatId)).toEqual(['chat-12', 'chat-13']);
    });

    it('returns an empty array when there are no active subscribers', async () => {
      mockSql.mockReturnValue(rows());

      await expect(service.listActive()).resolves.toEqual([]);
    });
  });
});
