/**
 * plugin-wire-deps.test.ts
 *
 * Shape-level tests for buildContextDeps() and refreshPluginNetSnapshot().
 * Live store integration is smoke-tested in Task 16; here we assert:
 *   1. buildContextDeps() returns an object whose surface matches ContextDeps.
 *   2. isNetworkEnabled is a synchronous function.
 *   3. isNetworkEnabled reflects the injected snapshot (gate is CLOSED when
 *      networkEnabled is false or absent — nothing leaks from a stale snapshot).
 *   4. validateUrl accepts a real public URL and rejects loopback/private URLs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'dcs98-wiredeps-'));

// electron mock — must come before the module under test is imported.
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import { buildContextDeps, refreshPluginNetSnapshot } from '../src/main/plugins/wire-deps';

beforeEach(() => {
  // Reset snapshot to empty state before each test.
  refreshPluginNetSnapshot({});
});

describe('buildContextDeps()', () => {
  it('returns an object with all required ContextDeps surface keys', () => {
    const deps = buildContextDeps();
    expect(typeof deps.isNetworkEnabled).toBe('function');
    expect(typeof deps.rawFetch).toBe('function');
    expect(typeof deps.validateUrl).toBe('function');
    expect(typeof deps.secretBackend.get).toBe('function');
    expect(typeof deps.secretBackend.set).toBe('function');
    expect(typeof deps.secretBackend.delete).toBe('function');
    expect(deps.entities).toBeDefined();
    expect(typeof deps.timelineAppend).toBe('function');
    expect(typeof deps.caseSidecar.read).toBe('function');
    expect(typeof deps.caseSidecar.write).toBe('function');
    expect(typeof deps.pluginStore.read).toBe('function');
    expect(typeof deps.pluginStore.write).toBe('function');
    expect(typeof deps.pluginStore.list).toBe('function');
    expect(typeof deps.pluginStore.delete).toBe('function');
  });

  it('isNetworkEnabled is synchronous (returns a boolean, not a Promise)', () => {
    refreshPluginNetSnapshot({ 'test-plugin': { enabled: true, networkEnabled: true } });
    const deps = buildContextDeps();
    const result = deps.isNetworkEnabled('test-plugin');
    // Must be a plain boolean, NOT a Promise
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  it('isNetworkEnabled returns true only when networkEnabled === true in snapshot', () => {
    refreshPluginNetSnapshot({
      'enabled-net': { enabled: true, networkEnabled: true },
      'disabled-net': { enabled: true, networkEnabled: false },
      'no-net-key': { enabled: true }
    });
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('enabled-net')).toBe(true);
    expect(deps.isNetworkEnabled('disabled-net')).toBe(false);
    expect(deps.isNetworkEnabled('no-net-key')).toBe(false);
  });

  it('isNetworkEnabled defaults to false for unknown plugin ids (gate closed)', () => {
    // Empty snapshot — no plugins configured
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('unknown-plugin')).toBe(false);
    expect(deps.isNetworkEnabled('')).toBe(false);
  });

  it('isNetworkEnabled reflects a refreshed snapshot without rebuilding deps', () => {
    // Deps object is built BEFORE the snapshot is updated — simulates the v1 flow
    // where buildContextDeps() captures a closure over the module-level snapshot.
    const deps = buildContextDeps();

    // Initially closed
    expect(deps.isNetworkEnabled('my-plugin')).toBe(false);

    // After a snapshot refresh the same deps object reflects the new state
    refreshPluginNetSnapshot({ 'my-plugin': { enabled: true, networkEnabled: true } });
    expect(deps.isNetworkEnabled('my-plugin')).toBe(true);
  });

  it('validateUrl accepts a real public HTTPS URL', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('https://example.com/api')).not.toThrow();
    expect(deps.validateUrl('https://example.com/api')).toBe('https://example.com/api');
  });

  it('validateUrl rejects loopback URLs (SSRF guard)', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('http://127.0.0.1/internal')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('http://localhost/secret')).toThrow(/SSRF validator/);
  });

  it('validateUrl rejects private-network URLs (SSRF guard)', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('http://192.168.1.1/admin')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('http://10.0.0.1/internal')).toThrow(/SSRF validator/);
  });

  it('validateUrl rejects non-http(s) URLs', () => {
    const deps = buildContextDeps();
    expect(() => deps.validateUrl('ftp://example.com/file')).toThrow(/SSRF validator/);
    expect(() => deps.validateUrl('file:///etc/passwd')).toThrow(/SSRF validator/);
  });
});

describe('refreshPluginNetSnapshot()', () => {
  it('accepts undefined (clears the snapshot)', () => {
    refreshPluginNetSnapshot({ 'some-plugin': { networkEnabled: true } });
    refreshPluginNetSnapshot(undefined);
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('some-plugin')).toBe(false);
  });

  it('accepts an empty record (no plugins enabled)', () => {
    refreshPluginNetSnapshot({});
    const deps = buildContextDeps();
    expect(deps.isNetworkEnabled('any')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rawFetch SSRF hardening: redirect re-validation + hop-limit
//
// Mocking strategy:
//   - globalThis.fetch is spied upon so no real network calls occur.
//   - assertResolvedPublic (the DNS-resolve guard) is mocked via vi.mock at the
//     module level (vi.mock is hoisted by vitest) so tests are deterministic and
//     offline. vi.mocked() gives a typed handle to reconfigure it per test.
//   - isPublicHttpUrl (the textual guard) is left un-mocked so its real logic
//     exercises the defense-in-depth path.
// ---------------------------------------------------------------------------

// Hoist the validate-module mock. vi.mock is hoisted to the top of the file by
// vitest, so this runs before any imports are resolved.
vi.mock('../src/main/security/validate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/security/validate')>();
  return {
    ...real,
    // Default: resolves without throwing (simulates a non-private resolved address).
    assertResolvedPublic: vi.fn().mockResolvedValue(undefined)
  };
});

// Import the mocked validate module at the top level (safe because vi.mock is hoisted).
import * as validateMod from '../src/main/security/validate';

describe('rawFetch SSRF hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset the DNS mock to the default (non-throwing) behaviour after each test.
    vi.mocked(validateMod.assertResolvedPublic).mockResolvedValue(undefined);
  });

  it('rejects a redirect whose Location resolves to a private/loopback address (textual check)', async () => {
    // fetch returns a 302 whose Location is a literal loopback IP.
    // isPublicHttpUrl catches this at the textual layer before assertResolvedPublic is called.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/internal' }
      }) as Response
    );

    const deps = buildContextDeps();
    await expect(
      deps.rawFetch('https://public.example.com/api', { method: 'GET', direct: true })
    ).rejects.toThrow(/SSRF validator/);

    fetchSpy.mockRestore();
  });

  it('rejects a redirect whose Location is a private CNAME (DNS rebind) — assertResolvedPublic throws', async () => {
    // Simulate: first hop 302s to a "public-looking" hostname that resolves to a private IP.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://internal.attacker.com/secret' }
      }) as Response
    );

    // DNS mock: assertResolvedPublic throws for the redirect target host.
    vi.mocked(validateMod.assertResolvedPublic).mockImplementation((hostname: string) => {
      if (hostname === 'internal.attacker.com') {
        return Promise.reject(new Error('refusing to fetch internal.attacker.com — resolves to a private address'));
      }
      return Promise.resolve();
    });

    const deps = buildContextDeps();
    await expect(
      deps.rawFetch('https://public.example.com/api', { method: 'GET', direct: true })
    ).rejects.toThrow(/resolves to a private address/);

    fetchSpy.mockRestore();
  });

  it('enforces the hop limit (more than MAX_HOPS redirects → throws)', async () => {
    // Every fetch call returns a 302 pointing back to the same public URL — infinite loop.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://public.example.com/loop' }
      }) as Response
    );

    const deps = buildContextDeps();
    await expect(
      deps.rawFetch('https://public.example.com/loop', { method: 'GET', direct: true })
    ).rejects.toThrow(/too many redirects/);

    // Confirm fetch was called exactly MAX_HOPS (5) times before the limit was hit.
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    fetchSpy.mockRestore();
  });

  it('follows legitimate redirects and returns the final URL + body', async () => {
    // Two hops: public → public → final 200 response.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: 'https://cdn.example.com/resource' } }) as Response
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', { status: 200 }) as Response
      );

    const deps = buildContextDeps();
    const result = await deps.rawFetch('https://public.example.com/api', { method: 'GET', direct: true });
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.finalUrl).toBe('https://cdn.example.com/resource');

    fetchSpy.mockRestore();
  });

  it('strips credential headers when a redirect crosses to a different origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: 'https://evil.example.net/steal' } }) as Response
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }) as Response);

    const deps = buildContextDeps();
    await deps.rawFetch('https://api.example.com/data', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret', Cookie: 'sid=abc', 'X-Api-Key': 'k', 'User-Agent': 'dcs98' },
      direct: true
    });

    // Second hop (cross-origin) must NOT carry the credential headers, but keeps benign ones.
    const secondInit = fetchSpy.mock.calls[1][1] as { headers: Record<string, string> };
    expect(secondInit.headers.Authorization).toBeUndefined();
    expect(secondInit.headers.Cookie).toBeUndefined();
    expect(secondInit.headers['X-Api-Key']).toBeUndefined();
    expect(secondInit.headers['User-Agent']).toBe('dcs98');

    fetchSpy.mockRestore();
  });

  it('preserves credential headers on a same-origin redirect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: 'https://api.example.com/v2/data' } }) as Response
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }) as Response);

    const deps = buildContextDeps();
    await deps.rawFetch('https://api.example.com/data', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret' },
      direct: true
    });

    const secondInit = fetchSpy.mock.calls[1][1] as { headers: Record<string, string> };
    expect(secondInit.headers.Authorization).toBe('Bearer secret');

    fetchSpy.mockRestore();
  });

  it('downgrades POST→GET and drops the body on a 302 (RFC 7231); preserves both on 307', async () => {
    // 302: POST with body → GET, no body on the next hop.
    const spy302 = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: 'https://api.example.com/next' } }) as Response
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }) as Response);
    const deps = buildContextDeps();
    await deps.rawFetch('https://api.example.com/submit', { method: 'POST', body: 'payload', direct: true });
    const next302 = spy302.mock.calls[1][1] as { method: string; body?: string };
    expect(next302.method).toBe('GET');
    expect(next302.body).toBeUndefined();
    spy302.mockRestore();

    // 307: POST with body preserved.
    const spy307 = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 307, headers: { location: 'https://api.example.com/next' } }) as Response
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }) as Response);
    await deps.rawFetch('https://api.example.com/submit', { method: 'POST', body: 'payload', direct: true });
    const next307 = spy307.mock.calls[1][1] as { method: string; body?: string };
    expect(next307.method).toBe('POST');
    expect(next307.body).toBe('payload');
    spy307.mockRestore();
  });
});
