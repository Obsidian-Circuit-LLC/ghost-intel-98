/**
 * T9: one-time migration of pre-v3.27.0 SOCMINT/X data into the scraping-case stores.
 *
 * Before v3.27.0, harvested social items + job records lived INSIDE each main investigation
 * case dir (`<caseDir>/socmint-items.json`, `<caseDir>/socmint-jobs.json`). v3.27.0 moved that
 * data into self-contained scraping cases under `scraping-cases/<ns>/<id>/` (see paths.ts). This
 * module relocates any existing legacy data exactly once, on startup.
 *
 * Guarantees:
 *  - Marker-guarded + idempotent: once scrapingBackupDir()/../.migrated-v3.27.0 exists the whole
 *    migration is a no-op (`{ migrated: 0, skipped: true }`). Because processed cases have their
 *    legacy files removed, a crash before the marker is written re-runs safely (already-migrated
 *    cases have nothing left to scan; only the unfinished case is retried).
 *  - Deterministic: main cases are processed in sorted id order; which store an item lands in is a
 *    PURE function of the item (`platform === 'x'` → the x store, else the socmint store), never
 *    readdir order or a clock. The injected now()/uuid() are the only nondeterminism, supplied by
 *    the caller (real clock/uuid in prod; fixed counters in tests).
 *  - Reversible: for each source case the split items are COPIED into the new store AND the raw
 *    original files are copied byte-for-byte into scrapingBackupDir()/<caseId>/ BEFORE they are
 *    removed from the main case dir. If either the store copy or the backup fails, the originals
 *    are left in place and the marker is NOT written, so the next launch retries.
 *  - Encrypt-at-rest: fs.readFile / fs.writeFile are the secure-fs layer in production (decrypt on
 *    read, encrypt on write). The backup uses a raw byte copy (fs.copyFile) so an already-encrypted
 *    original stays encrypted in the backup — no plaintext is ever newly written to disk.
 *
 * A scraping case is namespace-scoped (the ns is the on-disk path key, not a record field), so a
 * single source main case that mixed X and non-X items becomes up to TWO scraping cases — one per
 * store that received items — each named after the source main case.
 */

import type { HarvestedItem, SocmintJob } from '@shared/socmint/types';
import type { ScrapingCaseNs } from './paths';
import type { ScrapingCase } from '@shared/types';

/** Legacy sidecar filenames inside a main case dir (fixed across the pre-v3.27.0 versions). */
const LEGACY_ITEMS = 'socmint-items.json';
const LEGACY_JOBS = 'socmint-jobs.json';

export interface ScrapingMigrationFs {
  /** Read raw bytes; throws `code === 'ENOENT'` when absent (secureReadFile in prod). */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write of scraping-case data (secureWriteFile in prod — encrypts at rest). */
  writeFile(path: string, data: string): Promise<void>;
  /** Byte-faithful copy for the reversible backup; preserves the original's at-rest encryption. */
  copyFile(src: string, dst: string): Promise<void>;
  /** Remove a single legacy file (called ONLY after backup + store copy succeed). */
  rm(path: string): Promise<void>;
  /** Immediate child names of a dir; throws `code === 'ENOENT'` when the dir is absent. */
  readdir(path: string): Promise<string[]>;
  /** Existence probe (used for the marker + legacy files). */
  exists(path: string): Promise<boolean>;
  /** Write the done-marker via a raw (non-encrypting) write — independent of vault state. */
  stampMarker(path: string): Promise<void>;
}

export interface ScrapingMigrationPaths {
  casesDir(): string;
  mainCaseFile(caseId: string): string;
  legacyItemsFile(caseId: string): string;
  legacyJobsFile(caseId: string): string;
  scrapingCaseFile(ns: ScrapingCaseNs, id: string): string;
  scrapingItemsFile(ns: ScrapingCaseNs, id: string): string;
  scrapingJobsFile(ns: ScrapingCaseNs, id: string): string;
  backupFile(caseId: string, basename: string): string;
  markerFile(): string;
}

