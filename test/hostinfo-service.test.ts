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
});
