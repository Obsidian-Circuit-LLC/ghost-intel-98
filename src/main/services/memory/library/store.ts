/**
 * Global document library store — a case-independent corpus of user-uploaded documents
 * (plus briefcase/journal content gathered by sources.ts) that the memory retriever can recall
 * from regardless of which case or conversation is active. Manifest is a single encrypted JSON
 * file; each document's extracted text is stored as its own encrypted `.txt` so large corpora
 * don't force the whole manifest to be rewritten on every doc read. `io` is injectable so store
 * logic is unit-testable without touching real secure-fs or the filesystem — see
 * test/memory-library-store.test.ts (mirrors profile-store.ts's pattern).
 */
import { join, resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { dataRoot } from '../../../storage/paths';
import { secureReadText, secureWriteFile } from '../../../storage/secure-fs';
import { contentHash } from '../chunker';
import { withLock } from '../../../util/mutex';

export interface LibraryDoc {
  docId: string;
  title: string;
  mime: string;
  addedAt: number;
  charCount: number;
  bytesHash: string;
}

export function libraryDir(): string {
  return join(dataRoot(), 'memory', 'library');
}

export function libraryManifestPath(): string {
  return join(libraryDir(), 'manifest.json');
}

export function libraryDocTextPath(docId: string): string {
  // Path confinement: a docId that arrives across IPC could contain traversal segments
  // (`../../../home/user/notes`) that escape `<libraryDir>/docs` and let remove()/readText()
  // touch an arbitrary `.txt` on disk. Resolve the candidate path and require it to sit
  // strictly under the docs directory, or refuse it outright.
  const docsDir = join(libraryDir(), 'docs');
  const p = join(docsDir, `${docId}.txt`);
  const resolved = resolve(p);
  if (!resolved.startsWith(resolve(docsDir) + sep)) {
    throw new Error('libraryDocTextPath: docId escapes the library directory');
  }
  return p;
}

/** Minimal read/write seam the store needs — real impl reads/writes encrypted files via
 *  secure-fs; tests inject an in-memory fake. Reads return `null` when there is nothing to
 *  read yet (missing file, unreadable, corrupt) so the store can treat that as "no data". */
export interface LibraryIO {
  readManifest(): Promise<string | null>;
  writeManifest(t: string): Promise<void>;
  readDocText(id: string): Promise<string | null>;
  writeDocText(id: string, t: string): Promise<void>;
  removeDocText(id: string): Promise<void>;
}

function defaultIO(): LibraryIO {
  return {
    async readManifest() {
      try {
        return await secureReadText(libraryManifestPath());
      } catch {
        return null; // missing / unreadable / locked → treat as empty library
      }
    },
    async writeManifest(t: string) {
      await secureWriteFile(libraryManifestPath(), t);
    },
    async readDocText(id: string) {
      try {
        return await secureReadText(libraryDocTextPath(id));
      } catch {
        return null;
      }
    },
    async writeDocText(id: string, t: string) {
      await secureWriteFile(libraryDocTextPath(id), t);
    },
    async removeDocText(id: string) {
      try {
        await rm(libraryDocTextPath(id), { force: true });
      } catch {
        // best-effort — manifest is the source of truth for listing
      }
    }
  };
}

function parseDocs(raw: string | null): LibraryDoc[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LibraryDoc[]) : [];
  } catch {
    return [];
  }
}

export function createLibrary(io: LibraryIO = defaultIO()): {
  list(): Promise<LibraryDoc[]>;
  add(input: { docId: string; title: string; mime: string; text: string; now: number }): Promise<LibraryDoc>;
  remove(docId: string): Promise<void>;
  readText(docId: string): Promise<string | null>;
} {
  async function readAll(): Promise<LibraryDoc[]> {
    return parseDocs(await io.readManifest());
  }
  async function writeAll(docs: LibraryDoc[]): Promise<void> {
    await io.writeManifest(JSON.stringify(docs));
  }

  return {
    async list() {
      return readAll();
    },

    async add(input) {
      // Serialize the manifest read-modify-write: the upload UI can fire several adds in
      // parallel, and an unsynchronized RMW loses all but the last writer's entry.
      return withLock('memory-library', async () => {
        const doc: LibraryDoc = {
          docId: input.docId,
          title: input.title,
          mime: input.mime,
          addedAt: input.now,
          charCount: input.text.length,
          bytesHash: contentHash(input.text)
        };
        const existing = await readAll();
        const byId = new Map(existing.map((d) => [d.docId, d]));
        byId.set(doc.docId, doc);
        await writeAll([...byId.values()]);
        await io.writeDocText(input.docId, input.text);
        return doc;
      });
    },

    async remove(docId: string) {
      await withLock('memory-library', async () => {
        const existing = await readAll();
        await writeAll(existing.filter((d) => d.docId !== docId));
        await io.removeDocText(docId);
      });
    },

    async readText(docId: string) {
      return io.readDocText(docId);
    }
  };
}
