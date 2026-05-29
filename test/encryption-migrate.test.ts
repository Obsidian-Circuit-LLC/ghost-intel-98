import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-migrate-test' } }));

import * as vault from '../src/main/services/vault';
import { encryptAll, decryptAll } from '../src/main/storage/encryption-migrate';

const ROOT = '/tmp/ga98-migrate-test';
const DATA = join(ROOT, 'GhostAccess98');
const caseJson = join(DATA, 'cases', 'c1', 'case.json');
const accountsJson = join(DATA, 'mail-accounts.json');
const settings = join(DATA, 'settings.json');
const authJson = join(DATA, 'auth.json');
const tmpFile = join(DATA, 'scratch.tmp');

async function seed(): Promise<void> {
  await mkdir(join(DATA, 'cases', 'c1'), { recursive: true });
  await writeFile(caseJson, JSON.stringify({ id: 'c1', title: 'Target Dossier' }), 'utf8');
  await writeFile(accountsJson, JSON.stringify([{ id: 'a1', email: 'x@y.z' }]), 'utf8');
  await writeFile(settings, JSON.stringify({ wallpaperColor: '#008080' }), 'utf8');
  await writeFile(tmpFile, 'transient', 'utf8');
}

afterEach(async () => { vault.lock(); await rm(ROOT, { recursive: true, force: true }); });

describe('encryption migration walker', () => {
  it('encrypts case data, skips settings/auth/tmp, and round-trips on decrypt', async () => {
    await seed();
    await vault.setup('pw');                              // creates auth.json, unlocks
    const enc = await encryptAll();
    expect(enc.processed).toBeGreaterThanOrEqual(2);      // case.json + mail-accounts.json

    expect(vault.isEncrypted(await readFile(caseJson))).toBe(true);
    expect(vault.isEncrypted(await readFile(accountsJson))).toBe(true);
    expect(vault.isEncrypted(await readFile(settings))).toBe(false);  // excluded
    expect(vault.isEncrypted(await readFile(authJson))).toBe(false);  // excluded
    expect((await readFile(tmpFile)).toString()).toBe('transient');   // transient, untouched

    // idempotent: a second pass re-encrypts nothing
    expect((await encryptAll()).processed).toBe(0);

    // decrypt restores the original plaintext byte-for-byte
    expect((await decryptAll()).processed).toBeGreaterThanOrEqual(2);
    expect(JSON.parse((await readFile(caseJson)).toString()).title).toBe('Target Dossier');
    expect(vault.isEncrypted(await readFile(caseJson))).toBe(false);
  }, 30000);

  it('refuses to run while locked', async () => {
    await seed();
    await vault.setup('pw');
    vault.lock();
    await expect(encryptAll()).rejects.toThrow();
    await expect(decryptAll()).rejects.toThrow();
  }, 30000);
});
