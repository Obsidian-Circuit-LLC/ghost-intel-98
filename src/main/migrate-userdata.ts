/**
 * One-time userData migration for the Ghost Access 98 → Dead Cyber Society 98 rename.
 *
 * Electron derives app.getPath('userData') from the product name, so renaming the product moved
 * the data directory from %APPDATA%/Ghost Access 98 to %APPDATA%/Dead Cyber Society 98. On the
 * first launch of the renamed build, copy the entire old userData tree into the new (empty) one
 * so existing installs keep all their cases, settings, sticky notes, and the encrypted vault.
 *
 * We COPY (not move), leaving the old directory intact as a safety net. secrets.enc survives the
 * copy because Windows safeStorage/DPAPI is scoped to the OS user account, not the file path.
 *
 * Runs BEFORE ensureDataLayout()/any storage read, and BEFORE the window opens — so Chromium has
 * not yet opened Local Storage / IndexedDB leveldb files (no lock contention). Electron runtime
 * caches are skipped: they're large, machine-specific, and regenerated.
 */

import { app } from 'electron';
import { cp, mkdir, readdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const OLD_PRODUCT_NAME = 'Ghost Access 98';
/** Inner data folder (paths.ts) — its presence in the NEW dir means the rename build already ran. */
const INNER_DATA_DIR = 'GhostAccess98';
const MIGRATION_MARKER = '.migrated-from-ghost-access-98';
/** Regenerated Chromium/Electron caches — never worth copying (and risky to). */
const SKIP = new Set(['Code Cache', 'GPUCache', 'Cache', 'DawnCache', 'DawnGraphiteCache', 'blob_storage', 'Network Persistent State', MIGRATION_MARKER]);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function migrateUserDataIfNeeded(): Promise<void> {
  const newDir = app.getPath('userData');                 // %APPDATA%/Dead Cyber Society 98
  const oldDir = join(dirname(newDir), OLD_PRODUCT_NAME);  // %APPDATA%/Ghost Access 98

  // Dev build (name unchanged) → old and new resolve to the same place; nothing to do.
  if (oldDir === newDir) return;

  const marker = join(newDir, MIGRATION_MARKER);
  if (await exists(marker)) return;                        // already migrated
  if (!(await exists(oldDir))) return;                     // nothing to migrate (fresh install)

  // If the renamed build has already created its own data, never overwrite it — just stamp.
  if (await exists(join(newDir, INNER_DATA_DIR))) { await stamp(marker); return; }

  let entries: string[];
  try { entries = await readdir(oldDir); } catch { return; }
  if (entries.length === 0) return;

  await mkdir(newDir, { recursive: true });
  let allOk = true;
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    try {
      // force:false + errorOnExist:false ⇒ never clobber anything already in the new dir.
      await cp(join(oldDir, entry), join(newDir, entry), { recursive: true, force: false, errorOnExist: false });
    } catch (err) {
      allOk = false;
      // eslint-disable-next-line no-console
      console.warn('[migrate-userdata] failed to copy', entry, (err as Error).message);
    }
  }
  // CRITICAL: only stamp the "done" marker when EVERY entry copied. If any failed (a locked
  // file, disk-full, AV interference), leave the marker unwritten so the next launch retries.
  // The copy is idempotent (force:false/errorOnExist:false re-copies only what's missing), and
  // copy-not-move means the source data is still intact to retry from. Stamping on partial
  // failure would orphan the user's cases/vault behind an empty new dir — silent data loss.
  if (allOk) {
    await stamp(marker);
    // eslint-disable-next-line no-console
    console.log('[migrate-userdata] migrated data from', oldDir, 'to', newDir);
  } else {
    // eslint-disable-next-line no-console
    console.error('[migrate-userdata] partial copy — marker NOT written; will retry next launch');
  }
}

async function stamp(marker: string): Promise<void> {
  try { await writeFile(marker, 'migrated'); } catch { /* best effort — a missing marker just re-checks next launch */ }
}
