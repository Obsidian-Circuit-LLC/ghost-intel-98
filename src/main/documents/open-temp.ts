/**
 * Session-scoped plaintext staging for My Documents "Open". Decrypted bytes are written to an
 * app-dedicated temp dir so the OS default app can read them; every staged temp is tracked and
 * shredded (overwrite-then-unlink) on quit, and the whole dir is swept on startup — so a crash
 * bounds plaintext exposure to "until next launch", never indefinitely. Distinct from the Shred
 * recycle-bin store (shredStore), which is soft-delete/restore for case data.
 */
import { app } from 'electron';
import { join, extname } from 'node:path';
import { writeFile, rm, mkdir, stat, readdir, open as fsOpen } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const tracked = new Set<string>();

export function docOpenTempDir(): string {
  return join(app.getPath('temp'), 'ga98-docopen');
}

/** Startup: OVERWRITE-then-remove any stragglers a prior crash left (the tracked set is in-memory and
 *  empty after a restart, so a bare unlink would leave the previous session's decrypted plaintext
 *  undelete-recoverable). Then recreate an owner-only dir. This is what makes the sweep a real shred. */
export async function sweepDocOpenTemp(): Promise<void> {
  try {
    for (const name of await readdir(docOpenTempDir())) await shredOne(join(docOpenTempDir(), name));
  } catch { /* dir absent — nothing to shred */ }
  await rm(docOpenTempDir(), { recursive: true, force: true });
  await mkdir(docOpenTempDir(), { recursive: true, mode: 0o700 });
  tracked.clear();
}

/** Write decrypted bytes to a random-named temp preserving origName's extension; track for shred.
 *  Owner-only perms (0o600 file / 0o700 dir) so the plaintext isn't world-readable on a shared /tmp
 *  (the roadmapped Linux target; on Windows per-user %TEMP% the mode is a harmless no-op). */
export async function stageDecryptedTemp(bytes: Buffer, origName: string): Promise<string> {
  await mkdir(docOpenTempDir(), { recursive: true, mode: 0o700 });
  const temp = join(docOpenTempDir(), `${randomUUID()}${extname(origName)}`);
  await writeFile(temp, bytes, { mode: 0o600 });
  tracked.add(temp);
  return temp;
}

async function shredOne(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (s.size > 0) {
      const fh = await fsOpen(path, 'r+');
      try { await fh.write(randomBytes(s.size), 0, s.size, 0); await fh.sync(); } finally { await fh.close(); }
    }
  } catch { /* gone or locked — startup sweep is the backstop */ }
  try { await rm(path, { force: true }); } catch { /* locked — swept next launch */ }
}

/** before-quit: shred every tracked temp, then remove the dir. Best-effort; sweep is the guarantee. */
export async function shredDocOpenTemps(): Promise<void> {
  for (const p of tracked) await shredOne(p);
  tracked.clear();
  try { await rm(docOpenTempDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
}
