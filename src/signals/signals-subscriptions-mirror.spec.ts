import { SignalsStateService } from './signals-state.service';
import { SignalsSubscriptionsMirror } from './signals-subscriptions-mirror';

describe('SignalsSubscriptionsMirror', () => {
  const setWatchlist = jest.fn();
  const removeWatchlist = jest.fn();
  const replaceWatchlists = jest.fn();
  let mirror: SignalsSubscriptionsMirror;

  beforeEach(() => {
    jest.clearAllMocks();
    mirror = new SignalsSubscriptionsMirror({
      setWatchlist,
      removeWatchlist,
      replaceWatchlists,
    } as unknown as SignalsStateService);
  });

  it('mirrors subscribe, watchlist change and unsubscribe', async () => {
    await mirror.onSubscribed('c1', ['btc']);
    await mirror.onWatchlistChanged('c1', ['eth']);
    await mirror.onUnsubscribed('c1');

    expect(setWatchlist).toHaveBeenNthCalledWith(1, 'c1', ['btc']);
    expect(setWatchlist).toHaveBeenNthCalledWith(2, 'c1', ['eth']);
    expect(removeWatchlist).toHaveBeenCalledWith('c1');
  });

  it('replaces the whole copy from the active subscribers', async () => {
    await mirror.syncAll([
      { chatId: 'c1', watchlist: ['btc'] },
      { chatId: 'c2', watchlist: ['eth', 'sol'] },
    ]);
    expect(replaceWatchlists).toHaveBeenCalledWith({ c1: ['btc'], c2: ['eth', 'sol'] });
  });

  it('never throws when Redis fails', async () => {
    setWatchlist.mockRejectedValue(new Error('down'));
    removeWatchlist.mockRejectedValue(new Error('down'));
    replaceWatchlists.mockRejectedValue(new Error('down'));

    await expect(mirror.onSubscribed('c1', ['btc'])).resolves.toBeUndefined();
    await expect(mirror.onUnsubscribed('c1')).resolves.toBeUndefined();
    await expect(mirror.syncAll([])).resolves.toBeUndefined();
  });
});
