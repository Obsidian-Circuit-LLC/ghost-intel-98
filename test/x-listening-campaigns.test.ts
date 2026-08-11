/**
 * X Listening Station Enterprise port — Task 5: campaigns as self-managed x-namespace
 * scraping cases (removes the core-case requirement).
 *
 * Enterprise's `campaigns:create/switch/update/delete` (`main.cjs:2729-2810`, `appState.cases`)
 * map here onto the generic `ScrapingCaseStore('x')` (`storage/scraping-cases.ts`) — a campaign
 * IS an x-namespace scraping-case id (`scrapingCaseDir('x', id)`), the SAME id every other
 * x-listening module (store.ts Task 1, session.ts Task 3, capture.ts Task 4) already scopes its
 * per-campaign artifacts by. `campaigns.ts` adds no new persistence: it is a thin domain-named
 * wrapper that validates/trims input and delegates to the injected store, defaulting to
 * `prodScrapingCaseStore('x')` in production.
 *
 * This file proves three things the design calls out explicitly:
 *  1. create/switch/delete all work with NO core investigation `caseId` ever touched — the
 *     module owns its own campaign list.
 *  2. artifacts (via the Task-1 `XStore`) are scoped per campaign — writing to campaign A never
 *     leaks into campaign B's sidecars, because both are namespaced by the SAME caseId this
 *     module hands out.
 *  3. deleting a campaign removes its entire on-disk directory recursively — which already
 *     covers a future per-campaign media dir (Task 9) since everything this module ever
 *     persists for a campaign lives under `scrapingCaseDir('x', id)`.
 */
import { describe, it, expect } from 'vitest';

import { makeScrapingCaseStore } from '../src/main/storage/scraping-cases';
import type { ScrapingCaseStoreDeps } from '../src/main/storage/scraping-cases';
import { makeXStore } from '../src/main/x-listening/store';
import type { XStoreDeps } from '../src/main/x-listening/store';
import {
  listCampaigns,
  createCampaign,
  switchCampaign,
  updateCampaign,
  deleteCampaign,
} from '../src/main/x-listening/campaigns';

// ---- in-memory fs seam (mirrors scraping-case-store.test.ts's makeMockDeps) -------------

function makeMockDeps(): { deps: ScrapingCaseStoreDeps; files: Map<string, Buffer> } {
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

/** In-memory XStoreDeps sharing the SAME `files` map + the SAME `scrapingCaseDir('x', id)`
 *  layout as the campaign store above, so a "no leakage across campaigns" test is real. */
function xStoreDeps(files: Map<string, Buffer>): XStoreDeps {
  const enoent = (): NodeJS.ErrnoException => {
    const e = new Error('ENOENT') as NodeJS.ErrnoException;
    e.code = 'ENOENT';
    return e;
  };
  const read = async (p: string) => {
    const b = files.get(p);
    if (!b) throw enoent();
    return b;
  };
  const write = async (p: string, d: string) => {
    files.set(p, Buffer.from(d, 'utf8'));
  };
  const artifact = (id: string, name: string) => `/root/x/${id}/${name}`;
  return {
    readFile: read,
    writeFile: write,
    itemsPath: (id) => artifact(id, 'x-items.json'),
    notesPath: (id) => artifact(id, 'x-notes.json'),
    networksPath: (id) => artifact(id, 'x-networks.json'),
    archiveStatePath: (id) => artifact(id, 'x-archive-state.json'),
    postsPath: (id) => artifact(id, 'x-posts.json'),
    presetsPath: (id) => artifact(id, 'x-presets.json'),
    entitiesCachePath: (id) => artifact(id, 'x-entities-cache.json'),
  };
}

describe('x-listening campaigns (Task 5)', () => {
  it('creates/lists/switches/deletes a campaign with NO core caseId ever touched', async () => {
    const { deps } = makeMockDeps();
    const store = makeScrapingCaseStore('x', deps);

    expect(await listCampaigns(store)).toEqual([]);

    const a = await createCampaign('Operation Alpha', store);
    const b = await createCampaign('Operation Beta', store);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe('Operation Alpha');

    const listed = await listCampaigns(store);
    expect(listed.map((c) => c.name)).toEqual(['Operation Alpha', 'Operation Beta']);

    // switchCampaign validates existence and hands back the record — no persisted "active
    // campaign" pointer here (that lives renderer-side, Task 13); a bad id rejects.
    const switched = await switchCampaign(a.id, store);
    expect(switched).toEqual(a);
    await expect(switchCampaign('not-a-real-id', store)).rejects.toMatchObject({ code: 'ENOENT' });

    const updated = await updateCampaign(a.id, 'Operation Alpha-2', store);
    expect(updated.name).toBe('Operation Alpha-2');
    expect(updated.updatedAt).toBeGreaterThan(a.updatedAt);

    await deleteCampaign(a.id, store);
    expect((await listCampaigns(store)).map((c) => c.id)).toEqual([b.id]);
    await expect(switchCampaign(a.id, store)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an empty/whitespace-only campaign name on create and on rename', async () => {
    const { deps } = makeMockDeps();
    const store = makeScrapingCaseStore('x', deps);

    await expect(createCampaign('', store)).rejects.toThrow(/name is required/i);
    await expect(createCampaign('   ', store)).rejects.toThrow(/name is required/i);

    const c = await createCampaign('Real Name', store);
    await expect(updateCampaign(c.id, '  ', store)).rejects.toThrow(/name is required/i);
  });

  it('scopes artifacts per campaign — writing to campaign A never leaks into campaign B', async () => {
    const { deps, files } = makeMockDeps();
    const caseStore = makeScrapingCaseStore('x', deps);
    const xStore = makeXStore(xStoreDeps(files));

    const a = await createCampaign('Campaign A', caseStore);
    const b = await createCampaign('Campaign B', caseStore);

    await xStore.notes.save(a.id, 'finding-1', 'note on A', '2026-08-11T00:00:00.000Z');
    await xStore.saveItems(a.id, [
      {
        id: 'item-1',
        platform: 'x',
        authorHandle: '@target',
        authorId: 'u1',
        text: 'hello from campaign A',
        channelId: 'target',
        channelLabel: 'Target',
        messageId: '1',
        publishedAt: '2026-08-11T00:00:00.000Z',
        harvestedAt: '2026-08-11T00:00:01.000Z',
        url: 'https://x.com/target/status/1',
        provenance: { collectorVersion: '1.0.0', jobId: 'job-1', caseId: a.id },
      },
    ]);

    expect(await xStore.notes.read(a.id)).toHaveLength(1);
    expect(await xStore.readItems(a.id)).toHaveLength(1);

    // Campaign B (no core caseId bound to either — both are self-managed x-namespace ids)
    // sees nothing of A's artifacts.
    expect(await xStore.notes.read(b.id)).toEqual([]);
    expect(await xStore.readItems(b.id)).toEqual([]);
  });

  it('deleting a campaign removes its entire directory — including a future media subdir', async () => {
    const { deps, files } = makeMockDeps();
    const store = makeScrapingCaseStore('x', deps);

    const a = await createCampaign('Has Media', store);
    // Simulate a Task-9 media file living under the SAME campaign directory.
    files.set(`/root/x/${a.id}/media/avatar-abc123.bin`, Buffer.from('bytes'));
    expect(files.has(`/root/x/${a.id}/media/avatar-abc123.bin`)).toBe(true);

    await deleteCampaign(a.id, store);

    expect(files.has(`/root/x/${a.id}/media/avatar-abc123.bin`)).toBe(false);
    expect(files.has(`/root/x/${a.id}/case.json`)).toBe(false);
  });
});
