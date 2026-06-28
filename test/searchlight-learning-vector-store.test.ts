/**
 * Tests for src/main/searchlight/learning/vector-store.ts
 *
 * Uses injectable VectorIO (path-free readVectors/writeVectors) so no
 * secure-fs or Electron runtime is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub electron and secure-fs so module loading doesn't crash.
// The injected VectorIO bypasses both in every test.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/mock/userData', getAppPath: () => '/mock/appPath' },
}));

vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  secureWriteFile: vi.fn().mockResolvedValue(undefined),
}));

import { saveVectors, loadVectors } from '../src/main/searchlight/learning/vector-store';
import type { CapturedVector, VectorIO } from '../src/main/searchlight/learning/vector-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(resultId: string, n = 32): CapturedVector {
  return { resultId, features: Array.from({ length: n }, (_, i) => i * 0.01), siteName: 'TestSite', ts: 1_000_000 };
}

/** Build an in-memory VectorIO. */
function makeIO(): VectorIO {
  const store = new Map<string, string>();
  return {
    readVectors: async (caseId) => {
      const v = store.get(caseId);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
    writeVectors: async (caseId, data) => { store.set(caseId, data); },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadVectors', () => {
  it('returns [] when no file exists yet', async () => {
    const vecs = await loadVectors('case-new', makeIO());
    expect(vecs).toEqual([]);
  });

  it('returns [] when the file contains invalid JSON', async () => {
    const io = makeIO();
    await io.writeVectors('bad', 'NOT_JSON');
    const vecs = await loadVectors('bad', io);
    expect(vecs).toEqual([]);
  });

  it('returns [] when file contains a non-array', async () => {
    const io = makeIO();
    await io.writeVectors('x', JSON.stringify({ foo: 1 }));
    const vecs = await loadVectors('x', io);
    expect(vecs).toEqual([]);
  });
});

describe('saveVectors / loadVectors round-trip', () => {
  it('persists and retrieves vectors for a case', async () => {
    const io = makeIO();
    const input: CapturedVector[] = [makeVector('r1'), makeVector('r2')];
    await saveVectors('case-rt', input, io);
    const loaded = await loadVectors('case-rt', io);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].resultId).toBe('r1');
    expect(loaded[1].resultId).toBe('r2');
    expect(loaded[0].features.length).toBe(32);
  });

  it('overwrites the previous store for the same caseId', async () => {
    const io = makeIO();
    await saveVectors('case-overwrite', [makeVector('r1')], io);
    await saveVectors('case-overwrite', [makeVector('r2'), makeVector('r3')], io);
    const loaded = await loadVectors('case-overwrite', io);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((v) => v.resultId)).toEqual(['r2', 'r3']);
  });

  it('different caseIds do not interfere', async () => {
    const io = makeIO();
    await saveVectors('case-A', [makeVector('a1')], io);
    await saveVectors('case-B', [makeVector('b1'), makeVector('b2')], io);
    const a = await loadVectors('case-A', io);
    const b = await loadVectors('case-B', io);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('siteName and ts are preserved', async () => {
    const io = makeIO();
    const v: CapturedVector = { resultId: 'r1', features: [1, 2, 3], siteName: 'GitHub', ts: 9_999_999 };
    await saveVectors('case-meta', [v], io);
    const [loaded] = await loadVectors('case-meta', io);
    expect(loaded.siteName).toBe('GitHub');
    expect(loaded.ts).toBe(9_999_999);
  });
});
