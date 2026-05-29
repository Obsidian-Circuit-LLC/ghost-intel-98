import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-securefs-test' } }));

import * as vault from '../src/main/services/vault';
import { secureReadText, secureWriteFile } from '../src/main/storage/secure-fs';

const DIR = '/tmp/ga98-securefs-test';
afterEach(async () => { vault.lock(); await rm(DIR, { recursive: true, force: true }); });

describe('secure-fs', () => {
  it('passes through plaintext when the vault is disabled', async () => {
    await mkdir(DIR, { recursive: true });
    const p = join(DIR, 'a.json');
    await secureWriteFile(p, '{"x":1}');
    const onDisk = await readFile(p);
    expect(onDisk.toString()).toBe('{"x":1}');
    expect(vault.isEncrypted(onDisk)).toBe(false);
    expect(await secureReadText(p)).toBe('{"x":1}');
  });

  it('encrypts on write and decrypts on read when unlocked', async () => {
    await mkdir(DIR, { recursive: true });
    await vault.setup('pw');
    const p = join(DIR, 'b.json');
    await secureWriteFile(p, 'secret');
    const onDisk = await readFile(p);
    expect(vault.isEncrypted(onDisk)).toBe(true);
    expect(onDisk.includes(Buffer.from('secret'))).toBe(false);
    expect(await secureReadText(p)).toBe('secret');
  }, 30000);

  it('refuses to read an encrypted blob while locked', async () => {
    await mkdir(DIR, { recursive: true });
    await vault.setup('pw');
    const p = join(DIR, 'c.json');
    await secureWriteFile(p, 'locked-data');
    vault.lock();
    await expect(secureReadText(p)).rejects.toThrow();
  }, 30000);
});
