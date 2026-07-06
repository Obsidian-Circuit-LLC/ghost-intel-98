import { describe, it, expect, afterEach, vi } from 'vitest';
import { rm, writeFile, mkdir as fsMkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-documents-test');
vi.mock('electron', () => ({ app: { getPath: () => DATA }, shell: { showItemInFolder: vi.fn() } }));

import * as store from '../src/main/documents/store';
import { documentsRoot } from '../src/main/documents/paths';
import { shell } from 'electron';

afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

describe('documents store — core', () => {
  it('creates, lists (folders first), renames, and removes', async () => {
    await store.mkdir('', 'Alpha');
    await store.mkdir('', 'Beta');
    await store.mkdir('Alpha', 'Sub');
    // a plaintext file placed directly (vault off in this file → passthrough)
    await writeFile(join(documentsRoot(), 'note.txt'), 'hi');

    let entries = await store.list('');
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual(['folder:Alpha', 'folder:Beta', 'file:note.txt']);
    expect(entries.find((e) => e.name === 'note.txt')!.size).toBe(2);

    await store.rename('Beta', 'Gamma');
    entries = await store.list('');
    expect(entries.some((e) => e.name === 'Gamma')).toBe(true);
    expect(entries.some((e) => e.name === 'Beta')).toBe(false);

    expect(await store.list('Alpha')).toEqual([expect.objectContaining({ kind: 'folder', name: 'Sub' })]);

    await store.remove('Alpha');
    expect((await store.list('')).some((e) => e.name === 'Alpha')).toBe(false);
  });

  it('list of a missing directory returns []', async () => {
    expect(await store.list('does-not-exist')).toEqual([]);
  });

  it('rejects a rename that collides with an existing entry', async () => {
    await store.mkdir('', 'One');
    await store.mkdir('', 'Two');
    await expect(store.rename('One', 'Two')).rejects.toThrow();
  });

  it('refuses to rename the documents root (empty relPath would move the whole tree out)', async () => {
    await store.mkdir('', 'Secret');
    await expect(store.rename('', 'pwned')).rejects.toThrow(/documents root/i);
    // The root and its contents are untouched.
    expect((await store.list('')).some((e) => e.name === 'Secret')).toBe(true);
  });

  it('refuses to remove the documents root', async () => {
    await store.mkdir('', 'Keep');
    await expect(store.remove('')).rejects.toThrow(/documents root/i);
    expect((await store.list('')).some((e) => e.name === 'Keep')).toBe(true);
  });

  it('mkdir fails (does not silently no-op) when the folder already exists', async () => {
    await store.mkdir('', 'Dup');
    await expect(store.mkdir('', 'Dup')).rejects.toThrow(); // EEXIST — non-recursive fsMkdir
  });

  it('reveal shows the resolved path in the OS file manager', async () => {
    (shell.showItemInFolder as ReturnType<typeof vi.fn>).mockClear();
    await store.mkdir('', 'Shown');
    store.reveal('Shown');
    expect(shell.showItemInFolder).toHaveBeenCalledWith(join(documentsRoot(), 'Shown'));
    // Root reveal resolves to the documents root itself.
    store.reveal('');
    expect(shell.showItemInFolder).toHaveBeenCalledWith(documentsRoot());
  });

  it('confines: an existing symlink escaping the root is refused', async () => {
    const { symlink } = await import('node:fs/promises');
    await fsMkdir(join(tmpdir(), 'dcs98-outside'), { recursive: true });
    await store.mkdir('', 'holder');
    // symlink documents/holder/esc -> /tmp/dcs98-outside (outside the root)
    await symlink(join(tmpdir(), 'dcs98-outside'), join(documentsRoot(), 'holder', 'esc')).catch(() => {});
    // Reading through the escaping link must be refused by confinement.
    await expect(store.list('holder/esc')).rejects.toThrow(/outside|confine/i);
  });
});
