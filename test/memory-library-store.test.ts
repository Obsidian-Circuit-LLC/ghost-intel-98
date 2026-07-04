import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-lib') } }));
import { createLibrary, type LibraryIO } from '../src/main/services/memory/library/store';

function fakeIO(): LibraryIO {
  let manifest: string | null = null; const docs = new Map<string, string>();
  return {
    async readManifest() { return manifest; }, async writeManifest(t) { manifest = t; },
    async readDocText(id) { return docs.get(id) ?? null; }, async writeDocText(id, t) { docs.set(id, t); },
    async removeDocText(id) { docs.delete(id); }
  };
}

describe('library store', () => {
  it('adds, lists, reads, and removes a document', async () => {
    const lib = createLibrary(fakeIO());
    const d = await lib.add({ docId: 'doc-1', title: 'report.pdf', mime: 'application/pdf', text: 'alpha bravo charlie', now: 1000 });
    expect(d.charCount).toBe('alpha bravo charlie'.length);
    expect(await lib.list()).toHaveLength(1);
    expect(await lib.readText('doc-1')).toBe('alpha bravo charlie');
    await lib.remove('doc-1');
    expect(await lib.list()).toHaveLength(0);
    expect(await lib.readText('doc-1')).toBeNull();
  });
});
