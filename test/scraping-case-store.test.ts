import { describe, it, expect } from 'vitest';

import { makeScrapingCaseStore } from '../src/main/storage/scraping-cases';
import type { ScrapingCaseStoreDeps } from '../src/main/storage/scraping-cases';
import type { ScrapingCaseNs } from '../src/main/storage/paths';

/**
 * In-memory fs seam shared across both namespaces so we can prove socmint and x
 * are isolated (they write under distinct ns-prefixed paths through the SAME store deps).
 */
function makeMockDeps(): {
  deps: ScrapingCaseStoreDeps;
  files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();
  let seq = 0;
  let clock = 1_000;

  const enoent = (): NodeJS.ErrnoException => {
    const e = new Error('ENOENT') as NodeJS.ErrnoException;
    e.code = 'ENOENT';
    return e;
  };

  const deps: ScrapingCaseStoreDeps = {
    async readFile(path) {
      const b = files.get(path);
      if (!b) throw enoent();
      return b;
    },
    async writeFile(path, data) {
      files.set(path, Buffer.from(data, 'utf8'));
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
      }
      if (names.size === 0) throw enoent();
      return [...names];
    },
    async rm(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(prefix)) files.delete(key);
      }
    },
    now: () => clock++,
    uuid: () => `id-${++seq}`,
    nsDir: (ns) => `/root/${ns}`,
    caseDir: (ns, id) => `/root/${ns}/${id}`,
    caseFile: (ns, id) => `/root/${ns}/${id}/case.json`,
  };

  return { deps, files };
}

function roundTripSuite(ns: ScrapingCaseNs) {
  describe(`makeScrapingCaseStore('${ns}')`, () => {
    it('lists empty before anything is created', async () => {
      const { deps } = makeMockDeps();
      const store = makeScrapingCaseStore(ns, deps);
      expect(await store.list()).toEqual([]);
    });

    it('round-trips create/list/read/rename/remove', async () => {
      const { deps } = makeMockDeps();
      const store = makeScrapingCaseStore(ns, deps);

      const a = await store.create('Alpha');
      const b = await store.create('Beta');

      expect(a.id).not.toBe(b.id);
      expect(a.name).toBe('Alpha');
      expect(a.createdAt).toBe(a.updatedAt);

      // Stable order: createdAt asc, id asc.
      const listed = await store.list();
      expect(listed.map((c) => c.name)).toEqual(['Alpha', 'Beta']);

      const readA = await store.read(a.id);
      expect(readA).toEqual(a);

      const renamed = await store.rename(a.id, 'Alpha-2');
      expect(renamed.name).toBe('Alpha-2');
      expect(renamed.updatedAt).toBeGreaterThan(a.updatedAt);
      expect(renamed.createdAt).toBe(a.createdAt);
      expect((await store.read(a.id)).name).toBe('Alpha-2');

      await store.remove(a.id);
      expect((await store.list()).map((c) => c.id)).toEqual([b.id]);
      await expect(store.read(a.id)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
}

roundTripSuite('socmint');
roundTripSuite('x');

describe('scraping-case store namespace isolation', () => {
  it('socmint and x share deps but never see each other’s cases', async () => {
    const { deps, files } = makeMockDeps();
    const socmint = makeScrapingCaseStore('socmint', deps);
    const x = makeScrapingCaseStore('x', deps);

    const s = await socmint.create('socmint-only');
    const xc = await x.create('x-only');

    expect((await socmint.list()).map((c) => c.name)).toEqual(['socmint-only']);
    expect((await x.list()).map((c) => c.name)).toEqual(['x-only']);

    // Distinct on-disk paths keyed by namespace.
    expect(files.has(`/root/socmint/${s.id}/case.json`)).toBe(true);
    expect(files.has(`/root/x/${xc.id}/case.json`)).toBe(true);

    // Removing from one namespace leaves the other intact.
    await socmint.remove(s.id);
    expect(await socmint.list()).toEqual([]);
    expect((await x.list()).map((c) => c.name)).toEqual(['x-only']);
  });
});
