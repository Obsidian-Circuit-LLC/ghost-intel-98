import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'ga98-geo-eg-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as store from '../src/main/geoint/sources';

beforeEach(async () => { await store._resetForTest(); });

describe('geoint egress gate', () => {
  it('fetchSource performs NO network call when networkEnabled is false', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be called'));
    const s = await store.addSource({ label: 'X', url: 'https://x/feed.xml', type: 'rss' });
    const r = await store.fetchSource(s.id, false);
    expect(r).toEqual({ ok: false, count: 0 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
