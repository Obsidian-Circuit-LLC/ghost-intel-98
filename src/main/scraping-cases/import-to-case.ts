/**
 * T8: import a scraping case's results into a main investigation case.
 *
 * A scraping case (namespace 'socmint' | 'x') is a self-contained collection-run store, kept
 * apart from the core investigation cases. This module copies a scraping case's harvested
 * items + saved artifacts INTO a target main case, reusing the EXISTING writers:
 *   - items  → the SOCMINT upsert-items writer bound to the SAME per-namespace items path the
 *              main-case reader (window.api.{socmint,x}.listItems) consumes, keyed by the main
 *              case id — scrapingCaseItemsFile(ns, mainCaseId), dedup on item id;
 *   - artifacts → the main case's note writer (one note per saved artifact).
 *
 * The scraping case is a SOURCE only. This import never mutates or removes it — the same run
 * can be imported into more than one main case, and the scraping store stays intact (the W4
 * migration/backup story owns removal, not this path).
 *
 * Encrypt-at-rest: the production wiring reads/writes exclusively through the secure-fs layer
 * (secureReadFile/secureReadText + the note writer's secureWriteFile) — never the plaintext
 * json bypass. This module imports no bgconn/Tor/collector code; it is pure copy + reuse.
 */

import type { ScrapingCaseNs } from '../storage/paths';
import type { HarvestedItem } from '@shared/socmint/types';
import type { ScrapingImportResult } from './ipc';

/** Injected writer/reader seam so the copy logic is unit-testable without Electron or the FS.
 *  Every function here is an EXISTING writer/reader wired to the real stores in production. */
export interface ScrapingImporterDeps {
  /** List the scraping case's harvested items (source scraping store — read-only). */
  readItems(ns: ScrapingCaseNs, scrapingCaseId: string): Promise<HarvestedItem[]>;
  /** Upsert items into the MAIN case at the reader-aligned per-namespace items path
   *  (existing SOCMINT writer bound to scrapingCaseItemsFile(ns, mainCaseId)). */
  upsertMainItems(mainCaseId: string, items: HarvestedItem[]): Promise<{ added: number; skipped: number }>;
  /** List the scraping case's saved artifacts (name + decrypted content). */
  readArtifacts(ns: ScrapingCaseNs, scrapingCaseId: string): Promise<Array<{ name: string; content: string }>>;
  /** Write one note into the MAIN case (existing note writer; encrypts at rest). */
  writeMainNote(mainCaseId: string, name: string, body: string): Promise<void>;
}

/**
 * Copy a scraping case's items + artifacts into a main investigation case via the injected
 * existing writers. Returns the number of NEW items written (upsert dedup means a re-import
 * into the same main case adds 0). The scraping case is left untouched.
 */
export async function importScrapingCaseToMainCase(
  deps: ScrapingImporterDeps,
  ns: ScrapingCaseNs,
  scrapingCaseId: string,
  mainCaseId: string,
): Promise<ScrapingImportResult> {
  const items = await deps.readItems(ns, scrapingCaseId);
  const { added } = await deps.upsertMainItems(mainCaseId, items);

  const artifacts = await deps.readArtifacts(ns, scrapingCaseId);
  for (const a of artifacts) {
    // Deterministic, source-tagged note name so a re-import overwrites its own prior note
    // rather than accumulating duplicates. The note writer sanitises the final filename.
    await deps.writeMainNote(mainCaseId, `${ns}-import-${a.name}`, a.content);
  }

  return { imported: added };
}

// ---- production-wired export -------------------------------------------
// Lazy: electron/paths/secure-fs/json-fs are resolved only on first call so importing this
// module in tests that inject their own deps never evaluates Electron at import time.

/**
 * Production import: wires the real scraping-store reader, the main-case SOCMINT writer, the
 * artifact reader, and the note writer, then runs the copy. Used by the scrapingCases IPC
 * handler (register.ts). ns/id/mainCaseId are already validated at the IPC boundary.
 */
export async function prodImportScrapingCaseToMainCase(
  ns: ScrapingCaseNs,
  scrapingCaseId: string,
  mainCaseId: string,
): Promise<ScrapingImportResult> {
  const [{ readdir }, paths, secureFs, socmintStore, jsonFs] = await Promise.all([
    import('node:fs/promises'),
    import('../storage/paths'),
    import('../storage/secure-fs'),
    import('../socmint/store'),
    import('../storage/json-fs'),
  ]);

  const { secureReadFile, secureReadText } = secureFs;

  // Destination writer: the SOCMINT item store bound to the SAME per-namespace items path the
  // production reader consumes — scrapingCaseItemsFile(ns, mainCaseId), i.e. what
  // window.api.{socmint,x}.listItems(mainCaseId) reads (socmint/store.ts prod listItems/listXItems).
  // Writing here (not the orphaned caseDir sidecar, which no post-W4 reader opens) is what makes
  // the imported items actually surface in the main case. Keyed by `ns` so an X import lands in
  // the x store the X reader looks in, and a socmint import in the socmint store.
  const mainStore = socmintStore.makeSocmintStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureFs.secureWriteFile(p, d),
    itemsPath: (id) => paths.scrapingCaseItemsFile(ns, id),
    jobsPath: (id) => paths.scrapingCaseJobsFile(ns, id),
  });

  // Source reader: the scraping-case item store for `ns` (`<ns>-items.json`) — same helper,
  // keyed by the SOURCE scraping-case id.
  const srcStore = socmintStore.makeSocmintStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureFs.secureWriteFile(p, d),
    itemsPath: (id) => paths.scrapingCaseItemsFile(ns, id),
    jobsPath: (id) => paths.scrapingCaseJobsFile(ns, id),
  });

  const deps: ScrapingImporterDeps = {
    readItems: (_ns, id) => srcStore.listItems(id),
    upsertMainItems: (mainId, items) => mainStore.upsertItems(mainId, items),
    readArtifacts: async (n, id) => {
      let names: string[];
      try {
        names = await readdir(paths.scrapingCaseArtifactsDir(n, id));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
      const out: { name: string; content: string }[] = [];
      for (const name of names.sort()) {
        const content = await secureReadText(paths.scrapingCaseArtifactFile(n, id, name));
        out.push({ name, content });
      }
      return out;
    },
    writeMainNote: (mainId, name, body) => jsonFs.noteStore.write(mainId, name, body),
  };

  return importScrapingCaseToMainCase(deps, ns, scrapingCaseId, mainCaseId);
}
