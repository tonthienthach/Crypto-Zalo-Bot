import * as crypto from 'crypto';
import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronSecretGuard } from './cron-secret.guard';
import { secretEquals, watchSecretReusedAs } from './secret-equals';
import { WebhookSecretGuard } from './webhook-secret.guard';

function contextWith(
  headers: Record<string, unknown>,
  query: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, query, ip: '203.0.113.7' }) }),
  } as unknown as ExecutionContext;
}

describe('secretEquals (verify finding #6)', () => {
  it('matches only the exact secret', () => {
    expect(secretEquals('s3cret-value', 's3cret-value')).toBe(true);
    expect(secretEquals('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(secretEquals('s3cret', 's3cret-value')).toBe(false);
  });

  it('never matches an empty, missing or non-string value on either side', () => {
    expect(secretEquals('', '')).toBe(false);
    expect(secretEquals(undefined, undefined)).toBe(false);
    expect(secretEquals('x', undefined)).toBe(false);
    expect(secretEquals(undefined, 'x')).toBe(false);
    expect(secretEquals(['x'], 'x')).toBe(false);
  });

  it('compares equal-length digests, so different input lengths are a plain mismatch', () => {
    // timingSafeEqual itself throws on buffers of different lengths.
    expect(() =>
      crypto.timingSafeEqual(Buffer.from('short'), Buffer.from('a-much-longer-secret')),
    ).toThrow();

    expect(secretEquals('short', 'a-much-longer-expected-secret')).toBe(false);
    expect(secretEquals('x'.repeat(10_000), 'x')).toBe(false);
  });
});

describe('watchSecretReusedAs (FIX-NFR08)', () => {
  it('names each secret the watch secret equals, and nothing when it is unset or distinct', () => {
    expect(watchSecretReusedAs({ watch: 'a', digest: 'a', check: 'a' })).toEqual([
      'CRON_SECRET_TOKEN',
      'PRICE_ALERTS_CRON_SECRET',
    ]);
    expect(watchSecretReusedAs({ watch: 'a', digest: 'b', check: 'a' })).toEqual([
      'PRICE_ALERTS_CRON_SECRET',
    ]);
    expect(watchSecretReusedAs({ watch: 'a', digest: 'b', check: 'c' })).toEqual([]);
    expect(watchSecretReusedAs({ digest: undefined, check: undefined })).toEqual([]);
  });
});

describe('guards compare secrets through secretEquals', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('CronSecretGuard: right secret as header or bearer passes, anything else is 401', () => {
    const guard = new CronSecretGuard({ get: () => 'digest-secret' } as unknown as ConfigService);

    expect(guard.canActivate(contextWith({ 'x-cron-secret-token': 'digest-secret' }))).toBe(true);
    expect(guard.canActivate(contextWith({ authorization: 'Bearer digest-secret' }))).toBe(true);
    expect(() =>
      guard.canActivate(contextWith({ 'x-cron-secret-token': 'digest-secreT' })),
    ).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('CronSecretGuard: an unset expected secret rejects every call', () => {
    const guard = new CronSecretGuard({ get: () => undefined } as unknown as ConfigService);

    expect(() => guard.canActivate(contextWith({ 'x-cron-secret-token': 'anything' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('WebhookSecretGuard: header or ?secret= must match; a repeated query param is 401, not a crash', () => {
    const guard = new WebhookSecretGuard({
      get: () => 'webhook-secret',
    } as unknown as ConfigService);

    expect(guard.canActivate(contextWith({ 'x-bot-api-secret-token': 'webhook-secret' }))).toBe(
      true,
    );
    expect(guard.canActivate(contextWith({}, { secret: 'webhook-secret' }))).toBe(true);
    expect(() => guard.canActivate(contextWith({}, { secret: ['webhook-secret'] }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextWith({ 'x-bot-api-secret-token': 'nope' }))).toThrow(
      UnauthorizedException,
    );
  });
});
