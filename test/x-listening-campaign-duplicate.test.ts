/**
 * Task J1 — Campaign DUPLICATE SETUP + per-campaign editor meta (purpose/description).
 *
 * Enterprise's `campaigns:duplicate` (`electron/main.cjs:2774`) cloned the campaign's PROFILES and
 * PRESETS with fresh ids and RESET the collected counts — "a fresh investigation with the same
 * setup". GI98 has NO first-class profile record (sources are DERIVED from captured posts), so the
 * per-campaign SETUP that survives a count-reset is: the highlight PRESETS (with new ids), the F2
 * COLLECTION SETTINGS, the F1 per-source IMAGE POLICY map, and the editor META (purpose/description).
 * None of the CAPTURED data (posts / networks / notes / entities / snapshots / run-log / archive) is
 * copied — that IS the count reset.
 *
 * These tests drive `duplicateCampaign` / `getCampaignMeta` / `setCampaignMeta` through FULLY
 * injected in-memory deps — no electron, no secure-fs — proving the clone semantics and the
 * editor field round-trip deterministically.
 */
import { describe, it, expect } from 'vitest';

import { duplicateCampaign } from '../src/main/x-listening/campaigns';
import type { XCampaignDuplicateDeps } from '../src/main/x-listening/campaigns';
import { getCampaignMeta, setCampaignMeta, DEFAULT_CAMPAIGN_META } from '../src/main/x-listening/campaign-meta';
import type { XCampaignMeta, XCampaignMetaDeps } from '../src/main/x-listening/campaign-meta';
import type { XPreset } from '../src/main/x-listening/store';
import type { XImagePolicyMap } from '../src/main/x-listening/image-policy';
import { DEFAULT_COLLECTION_SETTINGS, type XCollectionSettings } from '@shared/x-listening-collection-settings';
import type { ScrapingCase } from '@shared/types';

// ---- in-memory duplicate harness -----------------------------------------------------------

function makeDuplicateHarness() {
  const campaigns = new Map<string, ScrapingCase>();
  const presets = new Map<string, XPreset[]>();
  const policies = new Map<string, XImagePolicyMap>();
  const settings = new Map<string, XCollectionSettings>();
  const metas = new Map<string, XCampaignMeta>();
  // Captured data the duplicate must NEVER copy (structurally absent from the deps interface, but
  // seeded here so the "counts reset" assertion is concrete rather than vacuous).
  const posts = new Map<string, unknown[]>();
  const networks = new Map<string, unknown[]>();

  let campaignSeq = 0;
  let idSeq = 0;
  const enoent = (): NodeJS.ErrnoException => {
    const e = new Error('ENOENT') as NodeJS.ErrnoException;
    e.code = 'ENOENT';
    return e;
  };

  const deps: XCampaignDuplicateDeps = {
    async read(id) {
      const c = campaigns.get(id);
      if (!c) throw enoent();
      return c;
    },
    async create(name) {
      const id = `camp-${++campaignSeq}`;
      const rec: ScrapingCase = { id, name, createdAt: 100 + campaignSeq, updatedAt: 100 + campaignSeq };
      campaigns.set(id, rec);
      return rec;
    },
    async readPresets(id) {
      return presets.get(id) ?? [];
    },
    async writePresets(id, list) {
      presets.set(id, list);
    },
    async readImagePolicy(id) {
      return policies.get(id) ?? {};
    },
    async writeImagePolicy(id, map) {
      policies.set(id, map);
    },
    async readCollectionSettings(id) {
      return settings.get(id) ?? { ...DEFAULT_COLLECTION_SETTINGS };
    },
    async writeCollectionSettings(id, s) {
      settings.set(id, s);
    },
    async readMeta(id) {
      return metas.get(id) ?? { ...DEFAULT_CAMPAIGN_META };
    },
    async writeMeta(id, meta) {
      metas.set(id, meta);
    },
    newId: () => `new-${++idSeq}`,
    now: () => '2026-08-13T00:00:00.000Z',
  };

  return { deps, campaigns, presets, policies, settings, metas, posts, networks };
}

