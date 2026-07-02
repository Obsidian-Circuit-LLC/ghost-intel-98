import { describe, it, expect, vi } from 'vitest';
import { resolveHostInfoGated, hostResolveEnabledFrom } from '../src/main/services/hostinfo/gate';
import { resolveHost } from '../src/main/services/hostinfo/resolve';
import type { HostInfo } from '../src/main/services/hostinfo/types';

const info = (host: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt: '2026-02-02T00:00:00Z', errors: [] });

function gateDeps(enabled: boolean) {
  return {
    // stand-in for settings.geoint.cctvResolveHosts
    resolveEnabled: vi.fn(async () => enabled),
    // stand-in for the Tor-only hostInfoService.resolve facade
    resolve: vi.fn(async (_url: string, _opts: { force?: boolean }) => info('1.2.3.4')),
    hostOf: (u: string) => { try { return new URL(u).hostname; } catch { return ''; } },
    now: () => '2026-02-02T00:00:00Z'
  };
}

describe('hostinfo IPC resolve gate (settings.geoint.cctvResolveHosts)', () => {
  it('gate OFF: returns a disabled result FAST and NEVER invokes the resolver (no Tor lookup at all)', async () => {
    const d = gateDeps(false);
    const r = await resolveHostInfoGated(d, 'http://camera.example/v', { force: true });
    expect(r.errors).toContain('resolve-disabled');
    expect(r.ips).toEqual([]);
    expect(r.host).toBe('camera.example'); // pure local extraction only — no network
    // The resolver (and therefore Tor) is never touched when the setting is off.
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it('gate ON: delegates to the Tor-only resolver with the same url + opts', async () => {
    const d = gateDeps(true);
    const r = await resolveHostInfoGated(d, 'http://1.2.3.4/v', { force: true });
    expect(d.resolve).toHaveBeenCalledOnce();
    expect(d.resolve).toHaveBeenCalledWith('http://1.2.3.4/v', { force: true });
    expect(r.host).toBe('1.2.3.4');
  });

  it('gate ON, no opts: still delegates (default force undefined)', async () => {
    const d = gateDeps(true);
    await resolveHostInfoGated(d, 'http://1.2.3.4/v');
    expect(d.resolve).toHaveBeenCalledOnce();
  });
});

describe('hostinfo resolution invariant — Tor-only egress', () => {
  it('routes EVERY recon lookup (DoH A / PTR / RDAP) through the single injected fetcher — the sole egress', async () => {
    // resolveHost's ResolveDeps exposes ONLY `fetchJson` (wired to torFetchJson in production, see
    // index.ts) — there is no other fetch route in the module, so this is the real Tor-only guarantee:
    // every recon request goes through the one injected fetcher and nowhere else. We assert all three
    // stages hit it, with the expected DoH/RDAP URLs.
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('type=A')) return { Answer: [{ type: 1, data: '5.6.7.8' }] };
      if (url.includes('type=PTR')) return { Answer: [{ type: 12, data: 'cam.example.' }] };
      return {}; // rdap: empty object → no rdap block, still exercises the fetcher
    });

    const out = await resolveHost('http://cam.example/stream', { fetchJson, now: () => '2026-02-02T00:00:00Z' });

    // Three stages, each through the injected fetcher: DNS A, reverse PTR, RDAP.
    expect(fetchJson).toHaveBeenCalledTimes(3);
    const urls = fetchJson.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('cloudflare-dns.com') && u.includes('type=A'))).toBe(true);
    expect(urls.some((u) => u.includes('type=PTR'))).toBe(true);
    expect(urls.some((u) => u.includes('rdap.org/ip/'))).toBe(true);
    expect(out.ips).toContain('5.6.7.8');
  });

  it('gate OFF: the resolver (and therefore the fetcher) is never invoked — resolution disabled entirely', async () => {
    const fetchJson = vi.fn();
    const d = {
      resolveEnabled: async () => false,
      // If the gate ever let this through, resolveHost would invoke fetchJson — it must not.
      resolve: (url: string) => resolveHost(url, { fetchJson, now: () => 'x' }),
      hostOf: (u: string) => { try { return new URL(u).hostname; } catch { return ''; } },
      now: () => 'x'
    };
    await resolveHostInfoGated(d, 'http://cam.example/stream');
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

describe('host-resolution setting field wiring (hostResolveEnabledFrom)', () => {
  it('reads geoint.cctvResolveHosts, NOT the stream toggle geoint.cctvOverTor', () => {
    // Settings where the two toggles DISAGREE — proves the resolve gate reads the resolution field,
    // not the stream field. register.ts wires resolveEnabled through this helper.
    expect(hostResolveEnabledFrom({ geoint: { cctvResolveHosts: true, cctvOverTor: false } } as never)).toBe(true);
    expect(hostResolveEnabledFrom({ geoint: { cctvResolveHosts: false, cctvOverTor: true } } as never)).toBe(false);
  });
});
