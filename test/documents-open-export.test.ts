import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, symlink, readdir, rm, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let ROOT: string;      // fake dataRoot
let OSTMP: string;     // fake app temp
const openPath = vi.fn(async () => '');
const showItemInFolder = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'temp' ? OSTMP : ROOT) },
  shell: { openPath: (p: string) => openPath(p), showItemInFolder: (p: string) => showItemInFolder(p) },
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
  ROOT = await mkdtemp(join(tmpdir(), 'ga98-docs-'));
  OSTMP = await mkdtemp(join(tmpdir(), 'ga98-tmp-'));
  await mkdir(join(ROOT, 'documents'), { recursive: true });
  openPath.mockClear();
});
afterEach(async () => { await rm(ROOT, { recursive: true, force: true }); await rm(OSTMP, { recursive: true, force: true }); });

describe('readBytes (internal viewer, in-process — no OS handoff / temp)', () => {
  it('returns the decrypted bytes of an encrypted file', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.txt'), Buffer.from([0x01, 0x68, 0x69])); // "encrypted" hi
    expect([...(await store.readBytes('a.txt'))]).toEqual([0x68, 0x69]);
    expect(openPath).not.toHaveBeenCalled(); // in-process: never hands the file to the OS
  });
  it('reads a plaintext file in place', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'p.txt'), Buffer.from('yo'));
    expect([...(await store.readBytes('p.txt'))]).toEqual([0x79, 0x6f]);
  });
  it('reads a large file under the 512 MB cap (a 108 MB-class doc opens fine)', async () => {
    const store = await import('../src/main/documents/store');
    const p = join(ROOT, 'documents', 'hearing-bundle.pdf');
    await writeFile(p, Buffer.from([0x25, 0x50, 0x44, 0x46])); // "%PDF" (plaintext: vault off in this test)
    await truncate(p, 108 * 1024 * 1024); // sparse: 108 MB logical, well under the raised cap
    const bytes = await store.readBytes('hearing-bundle.pdf');
    expect(bytes.length).toBe(108 * 1024 * 1024);
  });
  it('refuses a file over the 512 MB preview cap (before reading it — no OOM)', async () => {
    const store = await import('../src/main/documents/store');
    const p = join(ROOT, 'documents', 'huge.bin');
    await writeFile(p, Buffer.from([0x00]));
    await truncate(p, 512 * 1024 * 1024 + 1); // sparse: logical size just over the cap
    await expect(store.readBytes('huge.bin')).rejects.toThrow(/too large/i);
  });
  it('refuses to read a folder as bytes', async () => {
    const store = await import('../src/main/documents/store');
    await mkdir(join(ROOT, 'documents', 'sub'));
    await expect(store.readBytes('sub')).rejects.toThrow(/folder/i);
  });
});

describe('exportEntry', () => {
  it('writes decrypted bytes to the chosen destination', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.docx'), Buffer.from([0x01, 0x41, 0x42]));
    const dest = join(OSTMP, 'out.docx');
    await store.exportEntry('a.docx', dest);
    expect([...(await readFile(dest))]).toEqual([0x41, 0x42]);
  });
  it('refuses to export onto a symlink destination', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.docx'), Buffer.from([0x41]));
    const victim = join(OSTMP, 'victim'); await writeFile(victim, 'keep');
    const link = join(OSTMP, 'link'); await symlink(victim, link);
    await expect(store.exportEntry('a.docx', link)).rejects.toThrow(/symlink/i);
  });
  it('refuses a destination inside the encrypted documents store (no plaintext-at-rest in the vault)', async () => {
    const store = await import('../src/main/documents/store');
    await writeFile(join(ROOT, 'documents', 'a.docx'), Buffer.from([0x01, 0x41]));
    await expect(store.exportEntry('a.docx', join(ROOT, 'documents', 'leak.docx'))).rejects.toThrow(/outside My Documents/i);
  });
});

describe('temp lifecycle', () => {
  it('sweep clears the dir; shred overwrites+unlinks tracked temps', async () => {
    const t = await import('../src/main/documents/open-temp');
    const p = await t.stageDecryptedTemp(Buffer.from('secret'), 'x.pdf');
    expect((await readFile(p)).toString()).toBe('secret');
    await t.shredDocOpenTemps();
    expect(await readFile(p).catch(() => 'GONE')).toBe('GONE');
    await t.sweepDocOpenTemp();
    expect(await readdir(t.docOpenTempDir())).toEqual([]);
  });
  it('sweep removes an untracked straggler (post-crash: tracked set is empty on restart)', async () => {
    const t = await import('../src/main/documents/open-temp');
    await mkdir(t.docOpenTempDir(), { recursive: true });
    const straggler = join(t.docOpenTempDir(), 'orphan.pdf');
    await writeFile(straggler, 'leftover plaintext');
    await t.sweepDocOpenTemp(); // enumerates + shreds even though nothing is in the in-memory tracked set
    expect(await readFile(straggler).catch(() => 'GONE')).toBe('GONE');
    expect(await readdir(t.docOpenTempDir())).toEqual([]);
  });
});
