/**
 * Session-scoped plaintext staging for My Documents "Open". Decrypted bytes are written to an
 * app-dedicated temp dir so the OS default app can read them; every staged temp is tracked and
 * shredded (overwrite-then-unlink) on quit, and the whole dir is swept on startup — so a crash
 * bounds plaintext exposure to "until next launch", never indefinitely. Distinct from the Shred
 * recycle-bin store (shredStore), which is soft-delete/restore for case data.
 */
import { app } from 'electron';
import { join, extname } from 'node:path';
import { writeFile, rm, mkdir, stat, open as fsOpen } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const tracked = new Set<string>();

export function docOpenTempDir(): string {
  return join(app.getPath('temp'), 'ga98-docopen');
}

/** Startup: wipe any stragglers a prior crash left, then recreate an empty dir. */
export async function sweepDocOpenTemp(): Promise<void> {
  await rm(docOpenTempDir(), { recursive: true, force: true });
  await mkdir(docOpenTempDir(), { recursive: true });
  tracked.clear();
}

/** Write decrypted bytes to a random-named temp preserving origName's extension; track for shred. */
export async function stageDecryptedTemp(bytes: Buffer, origName: string): Promise<string> {
  await mkdir(docOpenTempDir(), { recursive: true });
  const temp = join(docOpenTempDir(), `${randomUUID()}${extname(origName)}`);
  await writeFile(temp, bytes);
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
