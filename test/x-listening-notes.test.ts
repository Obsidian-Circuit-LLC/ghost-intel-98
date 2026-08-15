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

// ---- 1b. M11: multi-note per finding (store.add / store.update) ---------

describe('makeXStore: notes.add / notes.update (M11 multi-note)', () => {
  let xStore: ReturnType<typeof makeXStore>;
  beforeEach(() => { xStore = makeXStore(memDeps()); });

  it('APPENDS many notes to the SAME finding (never coalesces — his multi-note model)', async () => {
    await xStore.notes.add('case-a', 'n1', 'f1', 'first observation', '2026-08-06T00:00:00.000Z');
    await xStore.notes.add('case-a', 'n2', 'f1', 'second observation', '2026-08-06T01:00:00.000Z');
    const notes = await xStore.notes.read('case-a');
    expect(notes).toEqual([
      { id: 'n1', findingId: 'f1', text: 'first observation', savedAt: '2026-08-06T00:00:00.000Z' },
      { id: 'n2', findingId: 'f1', text: 'second observation', savedAt: '2026-08-06T01:00:00.000Z' },
    ]);
  });

  it('update edits ONE note in place by id, leaving its siblings on the same finding untouched', async () => {
    await xStore.notes.add('case-a', 'n1', 'f1', 'draft one', '2026-08-06T00:00:00.000Z');
    await xStore.notes.add('case-a', 'n2', 'f1', 'draft two', '2026-08-06T01:00:00.000Z');
    const after = await xStore.notes.update('case-a', 'n2', 'revised two', '2026-08-06T02:00:00.000Z');
    expect(after).toEqual([
      { id: 'n1', findingId: 'f1', text: 'draft one', savedAt: '2026-08-06T00:00:00.000Z' },
      { id: 'n2', findingId: 'f1', text: 'revised two', savedAt: '2026-08-06T02:00:00.000Z' },
    ]);
  });

  it('update of a legacy (id-less) note matches on its findingId (xNoteKey back-compat)', async () => {
    await xStore.notes.save('case-a', 'f1', 'legacy note', '2026-08-06T00:00:00.000Z');
    const after = await xStore.notes.update('case-a', 'f1', 'legacy revised', '2026-08-06T03:00:00.000Z');
    expect(after).toEqual([{ findingId: 'f1', text: 'legacy revised', savedAt: '2026-08-06T03:00:00.000Z' }]);
  });
});

// ---- 2. IPC orchestration: injected clock + validation -----------------

describe('saveNote / readNotes (IPC orchestration)', () => {
  it('APPENDS with an injected id + clock — never from the renderer (M11)', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    let saved: { id: string; findingId: string; text: string; savedAt: string } | null = null;
    const res = await saveNote(
      { caseId: 'case-a', findingId: 'f1', text: 'observed' },
      {
        addNote: async (_c, id, findingId, text, savedAt) => {
          saved = { id, findingId, text, savedAt };
          return [{ id, findingId, text, savedAt }];
        },
        readNotes: async () => [],
        now: () => '2026-08-06T12:00:00.000Z',
        newId: () => 'note-fixed-id',
      },
    );
    expect(saved!.savedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(saved!.id).toBe('note-fixed-id');
    expect(res.notes[0].text).toBe('observed');
  });

  it('trims the text before saving', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    let savedText = '';
    await saveNote(
      { caseId: 'case-a', findingId: 'f1', text: '  padded note  ' },
      { addNote: async (_c, _id, _f, text) => { savedText = text; return []; }, readNotes: async () => [], now: () => 'now', newId: () => 'x' },
    );
    expect(savedText).toBe('padded note');
  });

  it('rejects an empty / whitespace-only note (never persists it)', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: 'f1', text: '   ' }, { addNote: store, readNotes: async () => [], now: () => 'now', newId: () => 'x' }),
    ).rejects.toThrow(/required/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects a note over the 20 000-char cap', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: 'f1', text: 'x'.repeat(20001) }, { addNote: store, readNotes: async () => [], now: () => 'now', newId: () => 'x' }),
    ).rejects.toThrow(/too long/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects a note with no finding attachment', async () => {
    const { saveNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(
      saveNote({ caseId: 'case-a', findingId: '  ', text: 'orphan' }, { addNote: store, readNotes: async () => [], now: () => 'now', newId: () => 'x' }),
    ).rejects.toThrow(/finding/i);
    expect(store).not.toHaveBeenCalled();
  });

  it('readNotes returns the case notes through the injected store', async () => {
    const { readNotes } = await import('../src/main/x-listening/ipc');
    const fixture: XNote[] = [{ id: 'n1', findingId: 'f1', text: 'note', savedAt: 'now' }];
    const res = await readNotes('case-a', { addNote: async () => [], readNotes: async () => fixture, now: () => 'now', newId: () => 'x' });
    expect(res.notes).toEqual(fixture);
  });
});