function preset(id: string, over: Partial<XPreset> = {}): XPreset {
  return {
    id,
    name: `Preset ${id}`,
    keywords: ['osint', 'leak'],
    mode: 'any',
    caseSensitive: false,
    profileIds: ['alice', 'bob'],
    enabled: true,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('duplicateCampaign (Task J1) — clones profiles+presets with new ids, resets counts', () => {
  it('creates a "<name> Copy" campaign and clones presets with NEW ids (profileIds preserved)', async () => {
    const h = makeDuplicateHarness();
    const src: ScrapingCase = { id: 'src', name: 'Operation Alpha', createdAt: 1, updatedAt: 1 };
    h.campaigns.set('src', src);
    h.presets.set('src', [preset('p1'), preset('p2', { keywords: ['x'] })]);

    const copy = await duplicateCampaign('src', h.deps);

    expect(copy.id).not.toBe('src');
    expect(copy.name).toBe('Operation Alpha Copy');

    const cloned = h.presets.get(copy.id)!;
    expect(cloned).toHaveLength(2);
    // fresh ids
    expect(cloned.map((p) => p.id)).toEqual(['new-1', 'new-2']);
    expect(cloned.some((p) => p.id === 'p1' || p.id === 'p2')).toBe(false);
    // content (incl. profileIds — GI98 profileIds are source-key strings, meaningful once re-captured)
    expect(cloned[0].name).toBe('Preset p1');
    expect(cloned[0].keywords).toEqual(['osint', 'leak']);
    expect(cloned[0].profileIds).toEqual(['alice', 'bob']);
    expect(cloned[0].updatedAt).toBe('2026-08-13T00:00:00.000Z');
    // source presets untouched (no id mutation on the original)
    expect(h.presets.get('src')!.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('clones the F1 image policy, F2 collection settings, and editor meta verbatim', async () => {
    const h = makeDuplicateHarness();
    h.campaigns.set('src', { id: 'src', name: 'Alpha', createdAt: 1, updatedAt: 1 });
    h.policies.set('src', { alice: 'off', bob: 'on' });
    const tunedSettings: XCollectionSettings = { ...DEFAULT_COLLECTION_SETTINGS, retrieveImages: false, scrollPasses: 7 };
    h.settings.set('src', tunedSettings);
    h.metas.set('src', { purpose: 'Track the leak', description: 'Full context here' });

    const copy = await duplicateCampaign('src', h.deps);

    expect(h.policies.get(copy.id)).toEqual({ alice: 'off', bob: 'on' });
    expect(h.settings.get(copy.id)).toEqual(tunedSettings);
    expect(h.metas.get(copy.id)).toEqual({ purpose: 'Track the leak', description: 'Full context here' });
  });

  it('RESETS collected counts — copies NO captured posts/networks (setup only)', async () => {
    const h = makeDuplicateHarness();
    h.campaigns.set('src', { id: 'src', name: 'Alpha', createdAt: 1, updatedAt: 1 });
    h.presets.set('src', [preset('p1')]);
    // Source has a body of captured evidence…
    h.posts.set('src', [{ id: 'post-1' }, { id: 'post-2' }]);
    h.networks.set('src', [{ target: '@alice' }]);

    const copy = await duplicateCampaign('src', h.deps);

    // …none of which is carried into the fresh investigation.
    expect(h.posts.get(copy.id)).toBeUndefined();
    expect(h.networks.get(copy.id)).toBeUndefined();
  });

  it('a campaign with no presets/policy still duplicates (empty setup, no crash)', async () => {
    const h = makeDuplicateHarness();
    h.campaigns.set('src', { id: 'src', name: 'Bare', createdAt: 1, updatedAt: 1 });

    const copy = await duplicateCampaign('src', h.deps);

    expect(copy.name).toBe('Bare Copy');
    expect(h.presets.get(copy.id) ?? []).toEqual([]);
    expect(h.metas.get(copy.id)).toEqual(DEFAULT_CAMPAIGN_META);
  });

  it('rejects duplicating an unknown campaign (ENOENT from the store read)', async () => {
    const h = makeDuplicateHarness();
    await expect(duplicateCampaign('nope', h.deps)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// ---- campaign-meta round-trip -------------------------------------------------------------

function makeMetaHarness() {
  const files = new Map<string, Record<string, unknown>>();
  const deps: XCampaignMetaDeps = {
    async read(id) {
      return files.get(id) ?? null;
    },
    async write(id, meta) {
      files.set(id, meta as unknown as Record<string, unknown>);
    },
  };
  return { deps, files };
}

describe('campaign editor meta (Task J1) — purpose/description round-trip', () => {
  it('setCampaignMeta then getCampaignMeta returns the same purpose + description', async () => {
    const { deps } = makeMetaHarness();
    const stored = await setCampaignMeta('c1', { purpose: 'Monitor X', description: 'Why + scope' }, deps);
    expect(stored).toEqual({ purpose: 'Monitor X', description: 'Why + scope' });
    expect(await getCampaignMeta('c1', deps)).toEqual({ purpose: 'Monitor X', description: 'Why + scope' });
  });

  it('an unset campaign reads back the empty default (never throws)', async () => {
    const { deps } = makeMetaHarness();
    expect(await getCampaignMeta('unset', deps)).toEqual(DEFAULT_CAMPAIGN_META);
  });

  it('heals non-string fields to empty strings and caps field length', async () => {
    const { deps } = makeMetaHarness();
    const stored = await setCampaignMeta(
      'c2',
      { purpose: 42 as unknown as string, description: 'x'.repeat(5000) },
      deps,
    );
    expect(stored.purpose).toBe('');
    expect(stored.description.length).toBe(2000);
  });

  it('is scoped per campaign — writing c1 never bleeds into c2', async () => {
    const { deps } = makeMetaHarness();
    await setCampaignMeta('c1', { purpose: 'A', description: 'a' }, deps);
    await setCampaignMeta('c2', { purpose: 'B', description: 'b' }, deps);
    expect(await getCampaignMeta('c1', deps)).toEqual({ purpose: 'A', description: 'a' });
    expect(await getCampaignMeta('c2', deps)).toEqual({ purpose: 'B', description: 'b' });
  });

  it('a read error degrades to the empty default (fail-safe, never crashes an editor load)', async () => {
    const deps: XCampaignMetaDeps = {
      async read() {
        throw new Error('decrypt failed');
      },
      async write() {
        /* noop */
      },
    };
    expect(await getCampaignMeta('boom', deps)).toEqual(DEFAULT_CAMPAIGN_META);
  });
});
