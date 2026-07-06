import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-documents-transfer-test');
vi.mock('electron', () => ({ app: { getPath: () => DATA }, shell: { showItemInFolder: vi.fn() } }));

import * as store from '../src/main/documents/store';
import { documentsRoot } from '../src/main/documents/paths';

// Fixture files are written into DATA (the mocked userData dir) before any store op
// would create it, so ensure the scratch dir exists first.
beforeEach(async () => { await mkdir(DATA, { recursive: true }); });
afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

describe('documents store — transfer', () => {
  it('copies a file into another folder, uniquing on collision', async () => {
    await store.mkdir('', 'Dst');
    await writeFile(join(documentsRoot(), 'a.txt'), 'one');
    const p1 = await store.copy('a.txt', 'Dst');
    expect(p1).toBe('Dst/a.txt');
    const p2 = await store.copy('a.txt', 'Dst'); // collision
    expect(p2).toBe('Dst/a (1).txt');
    expect((await store.list('Dst')).map((e) => e.name).sort()).toEqual(['a (1).txt', 'a.txt']);
  });

  it('copies a folder recursively', async () => {
    await store.mkdir('', 'Src');
    await store.mkdir('Src', 'Inner');
    await writeFile(join(documentsRoot(), 'Src', 'Inner', 'x.txt'), 'x');
    await store.mkdir('', 'Into');
    const p = await store.copy('Src', 'Into');
    expect(p).toBe('Into/Src');
    expect(await readFile(join(documentsRoot(), 'Into', 'Src', 'Inner', 'x.txt'), 'utf8')).toBe('x');
  });

  it('moves a file (removes the source)', async () => {
    await store.mkdir('', 'Box');
    await writeFile(join(documentsRoot(), 'm.txt'), 'm');
    const p = await store.move('m.txt', 'Box');
    expect(p).toBe('Box/m.txt');
    expect((await store.list('')).some((e) => e.name === 'm.txt')).toBe(false);
  });

  it('refuses to move a folder into its own descendant', async () => {
    await store.mkdir('', 'Parent');
    await store.mkdir('Parent', 'Child');
    await expect(store.move('Parent', 'Parent/Child')).rejects.toThrow(/descendant|into itself/i);
  });

  it('refuses to copy a folder into its own descendant (guards against fs.cp recursion)', async () => {
    await store.mkdir('', 'Root');
    await store.mkdir('Root', 'Leaf');
    await expect(store.copy('Root', 'Root/Leaf')).rejects.toThrow(/descendant|into itself/i);
  });

  it('imports dropped host files under their real names, uniquing collisions', async () => {
    const src1 = join(DATA, 'drop1.bin');
    const src2 = join(DATA, 'drop2.bin');
    await writeFile(src1, 'DROP1');
    await writeFile(src2, 'DROP2');
    await store.mkdir('', 'Inbox');
    const r = await store.importDropped('Inbox', [
      { sourcePath: src1, originalName: 'dup.bin' },
      { sourcePath: src2, originalName: 'dup.bin' }
    ]);
    expect(r.failures).toEqual([]);
    expect(r.imported.map((e) => e.name).sort()).toEqual(['dup (1).bin', 'dup.bin']);
    expect(await readFile(join(documentsRoot(), 'Inbox', 'dup.bin'), 'utf8')).toBe('DROP1');
  });

  it('records a failure for an unreadable source without aborting the batch', async () => {
    const ok = join(DATA, 'ok.bin');
    await writeFile(ok, 'OK');
    const r = await store.importDropped('', [
      { sourcePath: join(DATA, 'missing.bin'), originalName: 'missing.bin' },
      { sourcePath: ok, originalName: 'ok.bin' }
    ]);
    expect(r.imported.map((e) => e.name)).toEqual(['ok.bin']);
    expect(r.failures.map((f) => f.originalName)).toEqual(['missing.bin']);
  });
});
