/**
 * Task TF2 — Telegram Hunter artifact store + path-traversal-guarded import.
 *
 * Four concerns, one file (mirrors the X Listening store test, Plan A F3):
 *  1. The pure factory (makeTgHunterStore) round-trips the four per-tool artifact
 *     stores (members / keywordWatch / imports / dedup) through an injected in-memory
 *     fs seam — no electron / vault needed.
 *  2. parseTelegramExport resolves EVERY media path through confineImportPath(root, rel):
 *     a malicious Telegram export whose media escapes the chosen root (`../../etc/passwd`,
 *     an absolute `/etc/passwd`, or a remote URL) yields the message with the media DROPPED
 *     — never an out-of-root absolute path handed to a later reader (the LFI fix).
 *  3. The production-wired store routes through the real secure-fs choke-point, so the
 *     on-disk artifact file is CIPHERTEXT (raw bytes lack a known plaintext value) yet reads
 *     back plaintext. caseId is ensureUuid-validated (fake reversible vault + mocked electron).
 *  4. mergeSettings heals the socmint.telegram engine block from a stale/absent on-disk
 *     settings file (upgrade guard, v3.24.0 dataloss class).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import {
  makeTgHunterStore,
  parseTelegramExport,
  type TgHunterStoreDeps,
  type TgMember,
  type TgKeywordRule,
  type TgImportSet,
} from '../src/main/socmint/telegram-hunter/store';

const DATA = join(tmpdir(), 'dcs98-tg-hunter-store-test');
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

function memDeps(): TgHunterStoreDeps {
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
    membersPath: (caseId) => `tg/${caseId}/tg-members.json`,
    keywordWatchPath: (caseId) => `tg/${caseId}/tg-keyword-watch.json`,
    importsPath: (caseId) => `tg/${caseId}/tg-imports.json`,
    dedupPath: (caseId) => `tg/${caseId}/tg-dedup.json`,
  };
}

// ---- 1. pure factory round-trips ---------------------------------------

const SECRET = 'operator-only-visible-capture-body';

describe('makeTgHunterStore: artifact stores round-trip + case scope', () => {
  let s: ReturnType<typeof makeTgHunterStore>;
  beforeEach(() => { s = makeTgHunterStore(memDeps()); });

  it('members round-trip, dedup on save, and are case-scoped', async () => {
    const m1: TgMember = { handle: '@a', displayName: 'Alice', context: 'grp', capturedAt: '2026-08-07T00:00:00.000Z' };
    const m2: TgMember = { handle: '@b', context: 'grp', capturedAt: '2026-08-07T00:00:01.000Z' }; // no displayName
    await s.members.save('case-a', m1);
    await s.members.save('case-a', m2);
    expect(await s.members.save('case-a', m1)).toBe(2); // re-save dedups, count stays 2
    const got = await s.members.read('case-a');
    expect(got.map((m) => m.handle)).toEqual(['@a', '@b']);
    expect(got[1].displayName).toBeUndefined();          // never backfilled from @handle
    expect(await s.members.read('case-b')).toEqual([]);
  });

  it('keywordWatch stores literal terms, dedups case-insensitively, is case-scoped', async () => {
    await s.keywordWatch.add('case-a', 'C4', '2026-08-07T00:00:00.000Z');
    const rules = await s.keywordWatch.add('case-a', 'c4', '2026-08-07T00:00:01.000Z'); // dup
    expect(rules.map((r: TgKeywordRule) => r.term)).toEqual(['C4']);
    expect(await s.keywordWatch.read('case-b')).toEqual([]);
  });

  it('imports round-trip and are case-scoped', async () => {
    const set: TgImportSet = {
      id: 'json-1', name: 'Ops chat', sourceFile: '/exports/ops/result.json',
      items: [], importedAt: '2026-08-07T00:00:00.000Z',
    };
    expect(await s.imports.add('case-a', set)).toBe(1);
    expect((await s.imports.read('case-a')).map((x) => x.id)).toEqual(['json-1']);
    expect(await s.imports.read('case-b')).toEqual([]);
  });

  it('dedup index tracks seen keys idempotently, case-scoped', async () => {
    expect(await s.dedup.add('case-a', 'k1')).toBe(true);
    expect(await s.dedup.add('case-a', 'k1')).toBe(false); // already seen
    expect(await s.dedup.has('case-a', 'k1')).toBe(true);
    expect(await s.dedup.has('case-b', 'k1')).toBe(false);
  });
});

// ---- 2. import path-traversal confinement (the LFI fix) -----------------

describe('parseTelegramExport: media confined to the chosen root', () => {
  const ROOT = resolve(tmpdir(), 'tg-export-root');

  it('drops media that escapes the root (traversal, absolute, remote) but keeps the message', () => {
    const json = {
      chats: {
        list: [
          {
            id: 42, name: 'Ops', type: 'group',
            messages: [
              { id: 1, from: 'Mallory', from_id: 'user7', date: '2026-08-07T00:00:00', text: 'traversal', file: '../../../../etc/passwd' },
              { id: 2, from: 'Mallory', from_id: 'user7', date: '2026-08-07T00:00:01', text: 'absolute', photo: '/etc/passwd' },
              { id: 3, from: 'Mallory', from_id: 'user7', date: '2026-08-07T00:00:02', text: 'remote', file: 'https://evil.example/x.png' },
            ],
          },
        ],
      },
    };
    const items = parseTelegramExport(ROOT, json);
    expect(items).toHaveLength(3);
    // Every message survives, but NONE carries an out-of-root or remote media path.
    for (const it of items) expect(it.media).toEqual([]);
    // Belt-and-suspenders: no absolute path outside ROOT leaked anywhere.
    const serialized = JSON.stringify(items);
    expect(serialized.includes('/etc/passwd')).toBe(false);
    expect(serialized.includes('evil.example')).toBe(false);
  });

  it('keeps in-root media with a confined absolute path and inferred type', () => {
    const json = {
      chats: { list: [ { id: 7, name: 'Ops', messages: [
        { id: 9, from: 'Bob', date: '2026-08-07T00:00:00', text: 'pic', photo: 'photos/1.jpg' },
      ] } ] },
    };
    const [item] = parseTelegramExport(ROOT, json);
    expect(item.media).toHaveLength(1);
    expect(item.media[0].type).toBe('image');
    expect(item.media[0].path).toBe(resolve(ROOT, 'photos/1.jpg'));
    expect(item.media[0].path!.startsWith(ROOT + sep)).toBe(true);
  });

  it('normalizes array-form text and extracts links honestly', () => {
    const json = {
      chats: { list: [ { id: 1, name: 'C', messages: [
        { id: 1, from: 'A', date: 'd', text: ['see ', { type: 'link', text: 'https://t.me/x' }] },
      ] } ] },
    };
    const [item] = parseTelegramExport(ROOT, json);
    expect(item.text).toBe('see https://t.me/x');
    expect(item.links).toContain('https://t.me/x');
  });
});

// ---- 3. production wiring: ciphertext at rest, uuid-validated -----------

const CASE_UUID = '11111111-1111-4111-8111-111111111111';

describe('prodTgHunterStore: encrypt-at-rest + ensureUuid', () => {
  beforeEach(async () => {
    await mkdir(DATA, { recursive: true });
    const { __resetProdTgHunterStore } = await import('../src/main/socmint/telegram-hunter/store');
    __resetProdTgHunterStore();
  });
  afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

  it('writes ciphertext to disk (raw bytes lack the plaintext body) but reads back plaintext', async () => {
    const { prodTgHunterStore } = await import('../src/main/socmint/telegram-hunter/store');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');

    const s = await prodTgHunterStore();
    await s.members.save(CASE_UUID, { handle: '@t', displayName: SECRET, capturedAt: '2026-08-07T00:00:00.000Z' });

    const path = join(scrapingCaseDir('socmint', CASE_UUID), 'tg-members.json');
    const onDisk = await readFile(path);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');           // encrypted envelope
    expect(onDisk.includes(Buffer.from(SECRET))).toBe(false);        // plaintext body absent

    const back = await s.members.read(CASE_UUID);
    expect(back[0].displayName).toBe(SECRET);                        // decrypts in-app
  });

  it('rejects a non-uuid caseId at the store boundary', async () => {
    const { prodTgHunterStore } = await import('../src/main/socmint/telegram-hunter/store');
    const s = await prodTgHunterStore();
    await expect(s.members.read('../../etc')).rejects.toThrow();
  });
});

// ---- 4. settings upgrade guard -----------------------------------------

describe('mergeSettings: socmint.telegram engine block heals from a stale on-disk file', () => {
  it('an absent socmint.telegram yields the full default engine block', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');

    const merged = mergeSettings(defaultSettings, {} as never);
    expect(merged.socmint.telegram).toEqual(defaultSettings.socmint.telegram);
    expect(merged.socmint.telegram).toEqual({ engine: 'capture', captureMedia: false });
  });

  it('a partial socmint patch heals the missing telegram block while keeping user values', async () => {
    const { mergeSettings } = await import('../src/main/storage/json-fs');
    const { defaultSettings } = await import('../src/shared/types');

    const merged = mergeSettings(defaultSettings, {
      socmint: { networkEnabled: true },
    } as never);
    expect(merged.socmint.networkEnabled).toBe(true);                       // user opt-in survives
    expect(merged.socmint.telegram).toEqual({ engine: 'capture', captureMedia: false }); // healed

    const merged2 = mergeSettings(defaultSettings, {
      socmint: { telegram: { captureMedia: true } },
    } as never);
    expect(merged2.socmint.telegram.captureMedia).toBe(true);               // user opt-in survives
    expect(merged2.socmint.telegram.engine).toBe('capture');                // missing sub-field healed
  });
});
