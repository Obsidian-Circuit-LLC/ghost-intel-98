/**
 * F3 — X Listening Station encrypt-at-rest data layer.
 *
 * Three concerns, one file:
 *  1. The pure factory (makeXStore) round-trips captured HarvestedItems and the three
 *     per-artifact stores (notes / networks / archiveState) through an injected in-memory
 *     fs seam — no electron / vault needed.
 *  2. The production-wired store (prodXStore) routes through the real secure-fs choke-point,
 *     so the on-disk item file is CIPHERTEXT: the raw bytes must not contain a known plaintext
 *     field value. (Fake reversible vault + mocked electron userData, mirroring
 *     documents-store-encryption.test.ts.)
 *  3. mergeSettings heals the xListening block from a stale/absent on-disk settings file
 *     (upgrade guard, v3.24.0 dataloss class).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  makeXStore,
  type XStoreDeps,
  type XNote,
  type XNetworkArtifact,
  type XNetworkAccount,
  type XArchiveState,
  type XPostArtifact,
  type XPreset,
  type XEntityCacheEntry,
} from '../src/main/x-listening/store';
import type { HarvestedItem } from '../src/shared/socmint/types';

const DATA = join(tmpdir(), 'dcs98-x-listening-store-test');
const MAGIC = Buffer.from('ENCX');

vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

// Reversible fake vault: encrypt = MAGIC prefix + byte-inverted body; enabled + unlocked.
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff)),
  };
});

// ---- in-memory fs seam for the pure factory ----------------------------

function memDeps(): XStoreDeps {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  return {
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => { store.set(p, d); },
    itemsPath: (caseId) => `x/${caseId}/x-items.json`,
    notesPath: (caseId) => `x/${caseId}/x-notes.json`,
    networksPath: (caseId) => `x/${caseId}/x-networks.json`,
    archiveStatePath: (caseId) => `x/${caseId}/x-archive-state.json`,
    postsPath: (caseId) => `x/${caseId}/x-posts.json`,
    presetsPath: (caseId) => `x/${caseId}/x-presets.json`,
    entitiesCachePath: (caseId) => `x/${caseId}/x-entities-cache.json`,
  };
}

// ---- fixtures ----------------------------------------------------------

const SECRET_TEXT = 'operator-only-visible-capture-body';

const mkItem = (messageId: string, overrides: Partial<HarvestedItem> = {}): HarvestedItem => ({
  id: `sha256-${messageId}`,
  platform: 'x',
  authorHandle: '@target',
  authorId: 'u1',
  text: `${SECRET_TEXT} ${messageId}`,
  channelId: 'target',
  channelLabel: 'Target',
  messageId,
  publishedAt: '2026-08-06T10:00:00.000Z',
  harvestedAt: '2026-08-06T10:00:01.000Z',
  url: 'https://x.com/target/status/1',
  provenance: { collectorVersion: '1.0.0', jobId: 'job-1', caseId: 'case-a' },
  ...overrides,
});

const mkPost = (messageId: string, overrides: Partial<XPostArtifact> = {}): XPostArtifact => ({
  ...mkItem(messageId),
  kind: 'post',
  parentPostId: null,
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
  metricsRaw: {},
  evidenceHash: `evhash-${messageId}`,
  ...overrides,
});

const mkPreset = (id: string, overrides: Partial<XPreset> = {}): XPreset => ({
  id,
  name: `Preset ${id}`,
  keywords: ['keyword'],
  mode: 'any',
  caseSensitive: false,
  profileIds: [],
  enabled: true,
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
});

const mkEntity = (id: string, overrides: Partial<XEntityCacheEntry> = {}): XEntityCacheEntry => ({
  id,
  type: 'hashtag',
  value: '#opsec',
  normalizedValue: 'opsec',
  postIds: ['sha256-1'],
  sourceUsernames: ['@target'],
  firstObservedAt: '2026-08-11T00:00:00.000Z',
  lastObservedAt: '2026-08-11T00:00:00.000Z',
  count: 1,
  ...overrides,
});

// ---- 1. pure factory round-trips ---------------------------------------

describe('makeXStore: captured items', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('round-trips items through saveItems/readItems in append order', async () => {
    await xStore.saveItems('case-a', [mkItem('1'), mkItem('2')]);
    const items = await xStore.readItems('case-a');
    expect(items.map((i) => i.id)).toEqual(['sha256-1', 'sha256-2']);
  });

  it('dedups by id (idempotent re-save)', async () => {
    await xStore.saveItems('case-a', [mkItem('1'), mkItem('2')]);
    const second = await xStore.saveItems('case-a', [mkItem('1'), mkItem('2')]);
    expect(second).toEqual({ added: 0, skipped: 2 });
    expect(await xStore.readItems('case-a')).toHaveLength(2);
  });

  it('is case-scoped', async () => {
    await xStore.saveItems('case-a', [mkItem('1')]);
    await xStore.saveItems('case-b', [mkItem('1'), mkItem('2')]);
    expect(await xStore.readItems('case-a')).toHaveLength(1);
    expect(await xStore.readItems('case-b')).toHaveLength(2);
  });

  it('readItems is empty for an unknown case', async () => {
    expect(await xStore.readItems('nope')).toEqual([]);
  });
});

describe('makeXStore: artifact stores', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('notes round-trip and are case-scoped', async () => {
    const notes: XNote[] = [{ findingId: 'f1', text: 'analyst note', savedAt: '2026-08-06T00:00:00.000Z' }];
    await xStore.notes.write('case-a', notes);
    expect(await xStore.notes.read('case-a')).toEqual(notes);
    expect(await xStore.notes.read('case-b')).toEqual([]);
  });

  it('networks round-trip (visible accounts, no fabricated count)', async () => {
    const nets: XNetworkArtifact[] = [
      { target: '@target', kind: 'followers', capturedAt: '2026-08-06T00:00:00.000Z',
        accounts: [{ handle: '@a', displayName: 'A' }, { handle: '@b', displayName: 'B' }] },
    ];
    await xStore.networks.write('case-a', nets);
    expect(await xStore.networks.read('case-a')).toEqual(nets);
    expect(await xStore.networks.read('case-b')).toEqual([]);
  });

  // ---- Task 7: networks.save accumulator (conservative, no auto-unfollow) -----------

  const acct = (
    handle: string,
    firstObservedAt: string,
    lastObservedAt: string,
    overrides: Partial<XNetworkAccount> = {},
  ): XNetworkAccount => ({ handle, firstObservedAt, lastObservedAt, evidenceHash: `ev-${handle}`, ...overrides });

  it('save() stores every account of a first-ever capture as-is (first == last observed)', async () => {
    const t = '2026-08-11T00:00:00.000Z';
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t,
      accounts: [acct('@alice', t, t), acct('@bob', t, t)],
    });
    const [art] = await xStore.networks.read('case-a');
    expect(art.accounts.map((a) => a.handle)).toEqual(['@alice', '@bob']);
    expect(art.accounts.every((a) => a.firstObservedAt === t && a.lastObservedAt === t)).toBe(true);
  });

  it('a re-scan that re-observes an account updates lastObservedAt but PRESERVES firstObservedAt', async () => {
    const t1 = '2026-08-11T00:00:00.000Z';
    const t2 = '2026-08-12T00:00:00.000Z';
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t1,
      accounts: [acct('@alice', t1, t1, { bio: 'old bio', evidenceHash: 'ev-1' })],
    });
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t2,
      accounts: [acct('@alice', t2, t2, { bio: 'new bio', evidenceHash: 'ev-2' })],
    });
    const [art] = await xStore.networks.read('case-a');
    const alice = art.accounts.find((a) => a.handle === '@alice')!;
    expect(alice.firstObservedAt).toBe(t1); // original first-seen preserved
    expect(alice.lastObservedAt).toBe(t2); // last-seen advances
    expect(alice.bio).toBe('new bio'); // freshest visible fields win
    expect(alice.evidenceHash).toBe('ev-2');
  });

  it('CONSERVATIVE: an account absent from a later scan is carried over UNCHANGED — never dropped, never relabelled', async () => {
    const t1 = '2026-08-11T00:00:00.000Z';
    const t2 = '2026-08-12T00:00:00.000Z';
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t1,
      accounts: [acct('@alice', t1, t1), acct('@bob', t1, t1)],
    });
    // Second scan only re-observes @alice — @bob's DOM row didn't render this pass.
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t2,
      accounts: [acct('@alice', t2, t2)],
    });
    const [art] = await xStore.networks.read('case-a');
    expect(art.accounts.map((a) => a.handle).sort()).toEqual(['@alice', '@bob']);
    const bob = art.accounts.find((a) => a.handle === '@bob')!;
    // @bob's record is IDENTICAL to the first scan — not dropped, not stamped "unfollowed"/
    // "removed", lastObservedAt not silently bumped as if it had been re-seen.
    expect(bob.firstObservedAt).toBe(t1);
    expect(bob.lastObservedAt).toBe(t1);
    expect('unfollowed' in bob).toBe(false);
    expect('removed' in bob).toBe(false);
    expect('status' in bob).toBe(false);
  });

  it('dedups the persisted list by (target, kind, handle) case-insensitively across scans', async () => {
    const t1 = '2026-08-11T00:00:00.000Z';
    const t2 = '2026-08-12T00:00:00.000Z';
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t1,
      accounts: [acct('@Alice', t1, t1)],
    });
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t2,
      accounts: [acct('@alice', t2, t2)], // same person, different case
    });
    const [art] = await xStore.networks.read('case-a');
    expect(art.accounts).toHaveLength(1);
  });

  it('followers and following are independent accumulators for the same target', async () => {
    const t = '2026-08-11T00:00:00.000Z';
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'followers', capturedAt: t, accounts: [acct('@alice', t, t)],
    });
    await xStore.networks.save('case-a', {
      target: '@target', kind: 'following', capturedAt: t, accounts: [acct('@carol', t, t)],
    });
    const nets = await xStore.networks.read('case-a');
    expect(nets).toHaveLength(2);
    expect(nets.find((n) => n.kind === 'followers')!.accounts.map((a) => a.handle)).toEqual(['@alice']);
    expect(nets.find((n) => n.kind === 'following')!.accounts.map((a) => a.handle)).toEqual(['@carol']);
  });

  it('archiveState round-trips and is null before first write', async () => {
    expect(await xStore.archiveState.read('case-a')).toBeNull();
    const st: XArchiveState = { cursor: 'c1', cycles: 2, lastRunAt: '2026-08-06T00:00:00.000Z' };
    await xStore.archiveState.write('case-a', st);
    expect(await xStore.archiveState.read('case-a')).toEqual(st);
  });
});

describe('makeXStore: posts artifact (HarvestedItem-superset sidecar)', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('round-trips post artifacts through save/read in append order, case-scoped', async () => {
    await xStore.posts.save('case-a', [mkPost('1'), mkPost('2')]);
    await xStore.posts.save('case-b', [mkPost('9')]);
    const a = await xStore.posts.read('case-a');
    expect(a.map((p) => p.id)).toEqual(['sha256-1', 'sha256-2']);
    expect(await xStore.posts.read('case-b')).toHaveLength(1);
  });

  it('preserves the richer fields (metrics, metricsRaw, kind, parentPostId, evidenceHash)', async () => {
    const reply = mkPost('2', {
      kind: 'reply',
      parentPostId: 'sha256-1',
      metrics: { replies: 1, reposts: 4, likes: 12, views: 900 },
      metricsRaw: { replies: '1', reposts: '4', likes: '12', views: '900' },
      evidenceHash: 'evhash-2',
    });
    await xStore.posts.save('case-a', [reply]);
    const [back] = await xStore.posts.read('case-a');
    expect(back.kind).toBe('reply');
    expect(back.parentPostId).toBe('sha256-1');
    expect(back.metrics).toEqual({ replies: 1, reposts: 4, likes: 12, views: 900 });
    expect(back.metricsRaw).toEqual({ replies: '1', reposts: '4', likes: '12', views: '900' });
    expect(back.evidenceHash).toBe('evhash-2');
  });

  it('dedups posts by id (idempotent re-save)', async () => {
    await xStore.posts.save('case-a', [mkPost('1'), mkPost('2')]);
    const second = await xStore.posts.save('case-a', [mkPost('1'), mkPost('2')]);
    expect(second).toEqual({ added: 0, skipped: 2 });
    expect(await xStore.posts.read('case-a')).toHaveLength(2);
  });

  it('write() replaces the full list wholesale (for callers that already merged)', async () => {
    await xStore.posts.save('case-a', [mkPost('1')]);
    await xStore.posts.write('case-a', [mkPost('1'), mkPost('2'), mkPost('3')]);
    expect(await xStore.posts.read('case-a')).toHaveLength(3);
  });

  it('read() is empty for an unknown case', async () => {
    expect(await xStore.posts.read('nope')).toEqual([]);
  });
});

describe('makeXStore: presets artifact', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('round-trips presets and is case-scoped', async () => {
    const presets: XPreset[] = [mkPreset('p1')];
    await xStore.presets.write('case-a', presets);
    expect(await xStore.presets.read('case-a')).toEqual(presets);
    expect(await xStore.presets.read('case-b')).toEqual([]);
  });

  it('save() upserts one preset keyed by id — re-save replaces rather than duplicates', async () => {
    await xStore.presets.save('case-a', mkPreset('p1', { name: 'First' }));
    const after = await xStore.presets.save('case-a', mkPreset('p1', { name: 'Renamed' }));
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Renamed');
  });

  it('save() appends a distinct id alongside an existing preset', async () => {
    await xStore.presets.save('case-a', mkPreset('p1'));
    const after = await xStore.presets.save('case-a', mkPreset('p2'));
    expect(after.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('makeXStore: entitiesCache artifact', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('round-trips the entity rollup cache and is case-scoped', async () => {
    const entities: XEntityCacheEntry[] = [mkEntity('e1')];
    await xStore.entitiesCache.write('case-a', entities);
    expect(await xStore.entitiesCache.read('case-a')).toEqual(entities);
    expect(await xStore.entitiesCache.read('case-b')).toEqual([]);
  });
});

describe('store.ts encrypt-at-rest structural invariant', () => {
  it('never imports node:fs directly — every IO path goes through the injected/secure-fs deps', async () => {
    const src = await readFile(join(process.cwd(), 'src/main/x-listening/store.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]node:fs/);
    expect(src).not.toMatch(/require\(\s*['"]fs['"]\s*\)/);
  });
});

// ---- 2. production wiring: ciphertext at rest --------------------------

describe('prodXStore: encrypt-at-rest', () => {
  beforeEach(async () => {
    await mkdir(DATA, { recursive: true });
    const { __resetProdXStore } = await import('../src/main/x-listening/store');
    __resetProdXStore();
  });
  afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

  it('writes ciphertext to disk (raw bytes lack the plaintext body) but reads back plaintext', async () => {
    const { prodXStore } = await import('../src/main/x-listening/store');
    const { scrapingCaseItemsFile } = await import('../src/main/storage/paths');

    const s = await prodXStore();
    await s.saveItems('case-enc', [mkItem('1')]);

    const path = scrapingCaseItemsFile('x', 'case-enc');
    const onDisk = await readFile(path);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');            // encrypted envelope
    expect(onDisk.includes(Buffer.from(SECRET_TEXT))).toBe(false);    // plaintext body absent

    const back = await s.readItems('case-enc');
    expect(back[0].text).toContain(SECRET_TEXT);                      // decrypts in-app
  });

  it('persists items under scraping-cases/x, never the main case dir', async () => {
    const { prodXStore } = await import('../src/main/x-listening/store');
    const { scrapingCaseDir, caseDir } = await import('../src/main/storage/paths');

    const s = await prodXStore();
    await s.saveItems('case-loc', [mkItem('1')]);

    const path = scrapingCaseDir('x', 'case-loc');
    await expect(readFile(join(path, 'x-items.json'))).resolves.toBeInstanceOf(Buffer);
    // sanity: not written under the investigation case tree
    await expect(readFile(join(caseDir('case-loc'), 'x-items.json'))).rejects.toThrow();
  });

  it('writes the posts sidecar as ciphertext (raw bytes lack the plaintext body) but reads back plaintext', async () => {
    const { prodXStore } = await import('../src/main/x-listening/store');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');

    const s = await prodXStore();
    await s.posts.save('case-enc', [mkPost('1')]);

    const path = join(scrapingCaseDir('x', 'case-enc'), 'x-posts.json');
    const onDisk = await readFile(path);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');
    expect(onDisk.includes(Buffer.from(SECRET_TEXT))).toBe(false);

    const back = await s.posts.read('case-enc');
    expect(back[0].text).toContain(SECRET_TEXT);
    expect(back[0].evidenceHash).toBe('evhash-1');
  });

  it('writes the presets and entitiesCache sidecars as ciphertext', async () => {
    const { prodXStore } = await import('../src/main/x-listening/store');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');

    const s = await prodXStore();
    await s.presets.save('case-enc', mkPreset('p1', { keywords: [SECRET_TEXT] }));
    await s.entitiesCache.write('case-enc', [mkEntity('e1', { value: SECRET_TEXT })]);

    const dir = scrapingCaseDir('x', 'case-enc');
    const presetsOnDisk = await readFile(join(dir, 'x-presets.json'));
    const entitiesOnDisk = await readFile(join(dir, 'x-entities-cache.json'));
    for (const onDisk of [presetsOnDisk, entitiesOnDisk]) {
      expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');
      expect(onDisk.includes(Buffer.from(SECRET_TEXT))).toBe(false);
    }

    expect((await s.presets.read('case-enc'))[0].keywords).toContain(SECRET_TEXT);
    expect((await s.entitiesCache.read('case-enc'))[0].value).toBe(SECRET_TEXT);
  });
});

// ---- 3. settings upgrade guard -----------------------------------------

describe('mergeSettings: xListening block heals from a stale on-disk file', () => {
  it('an absent xListening yields the full default block (all toggles false)', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');

    const merged = mergeSettings(defaultSettings, {} as never);
    expect(merged.xListening).toEqual(defaultSettings.xListening);
    expect(merged.xListening).toEqual({
      collect: { replies: false, reposts: false, comments: false },
      archiveCycles: false,
      clearnet: false,
      clearnetAck: false,
    });
  });

  it('a partial collect block heals its missing sub-fields while keeping the user value', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');

    const merged = mergeSettings(defaultSettings, {
      xListening: { collect: { replies: true } },
    } as never);
    expect(merged.xListening.collect.replies).toBe(true);   // user opt-in survives
    expect(merged.xListening.collect.reposts).toBe(false);  // missing sub-field healed
    expect(merged.xListening.collect.comments).toBe(false); // missing sub-field healed
    expect(merged.xListening.archiveCycles).toBe(false);    // missing sibling healed
  });
});
