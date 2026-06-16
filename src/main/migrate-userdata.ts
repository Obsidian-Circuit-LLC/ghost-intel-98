/**
 * One-time userData migration across the product renames:
 *   Ghost Access 98 → Dead Cyber Society 98 → Ghost Intel 98
 *
 * Electron derives app.getPath('userData') from the product name, so each rename moved the data
 * directory (e.g. %APPDATA%/Dead Cyber Society 98 → %APPDATA%/Ghost Intel 98). On the first launch of
 * a renamed build, copy the most recent existing PRIOR userData tree into the new (empty) one so
 * existing installs keep all their cases, settings, sticky notes, and the encrypted vault.
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

// Prior product names, NEWEST FIRST. The current productName is "Ghost Intel 98"; we migrate from the
// most recent of these that still exists on disk (a user upgrading from Dead Cyber Society 98 brings
// that data forward; one who somehow skipped straight from Ghost Access 98 is still covered).
const OLD_PRODUCT_NAMES = ['Dead Cyber Society 98', 'Ghost Access 98'];
/** Inner data folder (paths.ts) — its presence in the NEW dir means the renamed build already ran.
 *  This inner name is fixed across product renames, so it's the reliable "already initialised" sentinel. */
const INNER_DATA_DIR = 'GhostAccess98';
const MIGRATION_MARKER = '.migrated-from-prior-name';
/** Regenerated Chromium/Electron caches — never worth copying (and risky to). Also skip an older
 *  rename marker so it isn't mistaken for data. */
const SKIP = new Set(['Code Cache', 'GPUCache', 'Cache', 'DawnCache', 'DawnGraphiteCache', 'blob_storage', 'Network Persistent State', MIGRATION_MARKER, '.migrated-from-ghost-access-98']);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function migrateUserDataIfNeeded(): Promise<void> {
  const newDir = app.getPath('userData');                 // %APPDATA%/Ghost Intel 98

  const marker = join(newDir, MIGRATION_MARKER);
  if (await exists(marker)) return;                        // already migrated
  // If the renamed build has already created its own data, never overwrite it — just stamp.
  if (await exists(join(newDir, INNER_DATA_DIR))) { await stamp(marker); return; }

  // Find the most recent prior-name dir that exists and isn't the same as newDir (dev build, where
  // the productName is unchanged so old and new resolve to the same place).
  let oldDir: string | null = null;
  for (const name of OLD_PRODUCT_NAMES) {
    const cand = join(dirname(newDir), name);
    if (cand === newDir) continue;
    if (await exists(cand)) { oldDir = cand; break; }
  }
  if (!oldDir) return;                                     // fresh install / nothing to migrate

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
