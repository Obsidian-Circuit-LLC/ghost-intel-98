/**
 * X Listening Station encrypt-at-rest data layer.
 *
 * Captured visible-DOM posts normalise into `HarvestedItem`s and land in the encrypted
 * scraping-case store under the clearnet-quarantined `x` namespace; three X-specific
 * artifact stores (analyst notes, follower/following networks, low-rate archive state)
 * sit alongside them, one JSON sidecar each, all routed through secure-fs.
 *
 * Public API:
 *   makeXStore(deps)  — pure factory over an injected fs seam; use directly in tests.
 *   prodXStore()      — production-wired singleton (secure-fs + real paths), lazy so
 *                       importing this module never pulls in electron at import time.
 *
 * Encrypt-at-rest: the production factory routes every read/write through secureReadFile /
 * secureWriteFile — never the plaintext json-fs bypass. Plaintext JSON is forbidden for
 * intel data (Global Constraints).
 *
 * Determinism: order is append order (a pure function of the write sequence), never
 * readdir iteration order or a clock; the caller supplies every timestamp.
 */

import type { HarvestedItem } from '@shared/socmint/types';
import { withLock } from '../util/mutex';

// ---- artifact record shapes --------------------------------------------

/** One analyst note, pinned to a finding within a case. `savedAt` is caller-supplied. */
export interface XNote {
  findingId: string;
  text: string;
  /** ISO timestamp supplied by the caller (injected clock) — never computed here. */
  savedAt: string;
}

/** A visible follower/following account row. `avatar`, when present, is a local `data:`
 *  thumbnail — a remote URL must never be stored here (no-remote-media-inlining). */
export interface XNetworkAccount {
  handle: string;
  displayName: string;
  avatar?: string;
  bio?: string;
}

/** A captured follower/following list for one target — the ACTUAL visible accounts, never a
 *  scraped count-number (honesty: the module reports what it saw, not a claimed total). */
export interface XNetworkArtifact {
  /** The profile whose followers/following these are. */
  target: string;
  kind: 'followers' | 'following';
  accounts: XNetworkAccount[];
  /** ISO timestamp supplied by the caller (injected clock). */
  capturedAt: string;
}

/** Resumable state for a bounded low-rate archive cycle. */
export interface XArchiveState {
  /** Opaque pagination cursor for resuming a cycle; null = start from the top. */
  cursor: string | null;
  cycles: number;
  /** ISO timestamp of the last cycle (injected clock); null before the first run. */
  lastRunAt: string | null;
}

// ---- injectable fs seam (for tests) ------------------------------------

export interface XStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides the JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  /** Resolve the captured-items sidecar path for a case. */
  itemsPath(caseId: string): string;
  /** Resolve the analyst-notes artifact path for a case. */
  notesPath(caseId: string): string;
  /** Resolve the follower/following networks artifact path for a case. */
  networksPath(caseId: string): string;
  /** Resolve the archive-state artifact path for a case. */
  archiveStatePath(caseId: string): string;
}

// ---- helpers -----------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function readJsonArr<T>(deps: Pick<XStoreDeps, 'readFile'>, path: string): Promise<T[]> {
  try {
    const buf = await deps.readFile(path);
    return JSON.parse(buf.toString('utf8')) as T[];
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
}

async function writeJson<T>(deps: Pick<XStoreDeps, 'writeFile'>, path: string, value: T): Promise<void> {
  await deps.writeFile(path, JSON.stringify(value, null, 2));
}

// ---- factory -----------------------------------------------------------

export interface XStore {
  /** Upsert captured items (dedup by `id`, append order preserved). */
  saveItems(caseId: string, items: HarvestedItem[]): Promise<{ added: number; skipped: number }>;
  /** All captured items for a case, in append order. */
  readItems(caseId: string): Promise<HarvestedItem[]>;
  notes: {
    read(caseId: string): Promise<XNote[]>;
    write(caseId: string, notes: XNote[]): Promise<void>;
  };
  networks: {
    read(caseId: string): Promise<XNetworkArtifact[]>;
    write(caseId: string, networks: XNetworkArtifact[]): Promise<void>;
    /**
     * Upsert one captured network artifact, keyed by (target, kind) case-insensitively
     * — a re-capture of the same target's followers replaces the prior snapshot rather
     * than duplicating it. Returns the total artifact count for the case. */
    save(caseId: string, artifact: XNetworkArtifact): Promise<number>;
  };
  archiveState: {
    /** Null before the first write. */
    read(caseId: string): Promise<XArchiveState | null>;
    write(caseId: string, state: XArchiveState): Promise<void>;
  };
}

