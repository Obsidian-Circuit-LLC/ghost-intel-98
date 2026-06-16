import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The SSRF guards resolve DNS + inspect the URL; stub both to pass so the test isolates the
// header-forwarding behaviour across redirect hops.
vi.mock('../src/main/security/validate', () => ({
  isPublicHttpUrl: () => true,
  assertResolvedPublic: async () => undefined
}));
vi.mock('../src/main/net/limits', () => ({ FETCH_TIMEOUT_MS: 5000 }));

import { safeFetch } from '../src/main/net/safe-fetch';

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}
function ok(): Response {
  return new Response('done', { status: 200 });
}

const SENSITIVE = { Authorization: 'Bearer secret', 'x-ucdp-access-token': 'tok-123' };

describe('safeFetch redirect header handling', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('strips sensitive headers on a cross-origin redirect hop', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
      return calls.length === 1 ? redirect('https://evil.example/steal') : ok();
    });
    vi.stubGlobal('fetch', fetchMock);

    await safeFetch('https://api.example/resource', 4, { ...SENSITIVE, accept: 'application/json' });

    expect(calls).toHaveLength(2);
    // Hop 0 (original origin) keeps everything.
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
    expect(calls[0].headers['x-ucdp-access-token']).toBe('tok-123');
    // Hop 1 (cross-origin) must NOT carry the credentials.
    expect(calls[1].headers.Authorization).toBeUndefined();
    expect(calls[1].headers['x-ucdp-access-token']).toBeUndefined();
    // A safe header may still be forwarded.
    expect(calls[1].headers.accept).toBe('application/json');
  });

  it('keeps sensitive headers across a same-origin redirect', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
      return calls.length === 1 ? redirect('https://api.example/resource/v2') : ok();
    });
    vi.stubGlobal('fetch', fetchMock);

    await safeFetch('https://api.example/resource', 4, { ...SENSITIVE });

    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe('Bearer secret');
    expect(calls[1].headers['x-ucdp-access-token']).toBe('tok-123');
  });
});
