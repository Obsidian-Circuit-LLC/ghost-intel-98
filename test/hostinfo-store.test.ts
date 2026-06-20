import { describe, it, expect, vi } from 'vitest';
import { makeHostInfoStore, TTL_MS } from '../src/main/services/hostinfo/store';
import type { HostInfo } from '../src/main/services/hostinfo/types';

function memFs(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    readText: vi.fn(async (p: string) => { if (!m.has(p)) { const e = new Error('no'); (e as NodeJS.ErrnoException).code = 'ENOENT'; throw e; } return m.get(p)!; }),
    writeFile: vi.fn(async (p: string, d: string) => { m.set(p, d); }),
    _m: m
  };
}
const info = (host: string, resolvedAt: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt, errors: [] });
const NOW = Date.parse('2026-02-02T00:00:00Z');

describe('hostinfo store', () => {
  it('save then load returns a fresh entry', async () => {
    const fs = memFs(); const store = makeHostInfoStore({ ...fs, indexPath: () => 'hostinfo/index.json', now: () => NOW });
    await store.save(info('1.2.3.4', '2026-02-01T00:00:00Z'));
    expect((await store.load('1.2.3.4'))?.host).toBe('1.2.3.4');
  });
  it('load returns null for a missing host', async () => {
    const store = makeHostInfoStore({ ...memFs(), indexPath: () => 'hostinfo/index.json', now: () => NOW });
    expect(await store.load('9.9.9.9')).toBeNull();
  });
  it('load returns null for a stale entry (past TTL)', async () => {
    const stale = JSON.stringify({ '1.2.3.4': info('1.2.3.4', new Date(NOW - TTL_MS - 1).toISOString()) });
    const store = makeHostInfoStore({ ...memFs({ 'hostinfo/index.json': stale }), indexPath: () => 'hostinfo/index.json', now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull();
  });
  it('a missing index file (ENOENT) is treated as empty, not an error', async () => {
    const store = makeHostInfoStore({ ...memFs(), indexPath: () => 'hostinfo/index.json', now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull(); // no throw
  });
  it('corrupt index is treated as empty (cache miss)', async () => {
    const store = makeHostInfoStore({ ...memFs({ 'hostinfo/index.json': '{ not json' }), indexPath: () => 'hostinfo/index.json', now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull();
  });
});
