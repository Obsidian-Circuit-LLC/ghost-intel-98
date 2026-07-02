import { describe, it, expect, vi } from 'vitest';
import { resolveHostInfoGated } from '../src/main/services/hostinfo/gate';
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

describe('hostinfo resolution invariant — Tor-only, no clearnet fetch ever', () => {
  it('a full resolution routes EVERY lookup through the injected Tor fetch; the clearnet path is never called', async () => {
    // Two distinct injected fetchers. resolveHost is wired ONLY to the Tor one; the clearnet spy
    // stands in for any direct/https egress that would leak the operator's real IP. If resolution
    // ever fell back to clearnet this spy would fire.
    const clearnetFetch = vi.fn(async () => { throw new Error('clearnet must never be used for host resolution'); });
    const torFetch = vi.fn(async (url: string) => {
      if (url.includes('type=A')) return { Answer: [{ type: 1, data: '5.6.7.8' }] };
      if (url.includes('type=PTR')) return { Answer: [{ type: 12, data: 'cam.example.' }] };
      return {}; // rdap: empty object → no rdap block, still exercises the Tor fetch
    });

    const out = await resolveHost('http://cam.example/stream', { fetchJson: torFetch, now: () => '2026-02-02T00:00:00Z' });

    expect(torFetch).toHaveBeenCalled();
    expect(clearnetFetch).not.toHaveBeenCalled();
    // Every URL handed to a fetcher went to the Tor fetcher — the https DoH / RDAP recon URLs.
    for (const call of torFetch.mock.calls) expect(String(call[0])).toMatch(/^https:\/\//);
    expect(out.ips).toContain('5.6.7.8');
  });

  it('gate OFF: neither the Tor fetch nor the clearnet fetch runs — resolution is disabled entirely', async () => {
    const clearnetFetch = vi.fn();
    const torFetch = vi.fn();
    const d = {
      resolveEnabled: async () => false,
      // If the gate ever let this through, resolveHost would invoke torFetch — it must not.
      resolve: (url: string) => resolveHost(url, { fetchJson: torFetch, now: () => 'x' }),
      hostOf: (u: string) => { try { return new URL(u).hostname; } catch { return ''; } },
      now: () => 'x'
    };
    await resolveHostInfoGated(d, 'http://cam.example/stream');
    expect(torFetch).not.toHaveBeenCalled();
    expect(clearnetFetch).not.toHaveBeenCalled();
  });
});
