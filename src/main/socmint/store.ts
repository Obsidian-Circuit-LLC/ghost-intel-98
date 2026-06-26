/**
 * Encrypted per-case SOCMINT store.
 *
 * Public API (for tests + IPC layer):
 *   makeSocmintStore(deps)  — factory with injected fs; use directly in tests.
 *   upsertItems / listItems / recordJob / listJobs — production-wired top-level exports
 *     (lazy-initialized; safe to import without electron being available at import time).
 *
 * Sidecars per case:
 *   <caseDir>/<caseId>/socmint-items.json
 *   <caseDir>/<caseId>/socmint-jobs.json
 *
 * Every read-modify-write is serialised with withLock(caseId) so concurrent IPC
 * calls cannot produce duplicate items or corrupt the file.
 */

import type { HarvestedItem, SocmintJob } from '@shared/socmint/types';
import { withLock } from '../util/mutex';

// ---- injectable fs interface (injection seam for tests) ----------------

export interface SocmintStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  /** Resolve the items sidecar path for a case. */
  itemsPath(caseId: string): string;
  /** Resolve the jobs sidecar path for a case. */
  jobsPath(caseId: string): string;
}

// ---- helpers -----------------------------------------------------------

async function readJsonArr<T>(
  deps: Pick<SocmintStoreDeps, 'readFile'>,
  path: string,
): Promise<T[]> {
  try {
    const buf = await deps.readFile(path);
    return JSON.parse(buf.toString('utf8')) as T[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function writeJsonArr<T>(
  deps: Pick<SocmintStoreDeps, 'writeFile'>,
  path: string,
  list: T[],
): Promise<void> {
  await deps.writeFile(path, JSON.stringify(list, null, 2));
}

// ---- factory -----------------------------------------------------------

/** Create a store instance bound to the supplied deps.
 *  For tests: pass an in-memory SocmintStoreDeps.
 *  For production: pass the real secure-fs + caseDir-derived paths. */
export function makeSocmintStore(deps: SocmintStoreDeps) {
  return {
    /**
     * Upsert items into the case store.  Items whose `id` is already present are
     * skipped (exact-id dedup); new items are appended in the order supplied.
     */
    async upsertItems(
      caseId: string,
      items: HarvestedItem[],
    ): Promise<{ added: number; skipped: number }> {
      return withLock(`socmint:${caseId}`, async () => {
        const p = deps.itemsPath(caseId);
        const existing = await readJsonArr<HarvestedItem>(deps, p);
        const seenIds = new Set(existing.map((i) => i.id));
        let added = 0;
        let skipped = 0;
        for (const item of items) {
          if (seenIds.has(item.id)) {
            skipped++;
          } else {
            existing.push(item);
            seenIds.add(item.id);
            added++;
          }
        }
        if (added > 0) {
          await writeJsonArr(deps, p, existing);
        }
        return { added, skipped };
      });
    },

    /** Return all items for a case in stable (append) order. */
    async listItems(caseId: string): Promise<HarvestedItem[]> {
      return withLock(`socmint:${caseId}`, () =>
        readJsonArr<HarvestedItem>(deps, deps.itemsPath(caseId)),
      );
    },

    /** Append a job record to the case jobs sidecar. */
    async recordJob(caseId: string, job: SocmintJob): Promise<void> {
      return withLock(`socmint:${caseId}`, async () => {
        const p = deps.jobsPath(caseId);
        const jobs = await readJsonArr<SocmintJob>(deps, p);
        jobs.push(job);
        await writeJsonArr(deps, p, jobs);
      });
    },

    /** Return all job records for a case in append order. */
    async listJobs(caseId: string): Promise<SocmintJob[]> {
      return withLock(`socmint:${caseId}`, () =>
        readJsonArr<SocmintJob>(deps, deps.jobsPath(caseId)),
      );
    },
  };
}

// ---- production-wired top-level exports --------------------------------
// Lazy: deps are resolved only on first call so importing this module in tests
// that do NOT mock electron is safe (electron/paths/secure-fs are never
// evaluated at module-import time).  Tests should use makeSocmintStore(testDeps).

let _prod: ReturnType<typeof makeSocmintStore> | null = null;

async function prod(): Promise<ReturnType<typeof makeSocmintStore>> {
  if (_prod) return _prod;
  const [{ join }, { caseDir }, { secureReadFile, secureWriteFile }] = await Promise.all([
    import('node:path'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
  ]);
  _prod = makeSocmintStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    itemsPath: (id) => join(caseDir(id), 'socmint-items.json'),
    jobsPath:  (id) => join(caseDir(id), 'socmint-jobs.json'),
  });
  return _prod;
}

export async function upsertItems(
  caseId: string,
  items: HarvestedItem[],
): Promise<{ added: number; skipped: number }> {
  return (await prod()).upsertItems(caseId, items);
}

export async function listItems(caseId: string): Promise<HarvestedItem[]> {
  return (await prod()).listItems(caseId);
}

export async function recordJob(caseId: string, job: SocmintJob): Promise<void> {
  return (await prod()).recordJob(caseId, job);
}

export async function listJobs(caseId: string): Promise<SocmintJob[]> {
  return (await prod()).listJobs(caseId);
}
