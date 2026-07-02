/**
 * Generic per-namespace scraping-case store.
 *
 * A scraping case is a self-contained store for one social-collection run, kept apart from
 * the core investigation cases (see caseStore, which this module MUST NOT touch). Each case
 * persists as a single `case.json` under scrapingCaseFile(ns, id); the namespace ('socmint'
 * | 'x') is the path key, never a field on the record.
 *
 * Public API:
 *   makeScrapingCaseStore(ns, deps) — factory with an injected fs seam; use directly in tests.
 *   prodScrapingCaseStore(ns)       — production-wired factory (secure-fs + paths), lazy so
 *                                     importing this module never pulls in electron at import
 *                                     time (tests inject their own deps).
 *
 * Encrypt-at-rest: the production factory routes every read/write through secureReadFile /
 * secureWriteFile — never the plaintext json-fs bypass.
 *
 * Determinism: list order is a pure function of the data (createdAt asc, then id asc), never
 * filesystem/readdir iteration order or a clock.
 */

import type { ScrapingCase } from '@shared/types';
import type { ScrapingCaseNs } from './paths';
import { withLock } from '../util/mutex';

// ---- injectable fs seam (for tests) ------------------------------------

export interface ScrapingCaseStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides the JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  /** List the immediate child names of a directory; must throw ENOENT when the dir is absent. */
  readdir(path: string): Promise<string[]>;
  /** Recursively remove a path (the case directory). */
  rm(path: string): Promise<void>;
  /** Monotonic wall-clock in ms (injected for determinism/testability). */
  now(): number;
  /** Fresh case id. */
  uuid(): string;
  /** Directory holding every case subdir for `ns`. */
  nsDir(ns: ScrapingCaseNs): string;
  /** The case's directory (removed on delete). */
  caseDir(ns: ScrapingCaseNs, id: string): string;
  /** The case's `case.json` path. */
  caseFile(ns: ScrapingCaseNs, id: string): string;
}

// ---- helpers -----------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Stable order: createdAt ascending, then id ascending as a deterministic tie-break. */
function byCreatedThenId(a: ScrapingCase, b: ScrapingCase): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---- factory -----------------------------------------------------------

export interface ScrapingCaseStore {
  list(): Promise<ScrapingCase[]>;
  create(name: string): Promise<ScrapingCase>;
  read(id: string): Promise<ScrapingCase>;
  rename(id: string, name: string): Promise<ScrapingCase>;
  remove(id: string): Promise<void>;
}

export function makeScrapingCaseStore(
  ns: ScrapingCaseNs,
  deps: ScrapingCaseStoreDeps,
): ScrapingCaseStore {
  async function readCase(id: string): Promise<ScrapingCase> {
    const buf = await deps.readFile(deps.caseFile(ns, id));
    return JSON.parse(buf.toString('utf8')) as ScrapingCase;
  }

  return {
    async list(): Promise<ScrapingCase[]> {
      let ids: string[];
      try {
        ids = await deps.readdir(deps.nsDir(ns));
      } catch (e) {
        if (isEnoent(e)) return [];
        throw e;
      }
      const cases: ScrapingCase[] = [];
      for (const id of ids) {
        try {
          cases.push(await readCase(id));
        } catch (e) {
          // A directory entry without a readable case.json (partial/foreign) is skipped, not fatal.
          if (isEnoent(e)) continue;
          throw e;
        }
      }
      return cases.sort(byCreatedThenId);
    },

    async create(name: string): Promise<ScrapingCase> {
      const id = deps.uuid();
      const t = deps.now();
      const rec: ScrapingCase = { id, name, createdAt: t, updatedAt: t };
      await deps.writeFile(deps.caseFile(ns, id), JSON.stringify(rec, null, 2));
      return rec;
    },

    read(id: string): Promise<ScrapingCase> {
      return readCase(id);
    },

    async rename(id: string, name: string): Promise<ScrapingCase> {
      return withLock(`scraping:${ns}:${id}`, async () => {
        const rec = await readCase(id);
        const updated: ScrapingCase = { ...rec, name, updatedAt: deps.now() };
        await deps.writeFile(deps.caseFile(ns, id), JSON.stringify(updated, null, 2));
        return updated;
      });
    },

    async remove(id: string): Promise<void> {
      return withLock(`scraping:${ns}:${id}`, async () => {
        await deps.rm(deps.caseDir(ns, id));
      });
    },
  };
}

// ---- production-wired factory ------------------------------------------
// Lazy: electron/paths/secure-fs are resolved only on first call, so importing this
// module in tests that inject their own deps never evaluates electron.

let _prod: Partial<Record<ScrapingCaseNs, ScrapingCaseStore>> = {};

/** Production store for `ns`, wired to the encrypt-at-rest IO layer + real paths. Cached per ns. */
export async function prodScrapingCaseStore(ns: ScrapingCaseNs): Promise<ScrapingCaseStore> {
  const cached = _prod[ns];
  if (cached) return cached;

  const [{ join }, { rm, readdir }, { randomUUID }, paths, { secureReadFile, secureWriteFile }] =
    await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
      import('node:crypto'),
      import('./paths'),
      import('./secure-fs'),
    ]);

  const store = makeScrapingCaseStore(ns, {
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    readdir: (p) => readdir(p),
    rm: (p) => rm(p, { recursive: true, force: true }),
    now: () => Date.now(),
    uuid: () => randomUUID(),
    nsDir: (n) => join(paths.scrapingCasesRoot(), n),
    caseDir: (n, id) => paths.scrapingCaseDir(n, id),
    caseFile: (n, id) => paths.scrapingCaseFile(n, id),
  });
  _prod[ns] = store;
  return store;
}

/** Test-only: drop the cached production stores. */
export function __resetProdScrapingCaseStore(): void {
  _prod = {};
}
