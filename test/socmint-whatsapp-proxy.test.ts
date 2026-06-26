/**
 * WA-T4: buildBaileysProxy() unit tests.
 *
 * All tests use pre-resolved SocmintTransport objects so no bgconn Tor singleton
 * or live Baileys is needed.
 *
 * Coverage:
 *   1.  direct transport  → returns null
 *   2.  tor transport     → returns a non-null string
 *   3.  tor URL           → starts with 'socks5://'
 *   4.  tor URL           → contains the user credential from the proxy config
 *   5.  tor URL           → contains the password credential from the proxy config
 *   6.  tor URL           → contains the host '127.0.0.1'
 *   7.  tor URL           → contains the port number as a string
 *   8.  tor URL format    → matches socks5://user:password@127.0.0.1:port exactly
 *   9.  tor URL           → two distinct proxy configs yield distinct URLs (user/pass differ)
 *   10. unknown mode      → throws (fail-closed; no clearnet fallback)
 *   11. unknown mode      → throws an Error instance
 *   12. unknown mode      → error message references 'fail closed'
 *   13. case-variant mode ('TOR') → throws (not silently clearnet)
 *   14. empty-string mode ('')   → throws (not silently clearnet)
 */

import { describe, it, expect } from 'vitest';
import { buildBaileysProxy } from '../src/main/socmint/whatsapp-proxy';
import { deriveBurnerCredentials } from '../src/main/socmint/tor-identity';
import type { SocmintTransport } from '../src/main/socmint/tor-identity';

// ---------------------------------------------------------------------------
// Test helpers — pre-resolved transport objects (no live Tor, no live Baileys)
// ---------------------------------------------------------------------------

function directTransport(): SocmintTransport {
  return { mode: 'direct' };
}

function torTransport(burnerId: string, port = 9050): SocmintTransport {
  const { user, pass } = deriveBurnerCredentials(burnerId);
  return {
    mode: 'tor',
    proxy: {
      host: '127.0.0.1',
      port,
      version: 5,
      user,
      password: pass,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite 1 — direct mode
// ---------------------------------------------------------------------------

describe('buildBaileysProxy — direct mode', () => {
  it('returns null for direct transport', () => {
    expect(buildBaileysProxy(directTransport())).toBeNull();
  });

  it('returns null regardless of which burnerId the caller used', () => {
    // The direct-mode branch ignores all proxy fields; null is the only valid return.
    expect(buildBaileysProxy(directTransport())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — tor mode: return type + URL format
// ---------------------------------------------------------------------------

describe('buildBaileysProxy — tor mode: return value', () => {
  it('returns a non-null value for tor transport', () => {
    const result = buildBaileysProxy(torTransport('wa-t4-burner-a'));
    expect(result).not.toBeNull();
  });

  it('returns a string for tor transport', () => {
    const result = buildBaileysProxy(torTransport('wa-t4-burner-a'));
    expect(typeof result).toBe('string');
  });

  it('URL starts with socks5://', () => {
    const url = buildBaileysProxy(torTransport('wa-t4-burner-a')) as string;
    expect(url.startsWith('socks5://')).toBe(true);
  });

  it('URL contains the user credential from the proxy config', () => {
    const { user } = deriveBurnerCredentials('wa-t4-burner-b');
    const url = buildBaileysProxy(torTransport('wa-t4-burner-b')) as string;
    expect(url).toContain(user);
  });

  it('URL contains the password credential from the proxy config', () => {
    const { pass } = deriveBurnerCredentials('wa-t4-burner-c');
    const url = buildBaileysProxy(torTransport('wa-t4-burner-c')) as string;
    expect(url).toContain(pass);
  });

  it('URL contains the loopback host 127.0.0.1', () => {
    const url = buildBaileysProxy(torTransport('wa-t4-burner-a')) as string;
    expect(url).toContain('127.0.0.1');
  });

  it('URL contains the port number', () => {
    const url = buildBaileysProxy(torTransport('wa-t4-burner-a', 9999)) as string;
    expect(url).toContain('9999');
  });

  it('URL matches socks5://user:password@127.0.0.1:port format exactly', () => {
    const burnerId = 'wa-t4-format-check';
    const { user, pass } = deriveBurnerCredentials(burnerId);
    const port = 9050;
    const transport = torTransport(burnerId, port);
    const url = buildBaileysProxy(transport) as string;
    expect(url).toBe(`socks5://${user}:${pass}@127.0.0.1:${port}`);
  });

  it('distinct burner IDs produce distinct proxy URLs (user/pass isolation)', () => {
    const url1 = buildBaileysProxy(torTransport('wa-t4-iso-alpha')) as string;
    const url2 = buildBaileysProxy(torTransport('wa-t4-iso-beta')) as string;
    // URLs must differ because per-burner SOCKS credentials differ.
    expect(url1).not.toBe(url2);
  });

  it('same burner ID produces the same URL on repeated calls (stable circuit)', () => {
    const url1 = buildBaileysProxy(torTransport('wa-t4-stable')) as string;
    const url2 = buildBaileysProxy(torTransport('wa-t4-stable')) as string;
    expect(url1).toBe(url2);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — fail-closed: unknown / corrupted mode
// ---------------------------------------------------------------------------

describe('buildBaileysProxy — fail-closed on unknown mode', () => {
  it('throws rather than returning null (clearnet fallback) on unknown mode', () => {
    const badTransport = { mode: 'unknown' } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(badTransport)).toThrow();
  });

  it('throws an Error instance on unknown mode', () => {
    const badTransport = { mode: 'unknown' } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(badTransport)).toThrow(Error);
  });

  it('error message references fail closed', () => {
    const badTransport = { mode: 'unknown' } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(badTransport)).toThrow(/fail closed/);
  });

  it('throws on case-variant TOR (not silently clearnet)', () => {
    // A settings-file corruption that changes 'tor' to 'TOR' must not yield clearnet.
    const caseVariant = { mode: 'TOR' } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(caseVariant)).toThrow();
  });

  it('throws on empty-string mode (not silently clearnet)', () => {
    const emptyMode = { mode: '' } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(emptyMode)).toThrow();
  });

  it('throws on mode that is not a string', () => {
    const numericMode = { mode: 1 } as unknown as SocmintTransport;
    expect(() => buildBaileysProxy(numericMode)).toThrow();
  });
});
