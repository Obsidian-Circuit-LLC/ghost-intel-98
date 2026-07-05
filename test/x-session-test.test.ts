import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared egress-gated safeFetch so the cookie-validation logic is unit-tested WITHOUT a
// real DNS resolve / network egress. Mirrors test/geoint-reliefweb.test.ts.
vi.mock('../src/main/net/safe-fetch', () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from '../src/main/net/safe-fetch';
import { testSession, X_WEB_BEARER } from '../src/main/x/session-test';

const mockSafeFetch = vi.mocked(safeFetch);

// A distinctive cookie pair — used to prove no secret value ever leaks into a result or a thrown
// error (charter: no cookie value in any log/error).
const CREDS = { authToken: 'AUTHTOKEN_SECRET_abc123', ct0: 'CT0_SECRET_def456' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  mockSafeFetch.mockReset();
});

describe('session-test', () => {
  it('200 + screen_name → { valid:true, handle }', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(200, { screen_name: 'ghostexodus' }));
    const res = await testSession(CREDS);
    expect(res).toEqual({ valid: true, handle: 'ghostexodus' });
  });

  it('401 → expired', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(401, { errors: [{ code: 32 }] }));
    expect(await testSession(CREDS)).toEqual({ valid: false, reason: 'expired' });
  });

  it('403 → expired', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(403, {}));
    expect(await testSession(CREDS)).toEqual({ valid: false, reason: 'expired' });
  });

  it('429 → rate-limited', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(429, {}));
    expect(await testSession(CREDS)).toEqual({ valid: false, reason: 'rate-limited' });
  });

  it('a thrown fetch (network/timeout) → network', async () => {
    mockSafeFetch.mockRejectedValue(new Error('AbortError: timeout'));
    expect(await testSession(CREDS)).toEqual({ valid: false, reason: 'network' });
  });

  it('sends bearer + x-csrf-token + both cookies to the X settings endpoint', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(200, { screen_name: 'ghostexodus' }));
    await testSession(CREDS);

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [url, , headers] = mockSafeFetch.mock.calls[0] as [string, number | undefined, Record<string, string>];
    expect(url).toBe('https://api.x.com/1.1/account/settings.json');
    expect(headers.authorization).toBe(`Bearer ${X_WEB_BEARER}`);
    expect(headers['x-csrf-token']).toBe(CREDS.ct0);
    expect(headers.cookie).toBe(`auth_token=${CREDS.authToken}; ct0=${CREDS.ct0}`);
  });

  it('sanitizes a malicious screen_name before returning', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(200, { screen_name: '<img>evil' }));
    const res = await testSession(CREDS);
    expect(res.valid).toBe(true);
    if (res.valid) {
      // Stripped to [A-Za-z0-9_], so no angle brackets survive.
      expect(res.handle).toBe('imgevil');
      expect(res.handle).not.toContain('<');
      expect(res.handle).not.toContain('>');
    }
  });

  it('truncates an over-long screen_name to 15 chars', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(200, { screen_name: 'a'.repeat(40) }));
    const res = await testSession(CREDS);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.handle).toBe('a'.repeat(15));
  });

  it('a 200 with no usable screen_name is inconclusive (network), not a false valid', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(200, { something_else: true }));
    expect(await testSession(CREDS)).toEqual({ valid: false, reason: 'network' });
  });

  it('never leaks a cookie value into the result or a thrown error', async () => {
    // Drive every branch; assert the secret never appears in the serialized result, and that
    // testSession resolves rather than throwing (so no error string can carry the cookie).
    const responders = [
      () => jsonResponse(200, { screen_name: 'ok' }),
      () => jsonResponse(401, {}),
      () => jsonResponse(429, {}),
    ];
    for (const r of responders) {
      mockSafeFetch.mockResolvedValue(r());
      const res = await testSession(CREDS);
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain(CREDS.authToken);
      expect(serialized).not.toContain(CREDS.ct0);
    }
    // The throwing path must be caught and mapped, never rethrown with the cookie in the message.
    mockSafeFetch.mockRejectedValue(new Error('boom'));
    await expect(testSession(CREDS)).resolves.toEqual({ valid: false, reason: 'network' });
  });
});
