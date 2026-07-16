/**
 * User-drawn retrieval bonds — an undirected edge list between two memory-graph node ids
 * (`<dataRoot>/memory/bonds.json`), written through secure-fs so it is encrypted at rest with the
 * rest of the vault. `io` is injectable so store logic (normalize/dedupe/self-bond-ignore) is
 * unit-testable without touching real secure-fs or the filesystem — see
 * test/memory-bonds-store.test.ts.
 */
import { join } from 'node:path';
import { dataRoot } from '../../storage/paths';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';

/** An undirected bond between two node ids, always stored with `a < b`. */
export interface Bond {
  a: string;
  b: string;
}

/** Minimal read/write seam the store needs — real impl reads/writes the encrypted JSON file;
 *  tests inject an in-memory fake. `read()` returns `null` when there is nothing to read yet
 *  (missing file, unreadable, corrupt) so the store can treat that as "no bonds". */
export interface BondIO {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export function bondsPath(): string {
  return join(dataRoot(), 'memory', 'bonds.json');
}

function defaultIO(): BondIO {
  const path = bondsPath();
  return {
    async read() {
      try {
        return await secureReadText(path);
      } catch {
        return null; // missing / unreadable / locked → treat as no bonds
      }
    },
    async write(text: string) {
      await secureWriteFile(path, text);
    }
  };
}

function parseBonds(raw: string | null): Bond[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Bond[]) : [];
  } catch {
    return [];
  }
}

/** Normalizes an unordered pair to `[a,b]` with `a < b` (lexicographic). */
function normalizePair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function createBonds(io: BondIO = defaultIO()): {
  list(): Promise<Bond[]>;
  add(a: string, b: string): Promise<void>;
  remove(a: string, b: string): Promise<void>;
  removeAllForNode(id: string): Promise<void>;
  neighbors(id: string): Promise<string[]>;
} {
  async function readAll(): Promise<Bond[]> {
    return parseBonds(await io.read());
  }
  async function writeAll(bonds: Bond[]): Promise<void> {
    await io.write(JSON.stringify(bonds));
  }

  return {
    async list() {
      return readAll();
    },

    async add(a: string, b: string) {
      if (a === b) return; // ignore self-bond
      const [na, nb] = normalizePair(a, b);
      const existing = await readAll();
      if (existing.some((bond) => bond.a === na && bond.b === nb)) return; // dedupe
      await writeAll([...existing, { a: na, b: nb }]);
    },

    async remove(a: string, b: string) {
      const [na, nb] = normalizePair(a, b);
      const existing = await readAll();
      await writeAll(existing.filter((bond) => !(bond.a === na && bond.b === nb)));
    },

    async removeAllForNode(id: string) {
      const existing = await readAll();
      const next = existing.filter((bond) => bond.a !== id && bond.b !== id);
      if (next.length !== existing.length) await writeAll(next); // only rewrite if something matched
    },

    async neighbors(id: string) {
      const existing = await readAll();
      const out: string[] = [];
      for (const bond of existing) {
        if (bond.a === id) out.push(bond.b);
        else if (bond.b === id) out.push(bond.a);
      }
      return out;
    }
  };
}
