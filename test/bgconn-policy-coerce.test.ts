import { describe, it, expect } from 'vitest';
import { coerceBgconnPolicy } from '../src/main/bgconn/policy';

// Defaults: idleTeardownAfterMinutes 120, maxReconnects 20, maxSessionAgeMinutes 720.
describe('coerceBgconnPolicy', () => {
  it('backfills a partial block (only defaultRouting) to fail-safe defaults with FINITE timers', () => {
    const p = coerceBgconnPolicy({ defaultRouting: 'tor' });
    expect(p.maxSessionAgeMs).toBe(720 * 60_000);
    expect(p.idleTeardownAfterMs).toBe(120 * 60_000);
    expect(p.maxReconnects).toBe(20);
    expect(Number.isFinite(p.maxSessionAgeMs)).toBe(true);
    expect(Number.isFinite(p.idleTeardownAfterMs as number)).toBe(true);
  });

  it('rejects wrong-typed / non-integer fields, falling back to defaults', () => {
    const p = coerceBgconnPolicy({ maxSessionAgeMinutes: 'abc', maxReconnects: 1.5 });
    expect(p.maxSessionAgeMs).toBe(720 * 60_000);
    expect(p.maxReconnects).toBe(20);
    // idle not supplied → default
    expect(p.idleTeardownAfterMs).toBe(120 * 60_000);
  });

  it('preserves an explicit null idle-teardown (disabled by operator intent, not by accident)', () => {
    const p = coerceBgconnPolicy({ idleTeardownAfterMinutes: null });
    expect(p.idleTeardownAfterMs).toBeNull();
    // the other bounds still get safe defaults
    expect(p.maxSessionAgeMs).toBe(720 * 60_000);
    expect(p.maxReconnects).toBe(20);
  });

  it('passes a fully-valid block through (×60_000)', () => {
    const p = coerceBgconnPolicy({ idleTeardownAfterMinutes: 30, maxReconnects: 5, maxSessionAgeMinutes: 60 });
    expect(p.idleTeardownAfterMs).toBe(30 * 60_000);
    expect(p.maxReconnects).toBe(5);
    expect(p.maxSessionAgeMs).toBe(60 * 60_000);
  });

  it('treats undefined / empty object as all-defaults', () => {
    for (const raw of [undefined, {}]) {
      const p = coerceBgconnPolicy(raw);
      expect(p.idleTeardownAfterMs).toBe(120 * 60_000);
      expect(p.maxReconnects).toBe(20);
      expect(p.maxSessionAgeMs).toBe(720 * 60_000);
    }
  });

  it('an idle of 0 minutes is honoured (immediate teardown), not coerced away', () => {
    const p = coerceBgconnPolicy({ idleTeardownAfterMinutes: 0 });
    expect(p.idleTeardownAfterMs).toBe(0);
  });
});
