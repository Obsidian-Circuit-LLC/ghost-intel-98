import { describe, it, expect, vi } from 'vitest';

const isPublicHttpUrlSpy = vi.fn((u: string) =>
  /^https?:\/\//.test(u) && !/localhost|127\.0\.0\.1|10\.|192\.168\./.test(u)
);
const assertResolvedPublicSpy = vi.fn(async (h: string) => {
  if (/127\.0\.0\.1|localhost/.test(h)) throw new Error('private');
});

vi.mock('../src/main/security/validate', () => ({
  isPublicHttpUrl: (u: string) => isPublicHttpUrlSpy(u),
  assertResolvedPublic: async (h: string) => assertResolvedPublicSpy(h),
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

  // F2: Tor path must NOT call assertResolvedPublic (DNS leak prevention)
  it('Tor path with public url skips local DNS resolve (no assertResolvedPublic call)', async () => {
    assertResolvedPublicSpy.mockClear();
    // socksPort null => TOR_UNAVAILABLE; enough to confirm no DNS was called
    const r = await probe(
      'https://example.com/u',
      { fetchBody: false, useTor: true },
      { socksPort: () => null }
    );
    expect(assertResolvedPublicSpy).not.toHaveBeenCalled();
    expect(r.error).toBe('TOR_UNAVAILABLE');
  });

  // F2: isPublicHttpUrl still guards literal-private targets on the Tor path
  it('Tor path with literal-private url is rejected before dial (isPublicHttpUrl guard)', async () => {
    assertResolvedPublicSpy.mockClear();
    const dial = vi.fn();
    const r = await probe(
      'https://127.0.0.1/u',
      { fetchBody: false, useTor: true },
      { socksPort: () => 9050, dial: dial as never }
    );
    // isPublicHttpUrl returns false for 127.0.0.1 => CONNECTION_ERROR, no dial
    expect(r.error).toBe('CONNECTION_ERROR');
    expect(dial).not.toHaveBeenCalled();
    // assertResolvedPublic also not called (we never reach that branch)
    expect(assertResolvedPublicSpy).not.toHaveBeenCalled();
  });
});
