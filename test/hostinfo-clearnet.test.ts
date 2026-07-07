import { describe, it, expect, vi } from 'vitest';
import { makeHostInfoService } from '../src/main/services/hostinfo/index';
import { resolveHost } from '../src/main/services/hostinfo/resolve';
import type { HostInfo } from '../src/main/services/hostinfo/types';

const info = (host: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt: '2026-02-02T00:00:00Z', errors: [] });

function deps() {
  const resolveHostSpy = vi.fn(async (_url: string, _via: 'tor' | 'clearnet') => info('1.2.3.4'));
  const load = vi.fn(async (_host: string) => null);
  const save = vi.fn(async (_i: HostInfo) => {});
  return { resolveHost: resolveHostSpy, store: { load, save }, hostOf: (_url: string) => '1.2.3.4' };
}

describe('hostinfo service via marker (opt-in clearnet resolve)', () => {
  it('resolve(url, { via: "clearnet" }) threads clearnet to the resolver and stamps info.via', async () => {
    const d = deps();
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v', { via: 'clearnet' });
    expect(d.resolveHost).toHaveBeenCalledWith('http://1.2.3.4/v', 'clearnet');
    expect(r.via).toBe('clearnet');
  });

  it('resolve(url) with no via option defaults to tor', async () => {
    const d = deps();
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v');
    expect(d.resolveHost).toHaveBeenCalledWith('http://1.2.3.4/v', 'tor');
    expect(r.via).toBe('tor');
  });

  it('resolve(url, { via: "tor" }) explicitly stamps tor', async () => {
    const d = deps();
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v', { via: 'tor' });
    expect(r.via).toBe('tor');
  });
});

describe('resolveHost (resolve.ts) is via-agnostic — via is stamped by the service, not the resolver', () => {
  it('injecting a fake fetchJson still returns the parsed info, with no via field of its own', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('type=A')) return { Answer: [{ type: 1, data: '5.6.7.8' }] };
      if (url.includes('PTR')) return { Answer: [{ type: 12, data: 'cam.example.' }] };
      return {};
    });
    const out = await resolveHost('http://cam.example/stream', { fetchJson, now: () => '2026-02-02T00:00:00Z' });
    expect(out.ips).toContain('5.6.7.8');
    expect((out as HostInfo & { via?: unknown }).via).toBeUndefined();
    // No real network call is possible here — fetchJson is fully injected and never resolves to a
    // real URL fetch.
  });
});
