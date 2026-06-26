/**
 * Task 4: Per-burner Tor identity + transport config.
 *
 * Invariants verified:
 *   - Same burnerId  → same (user, pass) within the process (stable circuit).
 *   - Distinct burnerIds → distinct (user, pass) (IsolateSOCKSAuth isolation).
 *   - burnerProxyConfig returns { host:'127.0.0.1', port, version:5, user, password }
 *     when bgconn Tor is bootstrapped.
 *   - burnerProxyConfig throws SocmintTorUnavailableError when Tor is not bootstrapped
 *     or when getBgTor() returns null — never returns a clearnet/no-proxy config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';
import {
  deriveBurnerCredentials,
  burnerProxyConfig,
  SocmintTorUnavailableError,
} from '../src/main/socmint/tor-identity';

// Minimal object satisfying the BgconnTor shape used by tor-singleton.
// We only need isBootstrapped() + socksPort() for these tests.
function makeMockTor(bootstrapped: boolean, port: number): BgconnTor {
  return {
    isBootstrapped: () => bootstrapped,
    socksPort: () => port,
    start: async () => {},
    stop: async () => {},
  } as unknown as BgconnTor;
}

// ---------------------------------------------------------------------------
// deriveBurnerCredentials
// ---------------------------------------------------------------------------

describe('deriveBurnerCredentials', () => {
  it('returns the same creds for the same burnerId on repeated calls (stable circuit)', () => {
    const a = deriveBurnerCredentials('burner-alpha');
    const b = deriveBurnerCredentials('burner-alpha');
    expect(a.user).toBe(b.user);
    expect(a.pass).toBe(b.pass);
  });

  it('returns distinct creds for distinct burnerIds (circuit isolation)', () => {
    const a = deriveBurnerCredentials('burner-alpha');
    const b = deriveBurnerCredentials('burner-beta');
    expect(a.user).not.toBe(b.user);
    expect(a.pass).not.toBe(b.pass);
  });

  it('user and pass are non-empty lowercase hex strings', () => {
    const { user, pass } = deriveBurnerCredentials('test-burner');
    expect(user).toMatch(/^[0-9a-f]+$/);
    expect(pass).toMatch(/^[0-9a-f]+$/);
    expect(user.length).toBeGreaterThan(0);
    expect(pass.length).toBeGreaterThan(0);
  });

  it('user and pass differ from each other for the same burnerId', () => {
    const { user, pass } = deriveBurnerCredentials('same-burner');
    expect(user).not.toBe(pass);
  });

  it('many distinct burnerIds all produce distinct user fields', () => {
    const users = Array.from({ length: 20 }, (_, i) =>
      deriveBurnerCredentials(`burner-${i}`).user,
    );
    const unique = new Set(users);
    expect(unique.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// burnerProxyConfig — Tor bootstrapped
// ---------------------------------------------------------------------------

describe('burnerProxyConfig — Tor bootstrapped', () => {
  beforeEach(() => {
    setBgTor(makeMockTor(true, 9999));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('returns a config with the expected shape', () => {
    const cfg = burnerProxyConfig('burner-alpha');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(9999);
    expect(cfg.version).toBe(5);
    expect(typeof cfg.user).toBe('string');
    expect(typeof cfg.password).toBe('string');
    expect(cfg.user.length).toBeGreaterThan(0);
    expect(cfg.password.length).toBeGreaterThan(0);
  });

  it('config carries the credentials from deriveBurnerCredentials', () => {
    const { user, pass } = deriveBurnerCredentials('burner-alpha');
    const cfg = burnerProxyConfig('burner-alpha');
    expect(cfg.user).toBe(user);
    expect(cfg.password).toBe(pass);
  });

  it('distinct burnerIds yield distinct proxy user/password (isolation)', () => {
    const cfg1 = burnerProxyConfig('burner-alpha');
    const cfg2 = burnerProxyConfig('burner-beta');
    expect(cfg1.user).not.toBe(cfg2.user);
    expect(cfg1.password).not.toBe(cfg2.password);
    // Both must point to the same SOCKS port on loopback.
    expect(cfg1.host).toBe('127.0.0.1');
    expect(cfg2.host).toBe('127.0.0.1');
    expect(cfg1.port).toBe(9999);
    expect(cfg2.port).toBe(9999);
  });

  it('same burnerId returns the same config on repeated calls (stable circuit)', () => {
    const cfg1 = burnerProxyConfig('burner-stable');
    const cfg2 = burnerProxyConfig('burner-stable');
    expect(cfg1.user).toBe(cfg2.user);
    expect(cfg1.password).toBe(cfg2.password);
    expect(cfg1.port).toBe(cfg2.port);
  });

  it('version is exactly the number 5 (not a string)', () => {
    const cfg = burnerProxyConfig('burner-alpha');
    expect(cfg.version).toStrictEqual(5);
  });
});

// ---------------------------------------------------------------------------
// burnerProxyConfig — Tor not bootstrapped
// ---------------------------------------------------------------------------

describe('burnerProxyConfig — Tor not bootstrapped', () => {
  beforeEach(() => {
    setBgTor(makeMockTor(false, 9999));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('throws SocmintTorUnavailableError', () => {
    expect(() => burnerProxyConfig('burner-alpha')).toThrow(SocmintTorUnavailableError);
  });

  it('throws an Error (subclass of Error)', () => {
    expect(() => burnerProxyConfig('burner-alpha')).toThrow(Error);
  });

  it('never returns — always throws when not bootstrapped (no clearnet fallback)', () => {
    let returned = false;
    try {
      burnerProxyConfig('burner-alpha');
      returned = true;
    } catch {
      // expected
    }
    expect(returned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// burnerProxyConfig — no Tor instance (getBgTor() === null)
// ---------------------------------------------------------------------------

describe('burnerProxyConfig — no Tor instance', () => {
  beforeEach(() => {
    _resetBgTorForTest();
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('throws SocmintTorUnavailableError when getBgTor() returns null', () => {
    expect(() => burnerProxyConfig('burner-alpha')).toThrow(SocmintTorUnavailableError);
  });
});
