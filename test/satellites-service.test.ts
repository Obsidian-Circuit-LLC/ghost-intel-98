import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: vi.fn(async (p: string) => {
    if (!store.has(p)) { const e = new Error('no'); (e as NodeJS.ErrnoException).code = 'ENOENT'; throw e; }
    return store.get(p)!;
  }),
  secureWriteFile: vi.fn(async (p: string, d: string) => { store.set(p, d); })
}));
vi.mock('../src/main/storage/paths', () => ({ dataRoot: () => '/tmp/datax' }));
const netEnabled = { value: false };
vi.mock('../src/main/storage/json-fs', () => ({
  settingsStore: { read: async () => ({ geoint: { networkEnabled: netEnabled.value } }) }
}));

import * as sats from '../src/main/services/satellites';

beforeEach(() => { store.clear(); netEnabled.value = false; });

describe('satellites service', () => {
  it('upsert → list round-trips a user satellite', async () => {
    const rec = await sats.upsert({ name: 'MY SAT', noradId: null, line1: '1 x', line2: '2 x', type: 'other', tag: 't', active: true });
    expect(rec.id).toMatch(/^usat-/);
    const all = await sats.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'MY SAT', source: 'user', active: true });
  });
  it('remove deletes by id', async () => {
    const r = await sats.upsert({ name: 'X', noradId: null, line1: '1', line2: '2', type: 'other', active: true });
    await sats.remove(r.id);
    expect(await sats.list()).toEqual([]);
  });
  it('fetchGroup returns "" when the GeoINT network gate is OFF', async () => {
    netEnabled.value = false;
    expect(await sats.fetchGroup('active')).toBe('');
  });
});
