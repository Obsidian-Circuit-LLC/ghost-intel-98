import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-retrofit-test' } }));

import * as vault from '../src/main/services/vault';
import * as ent from '../src/main/storage/entities';
import * as wb from '../src/main/storage/whiteboard';

const ROOT = '/tmp/ga98-retrofit-test';
const DATA = join(ROOT, 'GhostAccess98');
const REGISTRY = join(DATA, 'entities.json');
const CASE = '33333333-3333-4333-8333-cccccccccccc';
const boardPath = join(DATA, 'cases', CASE, 'whiteboard.json');

afterEach(async () => { vault.lock(); await rm(ROOT, { recursive: true, force: true }); });

describe('store retrofit — encrypt-at-rest through real stores', () => {
  it('writes PLAINTEXT when the vault is disabled (today behaviour preserved)', async () => {
    await ent.create({ type: 'person', value: 'Plain Target' });
    const raw = await readFile(REGISTRY);
    expect(vault.isEncrypted(raw)).toBe(false);
    expect(raw.toString('utf8')).toContain('Plain Target');
  });

  it('encrypts the registry on disk and round-trips when unlocked', async () => {
    await vault.setup('correct horse battery');
    const e = await ent.create({ type: 'person', value: 'Secret Target' });
    const raw = await readFile(REGISTRY);
    expect(vault.isEncrypted(raw)).toBe(true);                       // ciphertext on disk
    expect(raw.includes(Buffer.from('Secret Target'))).toBe(false);  // value not leaked
    const all = await ent.listAll();                                 // transparent decrypt
    expect(all.some((x) => x.id === e.id && x.value === 'Secret Target')).toBe(true);
  }, 30000);

  it('encrypts the whiteboard sidecar and round-trips when unlocked', async () => {
    await vault.setup('pw');
    await wb.write(CASE, { nodes: [], edges: [] });
    expect(vault.isEncrypted(await readFile(boardPath))).toBe(true);
    expect(await wb.read(CASE)).toEqual({ nodes: [], edges: [] });
  }, 30000);

  it('refuses to read the encrypted registry once locked', async () => {
    await vault.setup('pw');
    await ent.create({ type: 'person', value: 'Locked Target' });
    vault.lock();
    await expect(ent.listAll()).rejects.toThrow();
  }, 30000);
});
