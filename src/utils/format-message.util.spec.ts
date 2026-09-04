import { CoinMarketData } from '../coingecko/interfaces/coingecko-response.interface';
import {
  formatCoinLine,
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
});
