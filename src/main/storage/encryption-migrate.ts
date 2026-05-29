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
import { readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
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

/** Yield every *.tmp / ._* under the data root. These are atomic-write temps; a live one is
 *  renamed within the same tick, so any temp present at a quiescent migration is crash debris. */
async function* walkTemps(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) { yield* walkTemps(abs); continue; }
    if (isTransient(e.name)) yield abs;
  }
}

/** Remove orphaned atomic-write temp files. The encrypt sweep skips *.tmp (a half-written
 *  temp must not be encrypted mid-flight), so without this an abandoned PLAINTEXT temp from a
 *  crashed write would survive enabling encryption — a cleartext leak (red-team finding B). */
export async function cleanupOrphanTemps(): Promise<number> {
  let removed = 0;
  for await (const path of walkTemps(dataRoot())) {
    await rm(path, { force: true });
    removed++;
  }
  return removed;
}

export interface MigrationResult {
  processed: number;
  skipped: number;
  /** Per-file failures. A non-empty list means the pass did NOT fully complete — the caller must
   *  treat the migration as incomplete (leave the enable marker set / do not removeAuth). */
  failed: { path: string; error: string }[];
}

/** Encrypt every plaintext file under the data root in place. Vault must be unlocked.
 *  Resilient: a single unreadable file is collected into `failed`, not thrown — one bad file
 *  must never abort the whole pass and silently leave the rest plaintext under an enabled vault. */
export async function encryptAll(): Promise<MigrationResult> {
  if (!vault.isUnlocked()) throw new Error('Vault must be unlocked to encrypt data.');
  await cleanupOrphanTemps(); // purge plaintext crash-debris temps before they become a leak
  const skip = excludedPaths();
  let processed = 0;
  let skipped = 0;
  const failed: { path: string; error: string }[] = [];
  for await (const path of walkFiles(dataRoot(), skip)) {
    try {
      const raw = await readFile(path);
      if (vault.isEncrypted(raw)) { skipped++; continue; }
      await atomicWrite(path, vault.encryptBuffer(raw));
      processed++;
    } catch (err) {
      failed.push({ path, error: (err as Error).message });
    }
  }
  return { processed, skipped, failed };
}

/** Decrypt every encrypted file under the data root in place. Vault must still be unlocked
 *  (the DEK is needed); the caller removes auth.json + locks AFTER this resolves — and ONLY if
 *  `failed` is empty, else a still-encrypted file would orphan under the destroyed DEK. */
export async function decryptAll(): Promise<MigrationResult> {
  if (!vault.isUnlocked()) throw new Error('Vault must be unlocked to decrypt data.');
  const skip = excludedPaths();
  let processed = 0;
  let skipped = 0;
  const failed: { path: string; error: string }[] = [];
  for await (const path of walkFiles(dataRoot(), skip)) {
    try {
      const raw = await readFile(path);
      if (!vault.isEncrypted(raw)) { skipped++; continue; }
      await atomicWrite(path, vault.decryptBuffer(raw));
      processed++;
    } catch (err) {
      failed.push({ path, error: (err as Error).message });
    }
  }
  return { processed, skipped, failed };
}
