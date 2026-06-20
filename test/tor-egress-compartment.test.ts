// test/tor-egress-compartment.test.ts
import { describe, it, expect } from 'vitest';
import { deriveCaseCredentials, credsForCase } from '../src/main/plugins/tor-egress';

const SALT = Buffer.alloc(32, 7); // fixed test salt → deterministic

describe('per-case SOCKS compartment credentials', () => {
  it('derives deterministic creds for a caseId (same salt → identical)', () => {
    expect(deriveCaseCredentials('c-abc', SALT)).toEqual(deriveCaseCredentials('c-abc', SALT));
  });
  it('derives different creds for different caseIds', () => {
    const a = deriveCaseCredentials('c-abc', SALT); const b = deriveCaseCredentials('c-xyz', SALT);
    expect(a.user).not.toBe(b.user); expect(a.pass).not.toBe(b.pass);
  });
  it('user and pass differ within one credential pair', () => {
    const c = deriveCaseCredentials('c-abc', SALT);
    expect(c.user).not.toBe(c.pass);
    expect(c.user).toMatch(/^[0-9a-f]{16}$/); expect(c.pass).toMatch(/^[0-9a-f]{32}$/);
  });
  it('a different salt yields different creds for the same caseId (process-scoped rotation)', () => {
    expect(deriveCaseCredentials('c-abc', SALT)).not.toEqual(deriveCaseCredentials('c-abc', Buffer.alloc(32, 9)));
  });
  it('credsForCase maps caseId→derived and undefined→undefined (per-request random path)', () => {
    expect(credsForCase('c-abc', SALT)).toEqual(deriveCaseCredentials('c-abc', SALT));
    expect(credsForCase(undefined, SALT)).toBeUndefined();
  });
});
