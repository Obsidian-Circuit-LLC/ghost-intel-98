import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os'; import { join, resolve, sep } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-lib-traversal') } }));
import { createLibrary, libraryDir, libraryDocTextPath, type LibraryIO } from '../src/main/services/memory/library/store';

// fakeIO whose removeDocText/readDocText/writeDocText run through the REAL libraryDocTextPath,
// so a traversal docId is refused by the confinement check exactly as in production.
function realPathIO(): LibraryIO {
  let manifest: string | null = null; const docs = new Map<string, string>();
  return {
    async readManifest() { return manifest; }, async writeManifest(t) { manifest = t; },
    async readDocText(id) { libraryDocTextPath(id); return docs.get(id) ?? null; },
    async writeDocText(id, t) { libraryDocTextPath(id); docs.set(id, t); },
    async removeDocText(id) { libraryDocTextPath(id); docs.delete(id); }
  };
}

describe('library path traversal confinement', () => {
  it('libraryDocTextPath throws on a traversal docId', () => {
    expect(() => libraryDocTextPath('../../../../etc/passwd')).toThrow(/escapes the library directory/);
    expect(() => libraryDocTextPath('../secret')).toThrow(/escapes the library directory/);
  });

  it('remove() with a traversal docId throws instead of deleting an arbitrary file', async () => {
    const lib = createLibrary(realPathIO());
    await expect(lib.remove('../../../etc/passwd')).rejects.toThrow(/escapes the library directory/);
  });

  it('a normal uuid docId resolves to a path under <libraryDir>/docs/', () => {
    const uuid = '3f9a1c2e-4b5d-6789-a012-b3c4d5e6f708';
    const p = resolve(libraryDocTextPath(uuid));
    const docsDir = resolve(join(libraryDir(), 'docs'));
    expect(p.startsWith(docsDir + sep)).toBe(true);
    expect(p.endsWith(`${uuid}.txt`)).toBe(true);
  });
});