// ---- 2a. M11: updateNote IPC orchestration ------------------------------

describe('updateNote (IPC orchestration, M11)', () => {
  it('edits by note id, stamping savedAt from the injected clock', async () => {
    const { updateNote } = await import('../src/main/x-listening/ipc');
    let seen: { id: string; text: string; savedAt: string } | null = null;
    const res = await updateNote(
      { caseId: 'case-a', noteId: 'n2', text: '  edited  ' },
      { updateNote: async (_c, id, text, savedAt) => { seen = { id, text, savedAt }; return [{ id, findingId: 'f1', text, savedAt }]; }, now: () => '2026-08-06T09:00:00.000Z' },
    );
    expect(seen).toEqual({ id: 'n2', text: 'edited', savedAt: '2026-08-06T09:00:00.000Z' });
    expect(res.notes[0].text).toBe('edited');
  });

  it('rejects a blank noteId / empty text (never touches the store)', async () => {
    const { updateNote } = await import('../src/main/x-listening/ipc');
    const store = vi.fn(async () => []);
    await expect(updateNote({ caseId: 'c', noteId: '  ', text: 'x' }, { updateNote: store, now: () => 'now' })).rejects.toThrow(/note id/i);
    await expect(updateNote({ caseId: 'c', noteId: 'n1', text: '  ' }, { updateNote: store, now: () => 'now' })).rejects.toThrow(/required/i);
    expect(store).not.toHaveBeenCalled();
  });
});

// ---- 2b. Task 10: removeNote --------------------------------------------

describe('removeNote (IPC orchestration)', () => {
  it('removes the note for the given findingId and returns the remaining notes', async () => {
    const { removeNote } = await import('../src/main/x-listening/ipc');
    const existing: XNote[] = [
      { findingId: 'f1', text: 'one', savedAt: 't1' },
      { findingId: 'f2', text: 'two', savedAt: 't2' },
    ];
    let written: XNote[] | null = null;
    const res = await removeNote('case-a', 'f1', {
      readNotes: async () => existing,
      writeNotes: async (_caseId, notes) => { written = notes; },
    });
    expect(res.notes).toEqual([{ findingId: 'f2', text: 'two', savedAt: 't2' }]);
    expect(written).toEqual(res.notes);
  });

  it('removing a findingId with no note is a harmless no-op (list unchanged, write still runs)', async () => {
    const { removeNote } = await import('../src/main/x-listening/ipc');
    const existing: XNote[] = [{ findingId: 'f1', text: 'one', savedAt: 't1' }];
    const write = vi.fn(async () => {});
    const res = await removeNote('case-a', 'does-not-exist', {
      readNotes: async () => existing,
      writeNotes: write,
    });
    expect(res.notes).toEqual(existing);
    expect(write).toHaveBeenCalledWith('case-a', existing);
  });

  it('rejects a blank findingId (never reads/writes the store)', async () => {
    const { removeNote } = await import('../src/main/x-listening/ipc');
    const readNotes = vi.fn(async () => []);
    const writeNotes = vi.fn(async () => {});
    await expect(removeNote('case-a', '   ', { readNotes, writeNotes })).rejects.toThrow(/finding/i);
    expect(readNotes).not.toHaveBeenCalled();
    expect(writeNotes).not.toHaveBeenCalled();
  });

  it('end-to-end through the real pure store: save, remove, verify gone', async () => {
    const { makeXStore } = await import('../src/main/x-listening/store');
    const { removeNote } = await import('../src/main/x-listening/ipc');
    const xStore = makeXStore(memDeps());
    await xStore.notes.save('case-a', 'f1', 'note text', '2026-08-06T00:00:00.000Z');
    await xStore.notes.save('case-a', 'f2', 'other note', '2026-08-06T00:00:01.000Z');

    const res = await removeNote('case-a', 'f1', {
      readNotes: (caseId) => xStore.notes.read(caseId),
      writeNotes: (caseId, notes) => xStore.notes.write(caseId, notes),
    });

    expect(res.notes).toEqual([{ findingId: 'f2', text: 'other note', savedAt: '2026-08-06T00:00:01.000Z' }]);
    expect(await xStore.notes.read('case-a')).toEqual(res.notes);
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
