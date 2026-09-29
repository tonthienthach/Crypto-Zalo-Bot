import { createHash, timingSafeEqual } from 'crypto';

/**
 * Compares a provided secret with the expected one in constant time. Both
 * are hashed first, so `timingSafeEqual` always sees equal lengths and the
 * comparison time leaks neither the content nor the length of the secret.
 * An empty or missing value on either side never matches, and neither does
 * a non-string one (a repeated header or query param arrives as an array).
 */
export function secretEquals(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) {
    return false;
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Names of the other machine-endpoint secrets that PRICE_ALERTS_WATCH_SECRET
 * is equal to (spec EPIC-002-FIX-NFR08: it must be a third, separate secret
 * — it lives at a different scheduler). Empty when it is unset or distinct.
 */
export function watchSecretReusedAs(secrets: {
  watch?: string;
  digest?: string;
  check?: string;
}): string[] {
  if (!secrets.watch) return [];
  const reused: string[] = [];
  if (secrets.watch === secrets.digest) reused.push('CRON_SECRET_TOKEN');
  if (secrets.watch === secrets.check) reused.push('PRICE_ALERTS_CRON_SECRET');
  return reused;
}
