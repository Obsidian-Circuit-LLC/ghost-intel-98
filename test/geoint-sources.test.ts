import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'ga98-geo-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

// Mirrors sources.ts: dataRoot() = join(getPath('userData'), 'GhostAccess98'); cache lives under geoint-cache/.
const CACHE_DIR = join(DATA, 'GhostAccess98', 'geoint-cache');
const cachePath = (id: string): string => join(CACHE_DIR, `${id}.json`);

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
  it('removeSource deletes the source and its orphaned cache file', async () => {
    const s = await store.addSource({ label: 'X', url: 'https://x', type: 'rss' });
    await store.cacheItems(s.id, [{ id: 'i1', sourceId: s.id, title: 'T', located: 'none' }]);
    expect(existsSync(cachePath(s.id))).toBe(true);
    await store.removeSource(s.id);
    expect(await store.listSources()).toHaveLength(0);
    expect(existsSync(cachePath(s.id))).toBe(false);
  });
  it('purgeAll clears every source and removes the whole cache directory', async () => {
    const a = await store.addSource({ label: 'A', url: 'https://a', type: 'rss' });
    const b = await store.addSource({ label: 'B', url: 'https://b', type: 'geojson' });
    await store.cacheItems(a.id, [{ id: 'i1', sourceId: a.id, title: 'T', located: 'none' }]);
    await store.cacheItems(b.id, [{ id: 'i2', sourceId: b.id, title: 'U', located: 'none' }]);
    expect(existsSync(CACHE_DIR)).toBe(true);
    await store.purgeAll();
    expect(await store.listSources()).toHaveLength(0);
    expect(existsSync(CACHE_DIR)).toBe(false);
    // Idempotent: a second purge on a missing cache dir is a no-op (force ignores ENOENT).
    await store.purgeAll();
    expect(await store.listSources()).toHaveLength(0);
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
