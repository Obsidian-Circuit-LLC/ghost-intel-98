import { describe, it, expect, vi } from 'vitest';
import { makeHostInfoService } from '../src/main/services/hostinfo/index';
import type { HostInfo } from '../src/main/services/hostinfo/types';

const info = (host: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt: '2026-02-02T00:00:00Z', errors: [] });

function deps(cached: HostInfo | null) {
  const resolveHost = vi.fn(async (_url: string) => info('1.2.3.4'));
  const load = vi.fn(async (_host: string) => cached);
  const save = vi.fn(async (_i: HostInfo) => {});
  return { resolveHost, store: { load, save }, hostOf: (_url: string) => '1.2.3.4' };
}

describe('hostinfo service', () => {
  it('cache hit (fresh) returns cached and does NOT resolve', async () => {
    const d = deps(info('1.2.3.4'));
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v');
    expect(r.host).toBe('1.2.3.4');
    expect(d.resolveHost).not.toHaveBeenCalled();
  });
  it('cache miss resolves then saves', async () => {
    const d = deps(null);
    const svc = makeHostInfoService(d as never);
    await svc.resolve('http://1.2.3.4/v');
    expect(d.resolveHost).toHaveBeenCalledOnce();
    expect(d.store.save).toHaveBeenCalledOnce();
  });
  it('force bypasses the cache', async () => {
    const d = deps(info('1.2.3.4'));
    const svc = makeHostInfoService(d as never);
    await svc.resolve('http://1.2.3.4/v', { force: true });
    expect(d.resolveHost).toHaveBeenCalledOnce();
  });
  it('does NOT cache a transient tor-not-ready partial (would poison the 30-day cache)', async () => {
    // The fast-fail returns a partial with a tor-not-ready marker while Tor warms in the background.
    // Persisting it would make every later non-force lookup keep returning "Tor not ready" from cache
    // even after Tor bootstraps — so it must be returned to the caller but never saved.
    const notReady: HostInfo = { host: '1.2.3.4', isIpLiteral: true, ips: [], resolvedAt: '2026-02-02T00:00:00Z', errors: ['tor-not-ready'] };
    const resolveHost = vi.fn(async (_url: string) => notReady);
    const save = vi.fn(async (_i: HostInfo) => {});
    const d = { resolveHost, store: { load: vi.fn(async () => null), save }, hostOf: (_u: string) => '1.2.3.4' };
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v');
    expect(r.errors).toContain('tor-not-ready'); // surfaced to the renderer ("needs Tor")
    expect(save).not.toHaveBeenCalled();          // but NOT persisted → a later lookup re-resolves
  });
});
