/**
 * X6 — Analyst notes.
 *
 * Ported from the quarantine `notes:add` / `notes:update` handlers
 * (`electron/main.cjs:1305-1329`), but re-shaped to ONE note per finding
 * (`XNote` carries no note-id — it is keyed by `findingId`) and routed through
 * the encrypted `notes` artifact store instead of a plaintext appState blob.
 *
 * Three concerns, one file:
 *  1. The pure store method `notes.save(caseId, findingId, text, savedAt)` upserts
 *     by `findingId` (create then replace, never duplicate) through an injected
 *     in-memory fs seam — no electron / vault needed.
 *  2. The IPC orchestration `saveNote` / `readNotes`: the injected clock stamps
 *     `savedAt` (determinism — the renderer never supplies the timestamp), text is
 *     trimmed + validated (non-empty, ≤ 20 000 chars — ported from the quarantine).
 *  3. The production-wired store (prodXStore) routes notes through the real secure-fs
 *     choke-point, so the on-disk notes file is CIPHERTEXT: the raw bytes must not
 *     contain the plaintext note body. (Fake reversible vault + mocked electron
 *     userData, mirroring x-listening-store.test.ts.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeXStore, type XStoreDeps, type XNote } from '../src/main/x-listening/store';

const DATA = join(tmpdir(), 'dcs98-x-listening-notes-test');
const MAGIC = Buffer.from('ENCX');

// electron is imported transitively by ipc.ts (`import { session }`) and by prodXStore
// (`app.getPath`). Provide both so importing either never touches a real electron.
vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));

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

// ---- 1. pure store upsert-by-findingId ---------------------------------

describe('makeXStore: notes.save (upsert by findingId)', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('creates a note for a finding and reads it back', async () => {
    await xStore.notes.save('case-a', 'f1', 'first observation', '2026-08-06T00:00:00.000Z');
    const notes = await xStore.notes.read('case-a');
    expect(notes).toEqual([{ findingId: 'f1', text: 'first observation', savedAt: '2026-08-06T00:00:00.000Z' }]);
  });

  it('REPLACES the finding note on a second save (one note per finding, never a duplicate)', async () => {
    await xStore.notes.save('case-a', 'f1', 'draft', '2026-08-06T00:00:00.000Z');
    const after = await xStore.notes.save('case-a', 'f1', 'revised', '2026-08-06T01:00:00.000Z');
    const notes = await xStore.notes.read('case-a');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({ findingId: 'f1', text: 'revised', savedAt: '2026-08-06T01:00:00.000Z' });
    // save returns the fresh list so the renderer can rerender without a second read.
    expect(after).toEqual(notes);
  });

  it('keeps distinct findings side by side and is case-scoped', async () => {
    await xStore.notes.save('case-a', 'f1', 'note one', '2026-08-06T00:00:00.000Z');
    await xStore.notes.save('case-a', 'f2', 'note two', '2026-08-06T00:00:01.000Z');
    await xStore.notes.save('case-b', 'f1', 'other case', '2026-08-06T00:00:02.000Z');
    expect((await xStore.notes.read('case-a')).map((n) => n.findingId)).toEqual(['f1', 'f2']);
    expect(await xStore.notes.read('case-b')).toEqual([
      { findingId: 'f1', text: 'other case', savedAt: '2026-08-06T00:00:02.000Z' },
    ]);
  });
});

// ---- 2. IPC orchestration: injected clock + validation -----------------

describe('saveNote / readNotes (IPC orchestration)', () => {
  it('stamps savedAt from the injected clock — never from the renderer', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    let saved: { findingId: string; text: string; savedAt: string } | null = null;
    const res = await saveNote(
      { caseId: 'case-a', findingId: 'f1', text: 'observed' },
      {
        saveNote: async (_c, findingId, text, savedAt) => {
          saved = { findingId, text, savedAt };
          return [{ findingId, text, savedAt }];
        },
        readNotes: async () => [],
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(saved!.savedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(res.notes[0].text).toBe('observed');
  });

  it('trims the text before saving', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    let savedText = '';
    await saveNote(
      { caseId: 'case-a', findingId: 'f1', text: '  padded note  ' },
      { saveNote: async (_c, _f, text) => { savedText = text; return []; }, readNotes: async () => [], now: () => 'now' },
    );
    expect(savedText).toBe('padded note');
  });

  it('rejects an empty / whitespace-only note (never persists it)', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: 'f1', text: '   ' }, { saveNote: store, readNotes: async () => [], now: () => 'now' }),
    ).rejects.toThrow(/required/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects a note over the 20 000-char cap', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: 'f1', text: 'x'.repeat(20001) }, { saveNote: store, readNotes: async () => [], now: () => 'now' }),
    ).rejects.toThrow(/too long/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects a note with no finding attachment', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: '  ', text: 'orphan' }, { saveNote: store, readNotes: async () => [], now: () => 'now' }),
    ).rejects.toThrow(/finding/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('readNotes returns the case notes through the injected store', async () => {
    const { readNotes } = await import('../src/main/x-listening/ipc');
    const fixture: XNote[] = [{ findingId: 'f1', text: 'note', savedAt: 'now' }];
    const res = await readNotes('case-a', { saveNote: async () => [], readNotes: async () => fixture, now: () => 'now' });
    expect(res.notes).toEqual(fixture);
  });
});

// ---- 3. production wiring: ciphertext at rest --------------------------

describe('prodXStore: notes encrypt-at-rest', () => {
  const SECRET_NOTE = 'operator-only-analyst-observation';
  beforeEach(async () => {
    await mkdir(DATA, { recursive: true });
    const { __resetProdXStore } = await import('../src/main/x-listening/store');
    __resetProdXStore();
  });
  afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

  it('writes ciphertext to disk (raw bytes lack the plaintext note) but reads back plaintext', async () => {
    const { prodXStore } = await import('../src/main/x-listening/store');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');

    const s = await prodXStore();
    await s.notes.save('case-enc', 'f1', SECRET_NOTE, '2026-08-06T00:00:00.000Z');

    const path = join(scrapingCaseDir('x', 'case-enc'), 'x-notes.json');
    const onDisk = await readFile(path);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');            // encrypted envelope
    expect(onDisk.includes(Buffer.from(SECRET_NOTE))).toBe(false);    // plaintext body absent

    const back = await s.notes.read('case-enc');
    expect(back[0].text).toBe(SECRET_NOTE);                            // decrypts in-app
  });
});