export function makeXStore(deps: XStoreDeps): XStore {
  return {
    async saveItems(caseId, items) {
      return withLock(`x-listening:${caseId}`, async () => {
        const p = deps.itemsPath(caseId);
        const existing = await readJsonArr<HarvestedItem>(deps, p);
        const seen = new Set(existing.map((i) => i.id));
        let added = 0;
        let skipped = 0;
        for (const item of items) {
          if (seen.has(item.id)) {
            skipped++;
          } else {
            existing.push(item);
            seen.add(item.id);
            added++;
          }
        }
        if (added > 0) await writeJson(deps, p, existing);
        return { added, skipped };
      });
    },

    readItems(caseId) {
      return withLock(`x-listening:${caseId}`, () =>
        readJsonArr<HarvestedItem>(deps, deps.itemsPath(caseId)),
      );
    },

    notes: {
      read(caseId) {
        return withLock(`x-listening:notes:${caseId}`, () =>
          readJsonArr<XNote>(deps, deps.notesPath(caseId)),
        );
      },
      write(caseId, notes) {
        return withLock(`x-listening:notes:${caseId}`, () =>
          writeJson(deps, deps.notesPath(caseId), notes),
        );
      },
    },

    networks: {
      read(caseId) {
        return withLock(`x-listening:networks:${caseId}`, () =>
          readJsonArr<XNetworkArtifact>(deps, deps.networksPath(caseId)),
        );
      },
      write(caseId, networks) {
        return withLock(`x-listening:networks:${caseId}`, () =>
          writeJson(deps, deps.networksPath(caseId), networks),
        );
      },
      save(caseId, artifact) {
        return withLock(`x-listening:networks:${caseId}`, async () => {
          const existing = await readJsonArr<XNetworkArtifact>(deps, deps.networksPath(caseId));
          const target = String(artifact.target ?? '').toLowerCase();
          const idx = existing.findIndex(
            (a) => String(a.target ?? '').toLowerCase() === target && a.kind === artifact.kind,
          );
          if (idx >= 0) existing[idx] = artifact;
          else existing.push(artifact);
          await writeJson(deps, deps.networksPath(caseId), existing);
          return existing.length;
        });
      },
    },

    archiveState: {
      async read(caseId) {
        return withLock(`x-listening:archive:${caseId}`, async () => {
          try {
            const buf = await deps.readFile(deps.archiveStatePath(caseId));
            return JSON.parse(buf.toString('utf8')) as XArchiveState;
          } catch (e) {
            if (isEnoent(e)) return null;
            throw e;
          }
        });
      },
      write(caseId, state) {
        return withLock(`x-listening:archive:${caseId}`, () =>
          writeJson(deps, deps.archiveStatePath(caseId), state),
        );
      },
    },
  };
}

// ---- production-wired singleton ----------------------------------------
// Lazy: electron/paths/secure-fs are resolved only on first call, so importing this module
// in tests that inject their own deps never evaluates electron. The item sidecar reuses the
// canonical scrapingCaseItemsFile('x', …) path (single source of truth); the three artifacts
// are per-case JSON sidecars alongside it under scrapingCaseDir('x', id).

let _prod: XStore | null = null;

export async function prodXStore(): Promise<XStore> {
  if (_prod) return _prod;
  const [{ join }, paths, { secureReadFile, secureWriteFile }] = await Promise.all([
    import('node:path'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
  ]);
  const artifact = (id: string, name: string) => join(paths.scrapingCaseDir('x', id), name);
  _prod = makeXStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    itemsPath: (id) => paths.scrapingCaseItemsFile('x', id),
    notesPath: (id) => artifact(id, 'x-notes.json'),
    networksPath: (id) => artifact(id, 'x-networks.json'),
    archiveStatePath: (id) => artifact(id, 'x-archive-state.json'),
  });
  return _prod;
}

/** Test-only: drop the cached production store. */
export function __resetProdXStore(): void {
  _prod = null;
}
