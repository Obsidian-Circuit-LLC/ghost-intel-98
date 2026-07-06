import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-documents-enc-test');
const MAGIC = Buffer.from('ENCX');
vi.mock('electron', () => ({ app: { getPath: () => DATA }, shell: { showItemInFolder: vi.fn() } }));

// Reversible fake vault: encrypt = MAGIC prefix + byte-inverted body; enabled + unlocked.
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff))
  };
});

import * as store from '../src/main/documents/store';
import { documentsRoot } from '../src/main/documents/paths';
import { secureReadFile } from '../src/main/storage/secure-fs';

// Fixture files are written into DATA (the mocked userData dir) before any store op
// would create it, so ensure the scratch dir exists first.
beforeEach(async () => { await mkdir(DATA, { recursive: true }); });
afterEach(async () => { await rm(DATA, { recursive: true, force: true }); });

describe('documents store — encryption at rest', () => {
  it('importDropped writes ciphertext but reads back plaintext; copy preserves ciphertext', async () => {
    const src = join(DATA, 'plain.txt');
    await writeFile(src, 'topsecret');
    await store.importDropped('', [{ sourcePath: src, originalName: 'secret.txt' }]);

    const onDisk = await readFile(join(documentsRoot(), 'secret.txt'));
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX'); // ciphertext on disk
    expect(onDisk.includes(Buffer.from('topsecret'))).toBe(false);

    const roundTrip = await secureReadFile(join(documentsRoot(), 'secret.txt'));
    expect(roundTrip.toString('utf8')).toBe('topsecret'); // decrypts in-app

    await store.mkdir('', 'Copies');
    await store.copy('secret.txt', 'Copies');
    const copied = await readFile(join(documentsRoot(), 'Copies', 'secret.txt'));
    expect(copied.equals(onDisk)).toBe(true); // raw copy → identical ciphertext, not double-encrypted
  });
});
