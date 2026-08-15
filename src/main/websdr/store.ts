/**
 * WebSDR Viewer — encrypt-at-rest data layer (Phase 1).
 *
 * The receiver directory, presets, listening notes, Station Menu config, egress-toggle state, and
 * recording metadata each live in one JSON sidecar under `websdrDir()`, ALL routed through
 * secure-fs (AES-GCM at rest) — never his plaintext `sdr-eaves-dropper.json` beside the exe, and
 * never the plaintext json-fs bypass. Plaintext on disk is forbidden for module state (Global
 * Constraint 3).
 *
 * Public API:
 *   makeWebSdrStore(deps) — pure factory over an injected fs + seed seam; use directly in tests.
 *   prodWebSdrStore()     — production-wired singleton (secure-fs + real paths + the bundled 851
 *                           KiwiSDR seed), lazy so importing this module never pulls electron.
 *
 * Determinism: the directory seed dedups by normalized URL (a pure function of the seed list),
 * never a clock or readdir order; the caller supplies every id/timestamp on a record — the store
 * only upserts/reads. The one-shot `directorySeedVersion` guard makes the seed idempotent.
 */

import { withLock } from '../util/mutex';
import { normalizeWebSdrUrl } from '@shared/websdr/normalize-url';
import type {
  WebSdrReceiver,
  WebSdrPreset,
  WebSdrNote,
  WebSdrStationMenu,
  WebSdrEgressState,
  WebSdrRecordingMeta,
} from '@shared/websdr/types';
import { defaultWebSdrMenu, DEFAULT_WEBSDR_EGRESS } from '@shared/websdr/types';

/** The seed-version stamp. Once a directory carries this exact string, the seed is a no-op — so
 *  the 851 public receivers are imported at most once, and a user who removes a seeded receiver
 *  never has it silently re-added. Matches his `directorySeedVersion` value. */
export const KIWI_SEED_VERSION = 'kiwi-public-2026-08-11-v1';

/** The on-disk directory sidecar shape: the receiver list plus the one-shot seed stamp. */
export interface WebSdrDirectoryFile {
  receivers: WebSdrReceiver[];
  directorySeedVersion?: string;
}

// ---- injectable fs + seed seam (for tests) -----------------------------

export interface WebSdrStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides the JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  directoryPath(): string;
  presetsPath(): string;
  notesPath(): string;
  menuPath(): string;
  egressPath(): string;
  recordingsPath(): string;
  /** The receivers imported on first run (production: the bundled 851 KiwiSDR JSON). */
  seedReceivers: readonly WebSdrReceiver[];
}

