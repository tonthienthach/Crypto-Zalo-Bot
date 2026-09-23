import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import { PriceAlert } from '../price-alerts/interfaces/price-alert.interface';
import {
  formatAlertAlreadyMetReply,
  formatAlertCreatedReply,
  formatAlertInvalidReply,
  formatAlertListReply,
  formatAlertTriggeredMessage,
  formatCoinLine,
  formatCronTrackingLine,
  formatDailyDigestReply,
  formatHelpReply,
  formatPriceReply,
  formatTopMarketsReply,
  formatUnknownCommandReply,
  formatUnknownSymbolsReply,
  toVndDisplay,
} from './format-message.util';

const btc: CoinMarketData = {
  id: 'bitcoin',
  symbol: 'btc',
  name: 'BTC',
  priceUsd: 65000,
  changePercent24h: 2.5,
  marketCapUsd: 1_000_000_000,
};

const eth: CoinMarketData = {
  id: 'ethereum',
  symbol: 'eth',
  name: 'ETH',
  priceUsd: 3000,
  changePercent24h: -1.2,
};

describe('format-message.util', () => {
  it('formats a positive-change coin line with the up emoji', () => {
    const line = formatCoinLine(btc, 25400);
    expect(line).toContain('🔺');
    expect(line).toContain('BTC');
    expect(line).toContain('+2.50%');
  });

  it('formats a negative-change coin line with the down emoji', () => {
    const line = formatCoinLine(eth, 25400);
    expect(line).toContain('🔻');
    expect(line).toContain('-1.20%');
  });

  it('formats a null-change coin line without crashing', () => {
    const line = formatCoinLine({ ...btc, changePercent24h: null }, 25400);
    expect(line).toContain('N/A');
  });

  it('converts USD to a VND display string using the given rate', () => {
    expect(toVndDisplay(1, 25000)).toBe('25.000₫');
  });

  it('formats a multi-coin price reply', () => {
    const reply = formatPriceReply([btc, eth], 25400);
    expect(reply).toContain('BTC');
    expect(reply).toContain('ETH');
  });

  it('formats a ranked top-markets reply', () => {
    const reply = formatTopMarketsReply([btc, eth], 25400);
    expect(reply).toContain('1. 🔺 BTC');
    expect(reply).toContain('2. 🔻 ETH');
  });

  it('formats a help reply mentioning /gia', () => {
    expect(formatHelpReply()).toContain('/gia btc');
  });

  it('formats an unknown-command reply', () => {
    expect(formatUnknownCommandReply()).toContain('/help');
  });

  it('formats an unknown-symbols reply listing the offending symbols', () => {
    expect(formatUnknownSymbolsReply(['foo', 'bar'])).toContain('FOO, BAR');
  });

  it('formats a daily digest reply without a tracking line by default', () => {
    const reply = formatDailyDigestReply([btc], 25400);
    expect(reply).not.toContain('cron-tracking');
  });

  it('appends the cron tracking line to the daily digest reply when given', () => {
    const reply = formatDailyDigestReply([btc], 25400, '🕐 [cron-tracking] test');
    expect(reply).toContain('🕐 [cron-tracking] test');
  });

  it('reports zero drift when invoked exactly at 09:00 ICT (02:00 UTC)', () => {
    const line = formatCronTrackingLine(new Date('2026-09-17T02:00:00.000Z'));
    expect(line).toContain('09:00');
    expect(line).toContain('+0');
  });

  it('reports positive drift when invoked after 09:00 ICT', () => {
    const line = formatCronTrackingLine(new Date('2026-09-17T06:00:00.000Z'));
    expect(line).toContain('13:00');
    expect(line).toContain('+240');
  });

  it('reports negative drift when invoked before 09:00 ICT', () => {
    const line = formatCronTrackingLine(new Date('2026-09-17T01:55:00.000Z'));
    expect(line).toContain('08:55');
    expect(line).toContain('-5');
  });

  describe('price alerts', () => {
    const alert: PriceAlert = {
      id: 7,
      chatId: 'chat-1',
      symbol: 'btc',
      direction: 'above',
      threshold: 100000,
      state: 'armed',
      lastFiredAt: null,
      createdAt: '2026-09-23T00:00:00.000Z',
    };

    it('includes coin, condition, level and current price (USD + VND) in the fired message (FR11)', () => {
      const message = formatAlertTriggeredMessage(alert, 100200, 25400);
      expect(message).toContain('BTC > $100,000.00');
      expect(message).toContain('$100,200.00');
      expect(message).toContain('₫');
      expect(message).toContain('tự bật lại');
    });

    it('confirms a created alert with its position and the current price', () => {
      const reply = formatAlertCreatedReply(alert, 3, 95000, 25400);
      expect(reply).toContain('#3');
      expect(reply).toContain('BTC > $100,000.00');
      expect(reply).toContain('$95,000.00');
    });

    it('numbers the list from 1 and shows each state (FR08)', () => {
      const reply = formatAlertListReply([
        alert,
        { ...alert, id: 9, symbol: 'eth', direction: 'below', threshold: 2000, state: 'fired' },
      ]);
      expect(reply).toContain('1. BTC > $100,000.00 — đang canh');
      expect(reply).toContain('2. ETH < $2,000.00 — đã báo');
    });

    it('shows a syntax example for an empty list and for invalid input (FR08, AC08)', () => {
      expect(formatAlertListReply([])).toContain('/canhbao btc > 100000');
      expect(formatAlertInvalidReply()).toContain('/canhbao btc > 100000');
    });

    it('shows the current price when the condition is already met (FR10)', () => {
      expect(formatAlertAlreadyMetReply('btc', 'above', 110000)).toContain('$110,000.00');
    });

    it('documents /canhbao in /help (FR13)', () => {
      expect(formatHelpReply()).toContain('/canhbao');
    });
  });
});
