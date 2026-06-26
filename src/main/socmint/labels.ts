/**
 * Analyst label-capture for SOCMINT items (spec §6 / decision 8).
 *
 * Persists accept/reject decisions and optional entity corrections so a future
 * local-only fine-tune is possible.  v1 only captures; no training runs here.
 *
 * Public API (for tests + IPC layer):
 *   makeLabelStore(deps)  — factory with injected fs; use directly in tests.
 *   recordLabel / listLabels — production-wired top-level exports (lazy-init).
 *
 * Sidecar per case:
 *   <caseDir>/<caseId>/socmint-labels.json
 *
 * Every read-modify-write is serialised with withLock(caseId) so concurrent IPC
 * calls cannot corrupt the file.  Encrypted at rest via the secure-fs adapter.
 */

import { withLock } from '../util/mutex';

// ---- public types -----------------------------------------------------

export interface ItemLabel {
  itemId: string;
  decision: 'accept' | 'reject';
  entityCorrections?: { kind: string; value: string }[];
  labeledAt: string;
}

// ---- injectable fs interface (injection seam for tests) ---------------

export interface LabelStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  /** Resolve the labels sidecar path for a case. */
  labelsPath(caseId: string): string;
}

// ---- helpers ----------------------------------------------------------

async function readJsonArr<T>(
  deps: Pick<LabelStoreDeps, 'readFile'>,
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
  deps: Pick<LabelStoreDeps, 'writeFile'>,
  path: string,
  list: T[],
): Promise<void> {
  await deps.writeFile(path, JSON.stringify(list, null, 2));
}

// ---- factory ----------------------------------------------------------

/** Create a label store instance bound to the supplied deps.
 *  For tests: pass an in-memory LabelStoreDeps.
 *  For production: pass the real secure-fs + caseDir-derived paths. */
export function makeLabelStore(deps: LabelStoreDeps) {
  return {
    /**
     * Append a label to the case labels sidecar.
     * v1 does not dedup on itemId — an analyst may revise; both entries are kept.
     */
    async recordLabel(caseId: string, label: ItemLabel): Promise<void> {
      return withLock(`socmint-labels:${caseId}`, async () => {
        const p = deps.labelsPath(caseId);
        const existing = await readJsonArr<ItemLabel>(deps, p);
        existing.push(label);
        await writeJsonArr(deps, p, existing);
      });
    },

    /** Return all labels for a case in stable (append) order. */
    async listLabels(caseId: string): Promise<ItemLabel[]> {
      return withLock(`socmint-labels:${caseId}`, () =>
        readJsonArr<ItemLabel>(deps, deps.labelsPath(caseId)),
      );
    },
  };
}

// ---- production-wired top-level exports --------------------------------
// Lazy: deps are resolved only on first call so importing this module in tests
// that do NOT mock electron is safe (electron/paths/secure-fs are never
// evaluated at module-import time).  Tests should use makeLabelStore(testDeps).

let _prod: ReturnType<typeof makeLabelStore> | null = null;

async function prod(): Promise<ReturnType<typeof makeLabelStore>> {
  if (_prod) return _prod;
  const [{ join }, { caseDir }, { secureReadFile, secureWriteFile }] = await Promise.all([
    import('node:path'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
  ]);
  _prod = makeLabelStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    labelsPath: (id) => join(caseDir(id), 'socmint-labels.json'),
  });
  return _prod;
}

export async function recordLabel(caseId: string, label: ItemLabel): Promise<void> {
  return (await prod()).recordLabel(caseId, label);
}

export async function listLabels(caseId: string): Promise<ItemLabel[]> {
  return (await prod()).listLabels(caseId);
}
