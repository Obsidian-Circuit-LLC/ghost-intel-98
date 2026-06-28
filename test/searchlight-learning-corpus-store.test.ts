/**
 * Tests for src/main/searchlight/learning/corpus-store.ts
 *
 * Uses injectable CorpusIO (path-free readAll/writeAll) so no secure-fs or
 * Electron runtime is needed.  The CorpusIO default is never invoked in these
 * tests — a fully in-memory implementation is supplied for every call.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stub out the Electron and secure-fs modules so module-level code that
// transitively imports them doesn't crash.  The injected IO in each test
// bypasses both; these stubs are just for safe module loading.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/mock/userData', getAppPath: () => '/mock/appPath' },
}));

vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  secureWriteFile: vi.fn().mockResolvedValue(undefined),
}));

import {
  appendLabel,
  loadCorpus,
  removeLabel,
} from '../src/main/searchlight/learning/corpus-store';
import type { LabelEntry, CorpusIO } from '../src/main/searchlight/learning/corpus-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(resultId: string, label: 0 | 1 = 1): LabelEntry {
  return {
    resultId,
    features: [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1000, 0, 0, 1, 0, 0, 0, 0, 0, 5, 0, 5, 0],
    label,
    soft: false,
    siteName: 'TestSite',
    caseId: 'case-1',
    ts: 1_000_000,
  };
}

/** Build an in-memory CorpusIO (path-free) for testing. */
function makeIO(initial: LabelEntry[] = []): CorpusIO {
  let store: string = JSON.stringify(initial);
  return {
    readAll: async () => store,
    writeAll: async (data) => { store = data; },
  };
}

/** IO that throws ENOENT on read (simulates first-run / no file). */
const enoentIO: CorpusIO = {
  readAll: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  writeAll: async () => {},
};

// ---------------------------------------------------------------------------
// loadCorpus — sanitization
// ---------------------------------------------------------------------------

describe('loadCorpus sanitization', () => {
  it('returns [] when the backing store throws ENOENT', async () => {
    const result = await loadCorpus(enoentIO);
    expect(result).toEqual([]);
  });

  it('returns [] when JSON is invalid', async () => {
    const io: CorpusIO = { readAll: async () => 'NOT_JSON', writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toEqual([]);
  });

  it('returns [] when JSON is a non-array', async () => {
    const io: CorpusIO = { readAll: async () => JSON.stringify({ foo: 1 }), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toEqual([]);
  });

  it('drops entries with empty resultId', async () => {
    const bad: LabelEntry = { ...makeEntry('r1'), resultId: '' };
    const io: CorpusIO = { readAll: async () => JSON.stringify([bad]), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toHaveLength(0);
  });

  it('drops entries with non-numeric features', async () => {
    const bad = { ...makeEntry('r1'), features: ['x', 'y'] };
    const io: CorpusIO = { readAll: async () => JSON.stringify([bad]), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toHaveLength(0);
  });

  it('drops entries with empty features array', async () => {
    const bad = { ...makeEntry('r1'), features: [] };
    const io: CorpusIO = { readAll: async () => JSON.stringify([bad]), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toHaveLength(0);
  });

  it('drops entries with label outside {0,1}', async () => {
    const bad = { ...makeEntry('r1'), label: 2 };
    const io: CorpusIO = { readAll: async () => JSON.stringify([bad]), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toHaveLength(0);
  });

  it('keeps valid entries and drops only invalid ones', async () => {
    const valid = makeEntry('r1', 1);
    const bad = { ...makeEntry('r2'), label: 99 };
    const io: CorpusIO = { readAll: async () => JSON.stringify([valid, bad]), writeAll: async () => {} };
    const result = await loadCorpus(io);
    expect(result).toHaveLength(1);
    expect(result[0].resultId).toBe('r1');
  });

  it('keeps all valid entries', async () => {
    const entries = [makeEntry('r1', 1), makeEntry('r2', 0), makeEntry('r3', 1)];
    const io = makeIO(entries);
    const result = await loadCorpus(io);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// appendLabel
// ---------------------------------------------------------------------------

describe('appendLabel', () => {
  it('appends an entry and returns the updated corpus', async () => {
    const io = makeIO([]);
    const updated = await appendLabel(makeEntry('r1'), io);
    expect(updated).toHaveLength(1);
    expect(updated[0].resultId).toBe('r1');
  });

  it('accumulates multiple entries in order', async () => {
    const io = makeIO([]);
    await appendLabel(makeEntry('r1'), io);
    const updated = await appendLabel(makeEntry('r2', 0), io);
    expect(updated).toHaveLength(2);
    expect(updated[1].resultId).toBe('r2');
    expect(updated[1].label).toBe(0);
  });

  it('preserves existing entries when appending', async () => {
    const io = makeIO([makeEntry('r1')]);
    const updated = await appendLabel(makeEntry('r2', 0), io);
    expect(updated).toHaveLength(2);
    expect(updated[0].resultId).toBe('r1');
  });
});

// ---------------------------------------------------------------------------
// removeLabel
// ---------------------------------------------------------------------------

describe('removeLabel', () => {
  it('removes the entry with the given resultId', async () => {
    const io = makeIO([makeEntry('r1'), makeEntry('r2')]);
    const updated = await removeLabel('r1', io);
    expect(updated).toHaveLength(1);
    expect(updated[0].resultId).toBe('r2');
  });

  it('is idempotent when resultId does not exist', async () => {
    const io = makeIO([makeEntry('r1')]);
    const updated = await removeLabel('not-present', io);
    expect(updated).toHaveLength(1);
  });

  it('returns empty array when last entry is removed', async () => {
    const io = makeIO([makeEntry('r1')]);
    const updated = await removeLabel('r1', io);
    expect(updated).toHaveLength(0);
  });

  it('removes only the matching entry when multiple are present', async () => {
    const io = makeIO([makeEntry('r1'), makeEntry('r2'), makeEntry('r3')]);
    const updated = await removeLabel('r2', io);
    expect(updated).toHaveLength(2);
    expect(updated.map((e) => e.resultId)).toEqual(['r1', 'r3']);
  });
});
