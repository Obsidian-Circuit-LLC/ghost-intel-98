/**
 * Transparent at-rest encryption IO layer. Every store routes case-data file reads/writes
 * through here instead of node:fs, so encrypt-at-rest is applied in ONE auditable place.
 *
 * Behaviour by vault state:
 *  - vault unlocked  → writes encrypt (vault.encryptBuffer); reads decrypt if the blob is
 *                      encrypted (magic-byte detected), else pass through.
 *  - vault locked but a blob is encrypted → read throws (the app gates the UI behind unlock;
 *                      this is defence-in-depth).
 *  - vault disabled (no login) → pure passthrough (plaintext on disk, today's behaviour).
 *
 * Magic-byte detection means plaintext (pre-migration / disabled) and ciphertext files
 * coexist safely, which is what makes the enable/disable migration resumable.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vault from '../services/vault';

export async function secureReadFile(path: string): Promise<Buffer> {
  const raw = await readFile(path);
  if (vault.isEncrypted(raw)) {
    if (!vault.isUnlocked()) throw new Error('Locked — unlock the app to read encrypted data.');
    return vault.decryptBuffer(raw);
  }
  return raw;
}

export async function secureReadText(path: string): Promise<string> {
  return (await secureReadFile(path)).toString('utf8');
}

export async function secureWriteFile(path: string, data: Buffer | string): Promise<void> {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const out = vault.isUnlocked() ? vault.encryptBuffer(buf) : buf;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, path);
}
