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
import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vault from '../services/vault';

/** Cheap magic-byte probe: reads only the envelope header (8 bytes), not the whole file.
 *  Lets the positional attachment readers keep their pread() fast-path for plaintext and
 *  fall back to whole-file decrypt only when a blob is actually encrypted. */
export async function isEncryptedFile(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(8);
    const { bytesRead } = await fh.read(head, 0, 8, 0);
    // Magic-prefix check only — the 8-byte head can't satisfy isEncrypted's full-envelope
    // length test, so using isEncrypted here would (and did) always return false.
    return vault.hasMagicPrefix(head.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Error codes set on throws from secureReadFile so callers can distinguish a locked vault and
 *  a failed authentication tag (tamper / corruption) from an ordinary filesystem error. */
export const EVAULTLOCKED = 'EVAULTLOCKED';
export const EDECRYPT = 'EDECRYPT';

export async function secureReadFile(path: string): Promise<Buffer> {
  const raw = await readFile(path);
  if (vault.isEncrypted(raw)) {
    if (!vault.isUnlocked()) {
      const e = new Error('Locked — unlock the app to read encrypted data.') as Error & { code?: string };
      e.code = EVAULTLOCKED;
      throw e;
    }
    try {
      return vault.decryptBuffer(raw);
    } catch (err) {
      // A GCM tag failure here means the ciphertext was truncated, corrupted, or tampered —
      // a signal a forensic tool must surface, never mask as a generic read error.
      const e = new Error(`Decryption failed (authentication tag mismatch): ${(err as Error).message}`) as Error & { code?: string };
      e.code = EDECRYPT;
      throw e;
    }
  }
  return raw;
}

export async function secureReadText(path: string): Promise<string> {
  return (await secureReadFile(path)).toString('utf8');
}

export async function secureWriteFile(path: string, data: Buffer | string): Promise<void> {
  // Choke-point invariant: never write PLAINTEXT into an enabled-but-locked tree. The DEK is
  // absent so we can't encrypt; writing plaintext would corrupt the encrypted corpus with
  // cleartext. Refusing here is defence-in-depth independent of the IPC lock gate (#4).
  if (vault.isEnabledCached() && !vault.isUnlocked()) {
    const e = new Error('Locked — cannot write while the vault is locked.') as Error & { code?: string };
    e.code = EVAULTLOCKED;
    throw e;
  }
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  // shouldEncrypt() (not isUnlocked()) so a write racing a disable sweep stays plaintext and
  // can't be orphaned under a DEK that removeAuth is about to destroy. Decided synchronously.
  const out = vault.shouldEncrypt() ? vault.encryptBuffer(buf) : buf;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, path);
}
