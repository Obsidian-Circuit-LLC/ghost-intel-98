/**
 * Bulk encrypt/decrypt migration over the whole data root, run when the user enables or
 * disables login. Uses vault primitives + raw fs directly (NOT secure-fs): the decrypt pass
 * runs while the vault is still unlocked, where the shim would wrongly re-encrypt on write.
 *
 * Both passes are idempotent via the magic-byte prefix — encryptAll skips already-ciphertext
 * files, decryptAll skips already-plaintext ones — so a crash mid-migration leaves a mixed
 * tree the shim still reads per-file, and re-running simply finishes the remainder.
 *
 * Deliberate exclusions (kept plaintext): auth.json (the wrapped DEK itself), secrets.enc
 * (OS-keyring/DPAPI blob), settings.json (the lock screen renders theme/wallpaper pre-unlock),
 * plus transient *.tmp and ._* render artifacts. Exclusions match by absolute path so an
 * attachment coincidentally named "settings.json" is still encrypted.
 */
import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vault from '../services/vault';
import { dataRoot, settingsFile, secretsFile } from './paths';

function excludedPaths(): Set<string> {
  const root = dataRoot();
  return new Set([join(root, 'auth.json'), secretsFile(), settingsFile()]);
}

function isTransient(name: string): boolean {
  return name.endsWith('.tmp') || name.startsWith('._');
}

async function* walkFiles(dir: string, skip: Set<string>): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir doesn't exist yet — nothing to migrate
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) { yield* walkFiles(abs, skip); continue; }
    if (isTransient(e.name) || skip.has(abs)) continue;
    yield abs;
  }
}

async function atomicWrite(path: string, buf: Buffer): Promise<void> {
  const tmp = `${path}.mig.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

/** Encrypt every plaintext file under the data root in place. Vault must be unlocked. */
export async function encryptAll(): Promise<{ processed: number; skipped: number }> {
  if (!vault.isUnlocked()) throw new Error('Vault must be unlocked to encrypt data.');
  const skip = excludedPaths();
  let processed = 0;
  let skipped = 0;
  for await (const path of walkFiles(dataRoot(), skip)) {
    const raw = await readFile(path);
    if (vault.isEncrypted(raw)) { skipped++; continue; }
    await atomicWrite(path, vault.encryptBuffer(raw));
    processed++;
  }
  return { processed, skipped };
}

/** Decrypt every encrypted file under the data root in place. Vault must still be unlocked
 *  (the DEK is needed); the caller removes auth.json + locks AFTER this resolves. */
export async function decryptAll(): Promise<{ processed: number; skipped: number }> {
  if (!vault.isUnlocked()) throw new Error('Vault must be unlocked to decrypt data.');
  const skip = excludedPaths();
  let processed = 0;
  let skipped = 0;
  for await (const path of walkFiles(dataRoot(), skip)) {
    const raw = await readFile(path);
    if (!vault.isEncrypted(raw)) { skipped++; continue; }
    await atomicWrite(path, vault.decryptBuffer(raw));
    processed++;
  }
  return { processed, skipped };
}
