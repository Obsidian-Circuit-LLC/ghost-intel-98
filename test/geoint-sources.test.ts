import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'ga98-geo-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as store from '../src/main/geoint/sources';

beforeEach(async () => { await store._resetForTest(); });

describe('geoint source store', () => {
  it('adds, updates, removes sources', async () => {
    const s = await store.addSource({ label: 'Wire', url: 'https://w/feed.xml', type: 'rss' });
    expect(s.enabled).toBe(true);
    await store.updateSource(s.id, { enabled: false });
    expect((await store.listSources())[0].enabled).toBe(false);
    await store.removeSource(s.id);
    expect(await store.listSources()).toHaveLength(0);
  });
  it('caches + returns items per source via snapshot', async () => {
    const s = await store.addSource({ label: 'X', url: 'https://x', type: 'rss' });
    await store.cacheItems(s.id, [{ id: 'i1', sourceId: s.id, title: 'T', located: 'none' }]);
    const snap = await store.snapshot();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].title).toBe('T');
  });
  it('importSources bulk-adds and dedupes by URL', async () => {
    const n = await store.importSources([
      { label: 'A', url: 'http://a', type: 'rss' },
      { label: 'B', url: 'http://b', type: 'geojson' },
      { label: 'A dup', url: 'HTTP://A', type: 'rss' }
    ]);
    expect(n).toBe(2);
    expect(await store.listSources()).toHaveLength(2);
  });
  it('setItemLocation sets a manual pin and clears it', async () => {
    const s = await store.addSource({ label: 'X', url: 'https://x', type: 'rss' });
    await store.cacheItems(s.id, [{ id: 'i1', sourceId: s.id, title: 'T', located: 'none' }]);
    await store.setItemLocation('i1', { lat: 10, lon: 20 });
    expect((await store.snapshot()).items[0]).toMatchObject({ lat: 10, lon: 20, located: 'manual' });
    await store.setItemLocation('i1', null);
    expect((await store.snapshot()).items[0].located).toBe('none');
  });
});
