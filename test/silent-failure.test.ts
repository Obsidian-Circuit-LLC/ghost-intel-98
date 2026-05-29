/**
 * Regression guards for the silent-failure findings: encrypted reads must NOT collapse a locked
 * vault or a failed GCM authentication tag (tamper / corruption) into a generic "couldn't read"
 * (attachments) or "no image" (bio photos). For a forensic tool, the tamper signal is the point.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-silentfail-test' } }));

import * as vault from '../src/main/services/vault';
import { fileStore } from '../src/main/storage/json-fs';
import * as bio from '../src/main/storage/bio-images';
import { secureWriteFile } from '../src/main/storage/secure-fs';

const ROOT = '/tmp/ga98-silentfail-test';
const DATA = join(ROOT, 'GhostAccess98');
const CASE = '44444444-4444-4444-8444-dddddddddddd';
const ATT_DIR = join(DATA, 'cases', CASE, 'attachments');

afterEach(async () => { vault.lock(); vault.endMigration(); await rm(ROOT, { recursive: true, force: true }); });

describe('silent-failure regression guards', () => {
  it('readAttachmentText reports `locked`, not `read-error`, when the vault is locked', async () => {
    await vault.setup('pw');
    await mkdir(ATT_DIR, { recursive: true });
    await secureWriteFile(join(ATT_DIR, 'note.txt'), 'classified body text');
    vault.lock();
    const r = await fileStore.readAttachmentText(CASE, 'note.txt');
    expect(r.text).toBeNull();
    expect(r.reason).toBe('locked');
  }, 30000);

  it('readAttachmentText reports `decrypt-failed` on a corrupted authentication tag', async () => {
    await vault.setup('pw');
    await mkdir(ATT_DIR, { recursive: true });
    const path = join(ATT_DIR, 'note.txt');
    await secureWriteFile(path, 'classified body text');
    // Flip a byte inside the GCM tag (magic[8] + iv[12] → tag starts at offset 20) so the magic
    // still marks it encrypted but decryption fails its authentication check.
    const blob = await readFile(path);
    blob[21] ^= 0xff;
    await writeFile(path, blob);
    const r = await fileStore.readAttachmentText(CASE, 'note.txt');
    expect(r.text).toBeNull();
    expect(r.reason).toBe('decrypt-failed');
  }, 30000);

  it('readAttachmentBytes reports `decrypt-failed` on corruption (not out-of-range/read-error)', async () => {
    await vault.setup('pw');
    await mkdir(ATT_DIR, { recursive: true });
    const path = join(ATT_DIR, 'blob.bin');
    await secureWriteFile(path, Buffer.from('0123456789'));
    const blob = await readFile(path);
    blob[blob.length - 1] ^= 0xff; // corrupt the ciphertext
    await writeFile(path, blob);
    const r = await fileStore.readAttachmentBytes(CASE, 'blob.bin', 0, 10);
    expect(r.base64).toBeNull();
    expect(r.reason).toBe('decrypt-failed');
  }, 30000);

  it('readOriginalDataUri surfaces a corrupted original as decrypt-failed, not silent null', async () => {
    await vault.setup('pw');
    const img = await bio.add(CASE, {
      originalName: 'face.png', mime: 'image/png', width: 1, height: 1,
      originalBase64: Buffer.from('not-a-real-png-but-bytes').toString('base64'),
      thumbBase64: Buffer.from('thumb-bytes').toString('base64')
    });
    // Corrupt the encrypted ORIGINAL (index stays intact + readable) so we exercise the image
    // read path specifically — the catch that previously masked this as `return null`.
    const p = bio.originalAbsolutePath(CASE, img.fileName);
    const blob = await readFile(p);
    blob[blob.length - 1] ^= 0xff;
    await writeFile(p, blob);
    await expect(bio.readOriginalDataUri(CASE, img.id)).rejects.toMatchObject({ code: 'EDECRYPT' });
  }, 30000);
});
