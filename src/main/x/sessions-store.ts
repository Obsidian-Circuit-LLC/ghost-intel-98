/**
 * Non-secret X session metadata store.
 *
 * A "session" is the human-facing unit for one X auth_token+ct0 cookie pair. The SECRETS
 * (auth_token/ct0/username) live in secretStore under `x.accounts.<accountId>.*` and never
 * touch this file. This store holds ONLY the non-secret metadata needed to render the Stored
 * Sessions list — label, an optional username hint, the last-test status/handle, and when it
 * was last tested — keyed by the opaque `accountId`.
 *
 * Charter invariants:
 *  - NO secret field is ever persisted here. `sanitize()` picks only the allowed non-secret
 *    keys on the way in AND on the way out, so a caller that mistakenly hands over an object
 *    carrying cookie material cannot leak it onto disk or back to the renderer.
 *  - Encrypt-at-rest: the production IO routes through secure-fs (secureReadText/secureWriteFile),
 *    the same choke-point every other case-data store uses.
 *  - Determinism: list order is a pure function of the data (label asc, then accountId asc),
 *    never readdir/object iteration order or a clock. This store sets no timestamps itself —
 *    `lastTestedAt` is stamped by the caller (the IPC boundary, with an injected `now`).
 *
 * Testability: `createSessionsStore(io)` takes an injected read/write seam so the metadata
 * logic is exercised with an in-memory fake (see test/x-sessions-store.test.ts) with no
 * Electron runtime. The top-level `listSessions`/`putSessionMeta`/`removeSessionMeta`/
 * `migrateLegacyAccounts` wrap a lazily-built production store wired to secure-fs + paths.
 */

import { withLock } from '../util/mutex';

export type SessionStatus = 'valid' | 'expired' | 'untested';

export interface SessionMeta {
  accountId: string;
  label: string;
  username?: string;
  status: SessionStatus;
  lastTestedAt?: string;
  handle?: string;
}

/** Injected persistence seam. `read` returns the raw JSON text or null when nothing is stored. */
export interface SessionsStoreIO {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export interface SessionsStore {
  list(): Promise<SessionMeta[]>;
  put(meta: SessionMeta): Promise<void>;
  remove(accountId: string): Promise<void>;
  /** Non-destructive: for any id not already present, add `{ label:id, status:'untested' }`. */
  migrate(existingAccountIds: string[]): Promise<void>;
}

/** Single lock key — the whole store is one JSON object in one file. */
const LOCK_KEY = 'x-sessions-store';

/** Copy across ONLY the allowed non-secret fields, dropping anything else (e.g. auth_token/ct0). */
function sanitize(m: SessionMeta): SessionMeta {
  const out: SessionMeta = { accountId: String(m.accountId), label: String(m.label), status: m.status };
  if (m.username !== undefined) out.username = String(m.username);
  if (m.lastTestedAt !== undefined) out.lastTestedAt = String(m.lastTestedAt);
  if (m.handle !== undefined) out.handle = String(m.handle);
  return out;
}

/** Deterministic order: label ascending, then accountId ascending as a stable tie-break.
 *  Plain codepoint comparison (not localeCompare) so the order is locale-independent. */
function byLabelThenId(a: SessionMeta, b: SessionMeta): number {
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  if (a.accountId !== b.accountId) return a.accountId < b.accountId ? -1 : 1;
  return 0;
}

export function createSessionsStore(io: SessionsStoreIO): SessionsStore {
  async function readMap(): Promise<Record<string, SessionMeta>> {
    const text = await io.read();
    if (!text) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A corrupt/foreign file must not brick the store; treat as empty.
      return {};
    }
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, SessionMeta> = {};
    for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        // Re-key from the map key so accountId can never disagree with its slot, and sanitize
        // on read too (defence in depth against a tampered on-disk file carrying secrets).
        out[id] = sanitize({ ...(val as SessionMeta), accountId: id });
      }
    }
    return out;
  }

  async function writeMap(map: Record<string, SessionMeta>): Promise<void> {
    await io.write(JSON.stringify(map, null, 2));
  }

  return {
    async list(): Promise<SessionMeta[]> {
      const map = await readMap();
      return Object.values(map).sort(byLabelThenId);
    },

    async put(meta: SessionMeta): Promise<void> {
      const clean = sanitize(meta);
      return withLock(LOCK_KEY, async () => {
        const map = await readMap();
        map[clean.accountId] = clean;
        await writeMap(map);
      });
    },

    async remove(accountId: string): Promise<void> {
      return withLock(LOCK_KEY, async () => {
        const map = await readMap();
        if (accountId in map) {
          delete map[accountId];
          await writeMap(map);
        }
      });
    },

    async migrate(existingAccountIds: string[]): Promise<void> {
      return withLock(LOCK_KEY, async () => {
        const map = await readMap();
        let changed = false;
        for (const id of existingAccountIds) {
          if (!(id in map)) {
            map[id] = { accountId: id, label: id, status: 'untested' };
            changed = true;
          }
        }
        if (changed) await writeMap(map);
      });
    },
  };
}

// ---- production-wired singleton ----------------------------------------
// Lazy: electron/paths/secure-fs are resolved only on first use, so importing this module in
// tests that inject their own IO never evaluates electron.

let _override: SessionsStore | null = null;
let _prod: SessionsStore | null = null;

async function prodIo(): Promise<SessionsStoreIO> {
  const [{ join }, paths, secureFs] = await Promise.all([
    import('node:path'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
  ]);
  const file = join(paths.dataRoot(), 'x-sessions.json');
  return {
    async read(): Promise<string | null> {
      try {
        return await secureFs.secureReadText(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(text: string): Promise<void> {
      await secureFs.secureWriteFile(file, text);
    },
  };
}

async function active(): Promise<SessionsStore> {
  if (_override) return _override;
  if (!_prod) _prod = createSessionsStore(await prodIo());
  return _prod;
}

export async function listSessions(): Promise<SessionMeta[]> {
  return (await active()).list();
}

export async function putSessionMeta(meta: SessionMeta): Promise<void> {
  return (await active()).put(meta);
}

export async function removeSessionMeta(accountId: string): Promise<void> {
  return (await active()).remove(accountId);
}

export async function migrateLegacyAccounts(existingAccountIds: string[]): Promise<void> {
  return (await active()).migrate(existingAccountIds);
}

/** Test-only: inject a store (e.g. an in-memory fake) behind the top-level functions. */
export function __setSessionsStoreForTest(store: SessionsStore | null): void {
  _override = store;
}

/** Test-only: drop the injected + cached production store. */
export function __resetSessionsStoreForTest(): void {
  _override = null;
  _prod = null;
}
