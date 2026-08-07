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
  type XArchiveState,
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

  it('archiveState round-trips and is null before first write', async () => {
    expect(await xStore.archiveState.read('case-a')).toBeNull();
    const st: XArchiveState = { cursor: 'c1', cycles: 2, lastRunAt: '2026-08-06T00:00:00.000Z' };
    await xStore.archiveState.write('case-a', st);
    expect(await xStore.archiveState.read('case-a')).toEqual(st);
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
