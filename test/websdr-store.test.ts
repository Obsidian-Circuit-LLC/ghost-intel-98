/**
 * WebSDR Viewer — Phase 1 seam tests.
 *
 *  1. normalizeWebSdrUrl: accepts http/https, rejects every other scheme + unparseable/
 *     path-injection input at the trust boundary.
 *  2. makeWebSdrStore (pure factory over an in-memory fs seam): directory/presets/notes/menu/
 *     egress/recordings round-trip; the directory seed is idempotent and seeds exactly once.
 *  3. prodWebSdrStore: routes through the real secure-fs choke-point, so the on-disk sidecar is
 *     CIPHERTEXT (ENCX envelope, plaintext body absent) yet reads back plaintext — mirrors
 *     x-listening-store.test.ts's encrypt-at-rest invariant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { normalizeWebSdrUrl } from '../src/shared/websdr/normalize-url';
import {
  makeWebSdrStore,
  KIWI_SEED_VERSION,
  type WebSdrStoreDeps,
} from '../src/main/websdr/store';
import type { WebSdrReceiver } from '../src/shared/websdr/types';

const DATA = join(tmpdir(), 'dcs98-websdr-store-test');
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

function memDeps(seedReceivers: readonly WebSdrReceiver[] = []): WebSdrStoreDeps & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  return {
    store,
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => {
      store.set(p, d);
    },
    directoryPath: () => 'websdr/directory.json',
    presetsPath: () => 'websdr/presets.json',
    notesPath: () => 'websdr/notes.json',
    menuPath: () => 'websdr/menu.json',
    egressPath: () => 'websdr/egress.json',
    recordingsPath: () => 'websdr/recordings.json',
    seedReceivers,
  };
}

const RX = (over: Partial<WebSdrReceiver> = {}): WebSdrReceiver => ({
  id: 'kiwi-public-0001',
  name: 'Test Receiver',
  url: 'http://example.org:8073/',
  type: 'KiwiSDR',
  location: '',
  notes: '',
  favorite: false,
  ...over,
});

// ---- 1. normalizeWebSdrUrl ---------------------------------------------

describe('normalizeWebSdrUrl', () => {
  it('accepts http and https', () => {
    expect(normalizeWebSdrUrl('http://sdr.example:8073/')).toBe('http://sdr.example:8073/');
    expect(normalizeWebSdrUrl('https://sdr.example/')).toBe('https://sdr.example/');
  });

  it('rejects every non-http(s) scheme', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'ftp://host/x',
      'ws://host/stream',
      'chrome://settings',
    ]) {
      expect(() => normalizeWebSdrUrl(bad)).toThrow();
    }
  });

  it('rejects unparseable / path-injection input (never reaches a path builder)', () => {
    for (const bad of ['', '../../etc/passwd', 'not a url', '/relative/path', 'host:8073']) {
      expect(() => normalizeWebSdrUrl(bad)).toThrow();
    }
  });

  it('rejects a non-string', () => {
    expect(() => normalizeWebSdrUrl(undefined)).toThrow();
    expect(() => normalizeWebSdrUrl(42 as unknown)).toThrow();
  });
});

// ---- 2. makeWebSdrStore (pure factory) ---------------------------------

describe('makeWebSdrStore: directory + seed', () => {
  it('seeds the bundled receivers exactly once, then round-trips reads/saves', async () => {
    const seed = [RX({ id: 'seed-a', url: 'http://a.example/' }), RX({ id: 'seed-b', url: 'http://b.example/' })];
    const deps = memDeps(seed);
    const s = makeWebSdrStore(deps);

    const first = await s.directory.read();
    expect(first.map((r) => r.id).sort()).toEqual(['seed-a', 'seed-b']);
    // The seed stamp is persisted so the import is one-shot.
    expect(JSON.parse(deps.store.get('websdr/directory.json')!).directorySeedVersion).toBe(KIWI_SEED_VERSION);

    // A user removes a seeded receiver …
    await s.directory.remove('seed-a');
    // … and a subsequent read must NOT silently re-add it (seed is idempotent).
    const afterRemoval = await s.directory.read();
    expect(afterRemoval.map((r) => r.id)).toEqual(['seed-b']);
  });

  it('does not duplicate a seed receiver whose URL already exists (dedup by normalized URL)', async () => {
    const deps = memDeps([RX({ id: 'seed-dup', url: 'http://dup.example/' })]);
    // Pre-populate the directory with the same URL under a different id + a stale (missing) version.
    deps.store.set(
      'websdr/directory.json',
      JSON.stringify({ receivers: [RX({ id: 'user-added', url: 'http://dup.example/' })] }),
    );
    const s = makeWebSdrStore(deps);
    const list = await s.directory.read();
    expect(list.filter((r) => r.url === 'http://dup.example/')).toHaveLength(1);
    expect(list[0].id).toBe('user-added');
  });

  it('upserts a receiver by id', async () => {
    const s = makeWebSdrStore(memDeps());
    await s.directory.save(RX({ id: 'r1', name: 'One' }));
    await s.directory.save(RX({ id: 'r1', name: 'One Renamed' }));
    const list = await s.directory.read();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('One Renamed');
  });
});

describe('makeWebSdrStore: presets / notes / menu / egress / recordings', () => {
  it('presets round-trip, upsert by id, and cascade-remove by receiver', async () => {
    const s = makeWebSdrStore(memDeps());
    await s.presets.save({ id: 'p1', name: '40m', frequencyHz: 7100000, mode: 'LSB', receiverId: 'r1', notes: '' });
    await s.presets.save({ id: 'p2', name: '20m', frequencyHz: 14200000, mode: 'USB', receiverId: 'r2', notes: '' });
    expect(await s.presets.read()).toHaveLength(2);
    const afterCascade = await s.presets.removeForReceiver('r1');
    expect(afterCascade.map((p) => p.id)).toEqual(['p2']);
  });

  it('notes round-trip and delete', async () => {
    const s = makeWebSdrStore(memDeps());
    await s.notes.save({ id: 'n1', title: 'T', body: 'B', createdAt: 'x', updatedAt: 'x' });
    expect(await s.notes.read()).toHaveLength(1);
    expect(await s.notes.remove('n1')).toHaveLength(0);
  });

  it('menu falls back to the default when absent and round-trips a custom config', async () => {
    const s = makeWebSdrStore(memDeps());
    const def = await s.menu.read();
    expect(def.items.map((i) => i.key)).toContain('all-feeds');
    await s.menu.write({ items: [{ key: 'favorites', label: 'Faves', hidden: true, builtin: true }] });
    const back = await s.menu.read();
    expect(back.items).toHaveLength(1);
    expect(back.items[0]).toMatchObject({ key: 'favorites', hidden: true });
  });

  it('egress defaults to clearnet and round-trips a tor toggle', async () => {
    const s = makeWebSdrStore(memDeps());
    expect((await s.egress.read()).mode).toBe('clearnet');
    await s.egress.write({ mode: 'tor' });
    expect((await s.egress.read()).mode).toBe('tor');
  });

  it('recordings metadata upserts by id and deletes', async () => {
    const s = makeWebSdrStore(memDeps());
    await s.recordings.save({
      id: 'rec1',
      receiverName: 'X',
      sourceUrl: 'http://x/',
      startedAt: 'a',
      endedAt: 'b',
      durationMs: 1000,
      notes: '',
      sizeBytes: 123,
    });
    expect(await s.recordings.read()).toHaveLength(1);
    expect(await s.recordings.remove('rec1')).toHaveLength(0);
  });
});

// ---- 3. prodWebSdrStore: encrypt-at-rest -------------------------------

describe('prodWebSdrStore: encrypt-at-rest', () => {
  beforeEach(async () => {
    await rm(DATA, { recursive: true, force: true });
    const { __resetProdWebSdrStore } = await import('../src/main/websdr/store');
    __resetProdWebSdrStore();
  });
  afterEach(async () => {
    await rm(DATA, { recursive: true, force: true });
  });

  it('writes the directory sidecar as ciphertext (ENCX; plaintext absent) but reads back plaintext', async () => {
    const { prodWebSdrStore } = await import('../src/main/websdr/store');
    const { websdrDirectoryFile } = await import('../src/main/storage/paths');
    const SECRET = 'operator-only-secret-receiver-name-zzz';

    const s = await prodWebSdrStore();
    await s.directory.save(RX({ id: 'secret-rx', name: SECRET, url: 'https://secret.example/' }));

    const onDisk = await readFile(websdrDirectoryFile());
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX'); // encrypted envelope
    expect(onDisk.toString('utf8')).not.toContain(SECRET); // plaintext body absent on disk

    const back = await s.directory.read();
    expect(back.find((r) => r.id === 'secret-rx')?.name).toBe(SECRET); // decrypts in-app
  });

  it('seeds the bundled 851 public KiwiSDR receivers on first read', async () => {
    const { prodWebSdrStore } = await import('../src/main/websdr/store');
    const s = await prodWebSdrStore();
    const list = await s.directory.read();
    expect(list.length).toBeGreaterThanOrEqual(851);
    expect(list.every((r) => r.url.startsWith('http'))).toBe(true);
  });
});