// ---- helpers -----------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function readJsonArr<T>(deps: Pick<WebSdrStoreDeps, 'readFile'>, path: string): Promise<T[]> {
  try {
    const buf = await deps.readFile(path);
    const parsed = JSON.parse(buf.toString('utf8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
}

async function readJsonObj<T>(
  deps: Pick<WebSdrStoreDeps, 'readFile'>,
  path: string,
  fallback: T,
): Promise<T> {
  try {
    const buf = await deps.readFile(path);
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch (e) {
    if (isEnoent(e)) return fallback;
    throw e;
  }
}

async function writeJson<T>(deps: Pick<WebSdrStoreDeps, 'writeFile'>, path: string, value: T): Promise<void> {
  await deps.writeFile(path, JSON.stringify(value, null, 2));
}

// ---- store interface ---------------------------------------------------

export interface WebSdrStore {
  directory: {
    /** The full receiver list, seeding the bundled directory once on first read. */
    read(): Promise<WebSdrReceiver[]>;
    /** Upsert one receiver keyed by `id` (the caller supplies a normalized `url` + an `id`).
     *  Returns the fresh list. */
    save(receiver: WebSdrReceiver): Promise<WebSdrReceiver[]>;
    /** Remove one receiver by id (a no-op for an unknown id). Returns the fresh list. Cascade
     *  removal of presets bound to the receiver is the orchestration layer's job (separate store). */
    remove(id: string): Promise<WebSdrReceiver[]>;
    /** Idempotent one-shot seed: import `seedReceivers` (dedup by normalized URL) unless the
     *  directory already carries `KIWI_SEED_VERSION`. */
    seed(): Promise<void>;
  };
  presets: {
    read(): Promise<WebSdrPreset[]>;
    save(preset: WebSdrPreset): Promise<WebSdrPreset[]>;
    remove(id: string): Promise<WebSdrPreset[]>;
    /** Drop every preset bound to `receiverId` (cascade on receiver delete). Returns the fresh list. */
    removeForReceiver(receiverId: string): Promise<WebSdrPreset[]>;
  };
  notes: {
    read(): Promise<WebSdrNote[]>;
    save(note: WebSdrNote): Promise<WebSdrNote[]>;
    remove(id: string): Promise<WebSdrNote[]>;
  };
  menu: {
    read(): Promise<WebSdrStationMenu>;
    write(menu: WebSdrStationMenu): Promise<WebSdrStationMenu>;
  };
  egress: {
    read(): Promise<WebSdrEgressState>;
    write(state: WebSdrEgressState): Promise<WebSdrEgressState>;
  };
  recordings: {
    read(): Promise<WebSdrRecordingMeta[]>;
    /** Upsert one recording metadata record keyed by `id`. Returns the fresh list. (The captured
     *  bytes are written to the encrypted blob store in Phase 3; this is the metadata seam.) */
    save(meta: WebSdrRecordingMeta): Promise<WebSdrRecordingMeta[]>;
    remove(id: string): Promise<WebSdrRecordingMeta[]>;
  };
}

const LOCK = 'websdr:store';

export function makeWebSdrStore(deps: WebSdrStoreDeps): WebSdrStore {
  // A single lock keyed per-store-instance is enough: the six sidecars are small and independent,
  // and serializing all mutations avoids a read-modify-write race without per-file lock plumbing.
  async function seedInLock(): Promise<WebSdrDirectoryFile> {
    const file = await readJsonObj<WebSdrDirectoryFile>(deps, deps.directoryPath(), {
      receivers: [],
    });
    if (!Array.isArray(file.receivers)) file.receivers = [];
    if (file.directorySeedVersion === KIWI_SEED_VERSION) return file;
    const byUrl = new Set(
      file.receivers.map((r) => {
        try {
          return normalizeWebSdrUrl(r.url);
        } catch {
          return r.url;
        }
      }),
    );
    for (const raw of deps.seedReceivers) {
      let url = raw.url;
      try {
        url = normalizeWebSdrUrl(url);
      } catch {
        // A malformed seed URL is skipped rather than crashing the seed — the bundled JSON is
        // pre-validated, so this is defence-in-depth, not an expected path.
        continue;
      }
      if (byUrl.has(url)) continue;
      file.receivers.push({ ...raw, url });
      byUrl.add(url);
    }
    file.directorySeedVersion = KIWI_SEED_VERSION;
    await writeJson(deps, deps.directoryPath(), file);
    return file;
  }

  return {
    directory: {
      read() {
        return withLock(LOCK, async () => (await seedInLock()).receivers);
      },
      save(receiver) {
        return withLock(LOCK, async () => {
          const file = await seedInLock();
          const idx = file.receivers.findIndex((r) => r.id === receiver.id);
          if (idx >= 0) file.receivers[idx] = receiver;
          else file.receivers.push(receiver);
          await writeJson(deps, deps.directoryPath(), file);
          return file.receivers;
        });
      },
      remove(id) {
        return withLock(LOCK, async () => {
          const file = await seedInLock();
          file.receivers = file.receivers.filter((r) => r.id !== id);
          await writeJson(deps, deps.directoryPath(), file);
          return file.receivers;
        });
      },
      seed() {
        return withLock(LOCK, async () => {
          await seedInLock();
        });
      },
    },

    presets: {
      read() {
        return withLock(LOCK, () => readJsonArr<WebSdrPreset>(deps, deps.presetsPath()));
      },
      save(preset) {
        return withLock(LOCK, async () => {
          const existing = await readJsonArr<WebSdrPreset>(deps, deps.presetsPath());
          const idx = existing.findIndex((p) => p.id === preset.id);
          if (idx >= 0) existing[idx] = preset;
          else existing.push(preset);
          await writeJson(deps, deps.presetsPath(), existing);
          return existing;
        });
      },
      remove(id) {
        return withLock(LOCK, async () => {
          const kept = (await readJsonArr<WebSdrPreset>(deps, deps.presetsPath())).filter(
            (p) => p.id !== id,
          );
          await writeJson(deps, deps.presetsPath(), kept);
          return kept;
        });
      },
      removeForReceiver(receiverId) {
        return withLock(LOCK, async () => {
          const kept = (await readJsonArr<WebSdrPreset>(deps, deps.presetsPath())).filter(
            (p) => p.receiverId !== receiverId,
          );
          await writeJson(deps, deps.presetsPath(), kept);
          return kept;
        });
      },
    },

    notes: {
      read() {
        return withLock(LOCK, () => readJsonArr<WebSdrNote>(deps, deps.notesPath()));
      },
      save(note) {
        return withLock(LOCK, async () => {
          const existing = await readJsonArr<WebSdrNote>(deps, deps.notesPath());
          const idx = existing.findIndex((n) => n.id === note.id);
          if (idx >= 0) existing[idx] = note;
          else existing.unshift(note);
          await writeJson(deps, deps.notesPath(), existing);
          return existing;
        });
      },
      remove(id) {
        return withLock(LOCK, async () => {
          const kept = (await readJsonArr<WebSdrNote>(deps, deps.notesPath())).filter(
            (n) => n.id !== id,
          );
          await writeJson(deps, deps.notesPath(), kept);
          return kept;
        });
      },
    },

    menu: {
      read() {
        return withLock(LOCK, () =>
          readJsonObj<WebSdrStationMenu>(deps, deps.menuPath(), defaultWebSdrMenu()),
        );
      },
      write(menu) {
        return withLock(LOCK, async () => {
          await writeJson(deps, deps.menuPath(), menu);
          return menu;
        });
      },
    },

    egress: {
      read() {
        return withLock(LOCK, () =>
          readJsonObj<WebSdrEgressState>(deps, deps.egressPath(), { ...DEFAULT_WEBSDR_EGRESS }),
        );
      },
      write(state) {
        return withLock(LOCK, async () => {
          await writeJson(deps, deps.egressPath(), state);
          return state;
        });
      },
    },

    recordings: {
      read() {
        return withLock(LOCK, () => readJsonArr<WebSdrRecordingMeta>(deps, deps.recordingsPath()));
      },
      save(meta) {
        return withLock(LOCK, async () => {
          const existing = await readJsonArr<WebSdrRecordingMeta>(deps, deps.recordingsPath());
          const idx = existing.findIndex((r) => r.id === meta.id);
          if (idx >= 0) existing[idx] = meta;
          else existing.unshift(meta);
          await writeJson(deps, deps.recordingsPath(), existing);
          return existing;
        });
      },
      remove(id) {
        return withLock(LOCK, async () => {
          const kept = (await readJsonArr<WebSdrRecordingMeta>(deps, deps.recordingsPath())).filter(
            (r) => r.id !== id,
          );
          await writeJson(deps, deps.recordingsPath(), kept);
          return kept;
        });
      },
    },
  };
}

// ---- production-wired singleton ----------------------------------------
// Lazy: electron/paths/secure-fs and the bundled seed JSON are resolved only on first call, so
// importing this module in tests that inject their own deps never evaluates electron.

let _prod: WebSdrStore | null = null;

export async function prodWebSdrStore(): Promise<WebSdrStore> {
  if (_prod) return _prod;
  const [paths, { secureReadFile, secureWriteFile }, seed] = await Promise.all([
    import('../storage/paths'),
    import('../storage/secure-fs'),
    import('./kiwi-directory'),
  ]);
  _prod = makeWebSdrStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    directoryPath: () => paths.websdrDirectoryFile(),
    presetsPath: () => paths.websdrPresetsFile(),
    notesPath: () => paths.websdrNotesFile(),
    menuPath: () => paths.websdrMenuFile(),
    egressPath: () => paths.websdrEgressFile(),
    recordingsPath: () => paths.websdrRecordingsFile(),
    seedReceivers: (seed.default ?? seed) as readonly WebSdrReceiver[],
  });
  return _prod;
}

/** Test-only: drop the cached production store. */
export function __resetProdWebSdrStore(): void {
  _prod = null;
}