export interface ScrapingMigrationDeps {
  fs: ScrapingMigrationFs;
  paths: ScrapingMigrationPaths;
  /** Injected clock (createdAt/updatedAt on the new scraping cases). */
  now(): number;
  /** Injected id source for new scraping cases. */
  uuid(): string;
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function readArr<T>(fs: ScrapingMigrationFs, path: string): Promise<T[]> {
  try {
    const buf = await fs.readFile(path);
    const parsed = JSON.parse(buf.toString('utf8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
}

/** Name the scraping case after the source main case's record title; fall back to the id. */
async function readCaseName(deps: ScrapingMigrationDeps, caseId: string): Promise<string> {
  try {
    const buf = await deps.fs.readFile(deps.paths.mainCaseFile(caseId));
    const meta = JSON.parse(buf.toString('utf8')) as { title?: unknown };
    const title = typeof meta.title === 'string' ? meta.title.trim() : '';
    return title || caseId;
  } catch {
    return caseId;
  }
}

/** Create one scraping case (case.json + items + optional jobs) in the given namespace store. */
async function writeScrapingCase(
  deps: ScrapingMigrationDeps,
  ns: ScrapingCaseNs,
  id: string,
  name: string,
  items: HarvestedItem[],
  jobs: SocmintJob[],
): Promise<void> {
  const t = deps.now();
  const rec: ScrapingCase = { id, name, createdAt: t, updatedAt: t };
  await deps.fs.writeFile(deps.paths.scrapingCaseFile(ns, id), JSON.stringify(rec, null, 2));
  if (items.length > 0) {
    await deps.fs.writeFile(deps.paths.scrapingItemsFile(ns, id), JSON.stringify(items, null, 2));
  }
  if (jobs.length > 0) {
    await deps.fs.writeFile(deps.paths.scrapingJobsFile(ns, id), JSON.stringify(jobs, null, 2));
  }
}

async function listCaseIds(deps: ScrapingMigrationDeps): Promise<string[]> {
  try {
    // Sorted so the migration is deterministic regardless of readdir iteration order.
    return (await deps.fs.readdir(deps.paths.casesDir())).sort();
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
}

/**
 * Relocate all pre-v3.27.0 SOCMINT/X data into the scraping-case stores. Returns the number of
 * source main cases migrated, and `skipped: true` iff the marker already existed (no-op).
 */
export async function migrateScrapingData(
  deps: ScrapingMigrationDeps,
): Promise<{ migrated: number; skipped: boolean }> {
  const { fs, paths } = deps;

  if (await fs.exists(paths.markerFile())) return { migrated: 0, skipped: true };

  let migrated = 0;
  let allOk = true;

  for (const caseId of await listCaseIds(deps)) {
    const itemsPath = paths.legacyItemsFile(caseId);
    const jobsPath = paths.legacyJobsFile(caseId);
    const hasItems = await fs.exists(itemsPath);
    const hasJobs = await fs.exists(jobsPath);
    if (!hasItems && !hasJobs) continue; // not a socmint-bearing case

    try {
      const items = await readArr<HarvestedItem>(fs, itemsPath);
      const jobs = await readArr<SocmintJob>(fs, jobsPath);

      // Pure platform split — never depends on iteration order or a clock.
      const xItems = items.filter((i) => i.platform === 'x');
      const socItems = items.filter((i) => i.platform !== 'x');

      const name = await readCaseName(deps, caseId);

      // 1) COPY into the new store(s). Jobs carry no platform, so they belong with the socmint
      //    store (the default/"else" store); a jobs-only case still gets a socmint scraping case.
      if (socItems.length > 0 || jobs.length > 0) {
        await writeScrapingCase(deps, 'socmint', deps.uuid(), name, socItems, jobs);
      }
      if (xItems.length > 0) {
        await writeScrapingCase(deps, 'x', deps.uuid(), name, xItems, []);
      }

      // 2) BACK UP the raw originals BEFORE removing them (reversible). Byte-faithful copy keeps
      //    an encrypted original encrypted in the backup.
      if (hasItems) await fs.copyFile(itemsPath, paths.backupFile(caseId, LEGACY_ITEMS));
      if (hasJobs) await fs.copyFile(jobsPath, paths.backupFile(caseId, LEGACY_JOBS));

      // 3) Only now that the store copy AND the backup both succeeded, remove the originals.
      if (hasItems) await fs.rm(itemsPath);
      if (hasJobs) await fs.rm(jobsPath);

      migrated++;
    } catch (err) {
      // Leave this case's originals intact and skip the marker so the next launch retries it.
      allOk = false;
      // eslint-disable-next-line no-console
      console.warn('[scraping-migration] failed for case', caseId, (err as Error).message);
    }
  }

  // Only stamp "done" when every case that had legacy data migrated cleanly. A partial failure
  // leaves the marker unwritten (retry next launch); copy-not-move means no data is lost meanwhile.
  if (allOk) await fs.stampMarker(paths.markerFile());

  return { migrated, skipped: false };
}

// ---- production-wired entry point --------------------------------------
// Lazy imports so this module can be unit-tested without evaluating electron/paths/secure-fs.

/**
 * Production migration: wires the encrypt-at-rest IO layer + real paths, then runs the migration.
 * Safe to call on every startup — the marker makes it a no-op after the first successful run, and a
 * locked/enabled vault surfaces as a per-case failure (marker unwritten) so it retries post-unlock.
 */
export async function migrateScrapingDataIfNeeded(): Promise<{ migrated: number; skipped: boolean }> {
  const [{ join, basename }, nodeFs, paths, { secureReadFile, secureWriteFile }, { randomUUID }] =
    await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
      import('./paths'),
      import('./secure-fs'),
      import('node:crypto'),
    ]);

  const markerFile = (): string => join(paths.scrapingCasesRoot(), '.migrated-v3.27.0');

  const fs: ScrapingMigrationFs = {
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    async copyFile(src, dst) {
      await nodeFs.mkdir(join(dst, '..'), { recursive: true });
      await nodeFs.copyFile(src, dst);
    },
    rm: (p) => nodeFs.rm(p, { force: true }),
    readdir: (p) => nodeFs.readdir(p),
    async exists(p) {
      try {
        await nodeFs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async stampMarker(p) {
      await nodeFs.mkdir(join(p, '..'), { recursive: true });
      await nodeFs.writeFile(p, 'migrated-v3.27.0');
    },
  };

  const migrationPaths: ScrapingMigrationPaths = {
    casesDir: () => paths.casesDir(),
    mainCaseFile: (id) => paths.caseFile(id),
    legacyItemsFile: (id) => join(paths.caseDir(id), LEGACY_ITEMS),
    legacyJobsFile: (id) => join(paths.caseDir(id), LEGACY_JOBS),
    scrapingCaseFile: (ns, id) => paths.scrapingCaseFile(ns, id),
    scrapingItemsFile: (ns, id) => paths.scrapingCaseItemsFile(ns, id),
    scrapingJobsFile: (ns, id) => paths.scrapingCaseJobsFile(ns, id),
    backupFile: (caseId, name) => join(paths.scrapingBackupDir(), caseId, basename(name)),
    markerFile,
  };

  return migrateScrapingData({
    fs,
    paths: migrationPaths,
    now: () => Date.now(),
    uuid: () => randomUUID(),
  });
}
