import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-lib-concurrency') } }));
import { createLibrary, type LibraryIO } from '../src/main/services/memory/library/store';

// fakeIO with an async yield in the manifest read so parallel add()s interleave their
// read-modify-write. Without the withLock mutex this loses one of the two entries.
function slowIO(): LibraryIO {
  let manifest: string | null = null; const docs = new Map<string, string>();
  return {
    async readManifest() { await Promise.resolve(); await Promise.resolve(); return manifest; },
    async writeManifest(t) { manifest = t; },
    async readDocText(id) { return docs.get(id) ?? null; },
    async writeDocText(id, t) { docs.set(id, t); },
    async removeDocText(id) { docs.delete(id); }
  };
}

describe('library manifest concurrency', () => {
  it('parallel adds do not lose updates', async () => {
    const lib = createLibrary(slowIO());
    await Promise.all([
      lib.add({ docId: 'doc-a', title: 'a.txt', mime: 'text/plain', text: 'alpha', now: 1 }),
      lib.add({ docId: 'doc-b', title: 'b.txt', mime: 'text/plain', text: 'bravo', now: 2 })
    ]);
    const ids = (await lib.list()).map((d) => d.docId).sort();
    expect(ids).toEqual(['doc-a', 'doc-b']);
  });
});
