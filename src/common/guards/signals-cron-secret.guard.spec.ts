import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignalsCronSecretGuard } from './signals-cron-secret.guard';

const SECRET = 'signals-secret-0123456789';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, ip: '203.0.113.7' }) }),
  } as unknown as ExecutionContext;
}

describe('SignalsCronSecretGuard', () => {
  const get = jest.fn();
  let guard: SignalsCronSecretGuard;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    get.mockReturnValue(SECRET);
    guard = new SignalsCronSecretGuard({ get } as unknown as ConfigService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads its own secret setting, not the digest one', () => {
    guard.canActivate(contextWith({ 'x-cron-secret-token': SECRET }));
    expect(get).toHaveBeenCalledWith('signals.cronSecretToken');
  });

  it('accepts the secret as a header or as a bearer token', () => {
    expect(guard.canActivate(contextWith({ 'x-cron-secret-token': SECRET }))).toBe(true);
    expect(guard.canActivate(contextWith({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('rejects a wrong or missing secret with 401', () => {
    expect(() => guard.canActivate(contextWith({ 'x-cron-secret-token': 'wrong' }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects every call when the secret is not configured', () => {
    get.mockReturnValue(undefined);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith({ 'x-cron-secret-token': '' }))).toThrow(
      UnauthorizedException,
    );
  });
});
