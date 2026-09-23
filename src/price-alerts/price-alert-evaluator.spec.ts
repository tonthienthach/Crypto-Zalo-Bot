import { PriceAlert } from './interfaces/price-alert.interface';
import { evaluateAlert, isConditionMet } from './price-alert-evaluator';

const T = new Date('2026-09-23T03:00:00.000Z');
const minutesAfter = (minutes: number) => new Date(T.getTime() + minutes * 60_000);

function alert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: 1,
    chatId: 'chat-1',
    symbol: 'btc',
    direction: 'above',
    threshold: 100000,
    state: 'armed',
    lastFiredAt: null,
    createdAt: T.toISOString(),
    ...overrides,
  };
}

describe('isConditionMet', () => {
  it('treats "above" as >= and "below" as <=', () => {
    expect(isConditionMet('above', 100000, 100000)).toBe(true);
    expect(isConditionMet('above', 100000, 99999.99)).toBe(false);
    expect(isConditionMet('below', 2000, 2000)).toBe(true);
    expect(isConditionMet('below', 2000, 2000.01)).toBe(false);
  });
});

describe('evaluateAlert', () => {
  it('fires an armed alert once the price crosses (AC02)', () => {
    expect(evaluateAlert(alert(), 100200, T)).toBe('fire');
  });

  it('does nothing for an armed alert whose condition is not met', () => {
    expect(evaluateAlert(alert(), 95000, T)).toBe('none');
  });

  it('does not fire again while a fired alert stays past the threshold (AC03)', () => {
    const fired = alert({ state: 'fired', lastFiredAt: T.toISOString() });
    expect(evaluateAlert(fired, 100500, minutesAfter(1))).toBe('none');
    expect(evaluateAlert(fired, 101000, minutesAfter(30))).toBe('none');
  });

  it('re-arms only once price is back past the 0.5% buffer, then fires again after the cooldown (AC04)', () => {
    const fired = alert({ state: 'fired', lastFiredAt: T.toISOString() });
    expect(evaluateAlert(fired, 99800, minutesAfter(2))).toBe('none');
    expect(evaluateAlert(fired, 99400, minutesAfter(3))).toBe('rearm');

    const rearmed: PriceAlert = { ...fired, state: 'armed' };
    expect(evaluateAlert(rearmed, 100100, minutesAfter(16))).toBe('fire');
  });

  it('re-arms exactly at the buffer boundary', () => {
    const fired = alert({ state: 'fired', lastFiredAt: T.toISOString() });
    expect(evaluateAlert(fired, 99500, minutesAfter(1))).toBe('rearm');
  });

  it('holds a re-armed alert inside the 15-minute cooldown, then fires (AC05)', () => {
    const rearmed = alert({ state: 'armed', lastFiredAt: T.toISOString() });
    expect(evaluateAlert(rearmed, 100100, minutesAfter(5))).toBe('none');
    expect(evaluateAlert(rearmed, 100100, minutesAfter(14.9))).toBe('none');
    expect(evaluateAlert(rearmed, 100100, minutesAfter(15))).toBe('fire');
  });

  it('backs off 5 minutes after a failed send before retrying (AC13)', () => {
    const failed = alert({ lastFailedAt: T.toISOString() });
    expect(evaluateAlert(failed, 100200, minutesAfter(1))).toBe('none');
    expect(evaluateAlert(failed, 100200, minutesAfter(4.9))).toBe('none');
    expect(evaluateAlert(failed, 100200, minutesAfter(5))).toBe('fire');
  });

  it('handles "below" alerts symmetrically (AC06)', () => {
    const below = alert({ symbol: 'eth', direction: 'below', threshold: 2000 });
    expect(evaluateAlert(below, 1990, T)).toBe('fire');
    expect(evaluateAlert(below, 2001, T)).toBe('none');

    const fired: PriceAlert = { ...below, state: 'fired', lastFiredAt: T.toISOString() };
    expect(evaluateAlert(fired, 2005, minutesAfter(1))).toBe('none');
    expect(evaluateAlert(fired, 2010, minutesAfter(1))).toBe('rearm');
  });
});
