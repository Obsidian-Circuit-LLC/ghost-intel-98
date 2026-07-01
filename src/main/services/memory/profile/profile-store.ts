/**
 * Encrypted persistence for the adaptive-memory profile — a single JSON file
 * (`<dataRoot>/memory/profile.json`) holding every `MemoryItem`, written through secure-fs so it
 * is encrypted at rest with the rest of the vault. `io` is injectable so store logic (upsert /
 * scope-filter / wipe semantics) is unit-testable without touching real secure-fs or the
 * filesystem — see test/memory-profile-store.test.ts.
 */
import { join } from 'node:path';
import { dataRoot } from '../../../storage/paths';
import { secureReadText, secureWriteFile } from '../../../storage/secure-fs';
import type { MemoryItem, MemoryScope } from './types';

export function profileStorePath(): string {
  return join(dataRoot(), 'memory', 'profile.json');
}

/** Minimal read/write seam the store needs — real impl reads/writes the encrypted JSON file;
 *  tests inject an in-memory fake. `read()` returns `null` when there is nothing to read yet
 *  (missing file, unreadable, corrupt) so the store can treat that as "no items". */
export interface ProfileStoreIO {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

function defaultIO(): ProfileStoreIO {
  const path = profileStorePath();
  return {
    async read() {
      try {
        return await secureReadText(path);
      } catch {
        return null; // missing / unreadable / locked → treat as empty profile
      }
    },
    async write(text: string) {
      await secureWriteFile(path, text);
    }
  };
}

function parseItems(raw: string | null): MemoryItem[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryItem[]) : [];
  } catch {
    return [];
  }
}

export interface ProfileStore {
  all(): Promise<MemoryItem[]>;
  byScope(scopes: MemoryScope[]): Promise<MemoryItem[]>;
  /** Full upsert-by-id replace-set: each item in `items` replaces any existing item with the
   *  same id (or is appended if new); items not named are left untouched. */
  put(items: MemoryItem[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** `scope` omitted → wipe everything; otherwise only items in that exact scope are removed. */
  wipe(scope?: MemoryScope): Promise<void>;
}

export function createProfileStore(io: ProfileStoreIO = defaultIO()): ProfileStore {
  async function readAll(): Promise<MemoryItem[]> {
    return parseItems(await io.read());
  }
  async function writeAll(items: MemoryItem[]): Promise<void> {
    await io.write(JSON.stringify(items));
  }

  return {
    async all() {
      return readAll();
    },

    async byScope(scopes: MemoryScope[]) {
      const set = new Set(scopes);
      return (await readAll()).filter((item) => set.has(item.scope));
    },

    async put(items: MemoryItem[]) {
      const existing = await readAll();
      const byId = new Map(existing.map((item) => [item.id, item]));
      for (const item of items) byId.set(item.id, item);
      await writeAll([...byId.values()]);
    },

    async remove(ids: string[]) {
      const drop = new Set(ids);
      const existing = await readAll();
      await writeAll(existing.filter((item) => !drop.has(item.id)));
    },

    async wipe(scope?: MemoryScope) {
      if (scope === undefined) {
        await writeAll([]);
        return;
      }
      const existing = await readAll();
      await writeAll(existing.filter((item) => item.scope !== scope));
    }
  };
}
