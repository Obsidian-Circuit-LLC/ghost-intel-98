import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/main/security/validate', () => ({
  isPublicHttpUrl: (u: string) => /^https?:\/\//.test(u) && !/localhost|127\.0\.0\.1|10\.|192\.168\./.test(u),
  assertResolvedPublic: async (h: string) => { if (/127\.0\.0\.1|localhost/.test(h)) throw new Error('private'); }
}));

import { classifyError, probe } from '../src/main/searchlight/probe';

describe('classifyError', () => {
  it('maps node error codes', () => {
    expect(classifyError({ code: 'ENOTFOUND' } as NodeJS.ErrnoException)).toBe('DNS_ERROR');
    expect(classifyError({ code: 'ECONNREFUSED' } as NodeJS.ErrnoException)).toBe('CONNECTION_REFUSED');
    expect(classifyError({ code: 'CERT_HAS_EXPIRED' } as NodeJS.ErrnoException)).toBe('SSL_ERROR');
    expect(classifyError({ code: 'ETIMEDOUT' } as NodeJS.ErrnoException)).toBe('TIMEOUT');
    expect(classifyError({ code: 'EOTHER' } as NodeJS.ErrnoException)).toBe('CONNECTION_ERROR');
  });
});

describe('probe', () => {
  it('rejects a private/non-public target without calling the network', async () => {
    const r = await probe('http://127.0.0.1/{u}', { fetchBody: false, useTor: false });
    expect(r.error).toBe('CONNECTION_ERROR');
    expect(r.statusCode).toBe(0);
  });
  it('Tor sweep with no SOCKS port => TOR_UNAVAILABLE, no dial', async () => {
    const dial = vi.fn();
    const r = await probe('https://x.com/u', { fetchBody: false, useTor: true }, { socksPort: () => null, dial: dial as never });
    expect(r.error).toBe('TOR_UNAVAILABLE');
    expect(dial).not.toHaveBeenCalled();
  });
  it('clearnet path uses injected fetch and reads body when fetchBody', async () => {
    const clearnetFetch = vi.fn(async () => new Response('hello-body', { status: 200, statusText: 'OK' })) as never;
    const r = await probe('https://x.com/u', { fetchBody: true, useTor: false }, { clearnetFetch });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('hello-body');
    expect(r.error).toBeNull();
  });
  it('clearnet path skips body when fetchBody=false', async () => {
    const clearnetFetch = vi.fn(async () => new Response('x', { status: 404, statusText: 'Not Found' })) as never;
    const r = await probe('https://x.com/u', { fetchBody: false, useTor: false }, { clearnetFetch });
    expect(r.statusCode).toBe(404);
    expect(r.body).toBe('');
  });
});
