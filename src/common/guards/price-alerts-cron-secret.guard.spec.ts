import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceAlertsService } from '../../price-alerts/price-alerts.service';
import { PriceAlertsCronSecretGuard } from './price-alerts-cron-secret.guard';

const SECRET = 'price-alerts-secret-0123456789';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, ip: '203.0.113.7' }) }),
  } as unknown as ExecutionContext;
}

describe('PriceAlertsCronSecretGuard', () => {
  let guard: PriceAlertsCronSecretGuard;
  let recordRejections: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-25T03:00:00.000Z') });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    recordRejections = jest.fn().mockResolvedValue(undefined);
    guard = new PriceAlertsCronSecretGuard(
      { get: () => SECRET } as unknown as ConfigService,
      { recordRejections } as unknown as PriceAlertsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('lets the right secret through without recording anything', () => {
    expect(guard.canActivate(contextWith({ 'x-cron-secret-token': SECRET }))).toBe(true);
    expect(recordRejections).not.toHaveBeenCalled();
  });

  it('rejects a wrong or missing secret with 401 and records it, without the secret (FIX-AC03)', () => {
    expect(() => guard.canActivate(contextWith({ 'x-cron-secret-token': 'wrong-secret' }))).toThrow(
      UnauthorizedException,
    );

    expect(recordRejections).toHaveBeenCalledTimes(1);
    const args = recordRejections.mock.calls[0];
    expect(args[0]).toBe(1);
    expect(JSON.stringify(args)).not.toContain('wrong-secret');

    jest.advanceTimersByTime(60_000);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    expect(recordRejections).toHaveBeenCalledTimes(2);
  });

  it('writes at most once per minute under 10,000 rejected calls, keeping the count (FIX-AC04)', () => {
    for (let i = 0; i < 10_000; i++) {
      jest.advanceTimersByTime(5); // 10,000 calls over 50s
      expect(() =>
        guard.canActivate(contextWith({ 'x-cron-secret-token': 'wrong-secret' })),
      ).toThrow(UnauthorizedException);
    }

    expect(recordRejections).toHaveBeenCalledTimes(1);
    expect(recordRejections.mock.calls[0][0]).toBeGreaterThanOrEqual(1);

    // The next call after the minute is up carries everything held back.
    jest.advanceTimersByTime(60_000);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    expect(recordRejections).toHaveBeenCalledTimes(2);
    expect(recordRejections.mock.calls[1][0]).toBe(10_000);
  });

  it('still answers 401 when the rejection write fails', async () => {
    recordRejections.mockRejectedValue(new Error('redis down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    await Promise.resolve();
  });
});
