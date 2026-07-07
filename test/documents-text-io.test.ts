import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let ROOT: string; // fake dataRoot

vi.mock('electron', () => ({
  app: { getPath: (_k: string) => ROOT },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));
// secure-fs: encrypted iff first byte is 0x01 (test convention); decrypt = drop first byte.
vi.mock('../src/main/storage/secure-fs', () => ({
  isEncryptedFile: async (p: string) => (await readFile(p))[0] === 0x01,
  secureReadFile: async (p: string) => { const b = await readFile(p); return b[0] === 0x01 ? b.subarray(1) : b; },
  secureWriteFile: async (p: string, b: Buffer) => writeFile(p, b),
}));
vi.mock('../src/main/documents/paths', async () => {
  const { join: j } = await import('node:path');
  return {
    documentsRoot: () => j(ROOT, 'documents'),
    resolveWithin: (rel: string) => j(ROOT, 'documents', rel),
    ensureDocumentsRoot: async () => { await mkdir(j(ROOT, 'documents'), { recursive: true }); },
  };
});

beforeEach(async () => {
  ROOT = await mkdtemp(join(tmpdir(), 'ga98-docs-text-'));
  await mkdir(join(ROOT, 'documents'), { recursive: true });
});
afterEach(async () => { await rm(ROOT, { recursive: true, force: true }); });

describe('writeText', () => {
  it('writes via secureWriteFile to a uniqueLeaf under the confined dir and returns a DocEntry', async () => {
    const store = await import('../src/main/documents/store');
    const entry = await store.writeText('', 'note.txt', 'hello world');
    expect(entry.kind).toBe('file');
    expect(entry.name).toBe('note.txt');
    expect((await readFile(join(ROOT, 'documents', 'note.txt'))).toString('utf8')).toBe('hello world');
  });

  it('dedupes the name when the leaf already exists', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'note.txt'), 'existing');
    const entry = await store.writeText('', 'note.txt', 'new body');
    expect(entry.name).toBe('note (1).txt');
    expect((await readFile(join(ROOT, 'documents', 'note (1).txt'))).toString('utf8')).toBe('new body');
  });

  it('overwrite=true writes to the EXACT name in place (no dedupe) when the leaf already exists', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'untitled.txt'), 'first draft');
    const entry = await store.writeText('', 'untitled.txt', 'second draft', true);
    // Must reuse the exact name, not mint 'untitled (1).txt' — the Notepad re-save-in-place contract.
    expect(entry.name).toBe('untitled.txt');
    expect((await readFile(join(ROOT, 'documents', 'untitled.txt'))).toString('utf8')).toBe('second draft');
    // And no dedupe sibling was created.
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(join(ROOT, 'documents'));
    expect(names).toEqual(['untitled.txt']);
  });
});

describe('readText', () => {
  it('returns the decoded string for a .txt file', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'notes.txt'), Buffer.from('plain text body'));
    await expect(store.readText('notes.txt')).resolves.toBe('plain text body');
  });

  it('decrypts an encrypted text file', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'secret.md'), Buffer.concat([Buffer.from([0x01]), Buffer.from('secret body')]));
    await expect(store.readText('secret.md')).resolves.toBe('secret body');
  });

  it('rejects a non-text extension', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await expect(store.readText('photo.png')).rejects.toThrow(/text/i);
  });

  it('rejects an oversize file', async () => {
    const store = await import('../src/main/documents/store');
    const big = Buffer.alloc(1024 * 1024 + 1, 0x61);
    await writeFile(join(ROOT, 'documents', 'huge.txt'), big);
    await expect(store.readText('huge.txt')).rejects.toThrow(/large/i);
  });
});
