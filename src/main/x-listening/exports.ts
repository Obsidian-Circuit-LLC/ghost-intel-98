/**
 * X Listening Station — evidence-preserving file exports (Enterprise port, Task 11).
 *
 * Wraps the already-hardened X8 serializers (`itemsToJson`/`itemsToCsv`/`buildXItemsHtml`,
 * `./ipc.ts` — formula-guarded via `csvCell`, HTML-escaped via `escapeField`, already
 * unit-tested in `test/x-listening-export.test.ts`) with the two things Enterprise's own
 * export path had that the X8 surface didn't need until now:
 *
 *  1. **A SHA-256 checksum sidecar** written alongside the exported file — ported from the
 *     quarantined `writeChecksumSidecar` (`electron/main.cjs:2094-2101`): `<path>.sha256.txt`
 *     holds `<hex digest>  <basename>\n`, so a reviewer can verify the exported file wasn't
 *     altered after export without re-deriving anything from the (possibly reopened) case.
 *  2. **Synthetic/demo exclusion** — the Global Constraints honesty rule: a demo/seeded
 *     record (`XPostArtifact.synthetic === true`, Task 12) must never leak into an export or
 *     be counted/hashed as if it were real collected intel. This module reads from the
 *     richer `x-posts.json` sidecar (`store.posts`, Task 1) — the ONLY captured-item store
 *     that actually carries a `synthetic` flag — and filters it out BEFORE any serialization,
 *     hashing, or count is produced (so the sha256 sidecar is a checksum of the real-intel-only
 *     file, and `count` in the result is the honest number of real records exported).
 *
 * `XPostArtifact extends HarvestedItem` (store.ts), so the filtered array is a structurally
 * valid `readonly HarvestedItem[]` for the X8 serializers without any adaptation.
 *
 * KNOWN GAP (not this task's job to fix, flagged rather than silently shipped): the X8
 * serializers' metric columns (`itemsToCsv`'s `metricRaw`, `buildXItemsHtml`'s per-item
 * metrics line) read a NESTED `item.metrics.<name>.raw` shape — the shape `XHarvestedItem`
 * (extract.ts) stores in `x-items.json`. `XPostArtifact.metrics`/`.metricsRaw` (store.ts,
 * Task 1) are FLAT, separate fields on the richer artifact this module reads from, so an
 * export built here shows blank metric columns rather than the verbatim platform string.
 * The full evidentiary record (`metrics`, `metricsRaw`, `evidenceHash`) is NOT lost, though:
 * the JSON export is a straight `JSON.stringify` of the untouched artifact, so every field —
 * including `metricsRaw` and `evidenceHash` — round-trips there. Reconciling the two
 * `metrics` shapes across the dual `x-items.json`/`x-posts.json` persistence is cross-cutting
 * (touches extract.ts/capture.ts/ipc.ts) and out of scope for an exports-only task; the JSON
 * export remains the evidence-complete format in the meantime.
 *
 * Quarantine-clean / lazy-import discipline: no static `electron`/`node:fs` import — the
 * production store read and file write are lazy dynamic imports inside `defaultDeps()`
 * (mirrors `media.ts`/`capture.ts`), so importing this module — or calling it with full
 * `overrides`, as tests do — never touches electron or the real filesystem.
 *
 * `writeFile` here is a PLAIN filesystem write, not secure-fs — by design, matching the
 * app's existing export convention (`searchlight/export-pdf.ts`'s `fs.writeFile` after a
 * save dialog): an export is the analyst's own chosen, explicit hand-off of the case's
 * (already-reviewed, already-decrypted-in-memory) intel to a destination OUTSIDE the
 * encrypted vault. The Global Constraints "never `fs.writeFile` intel data" rule targets
 * data persisted AT REST inside `scrapingCaseDir` — it does not forbid writing the file the
 * user explicitly asked to export.
 */
import { createHash } from 'node:crypto';
import { itemsToJson, itemsToCsv, buildXItemsHtml } from './ipc';
import type { XPostArtifact } from './store';

/** The file formats this module can produce — Task 11's scope, per the design doc's export
 *  bullet, is JSON/PDF/CSV (the DOCX/base64 `exportXItems` surface these builders used to
 *  additionally feed was retired at Task 16 along with the rest of the clearnet-only X8 IPC
 *  surface; `itemsToJson`/`itemsToCsv`/`buildXItemsHtml` themselves survive in `ipc.ts`). */
export type XExportFileFormat = 'json' | 'csv' | 'pdf';

export interface XExportWriteResult {
  filePath: string;
  /** Real-intel record count — synthetic/demo posts are excluded before this is computed. */
  count: number;
  /** Hex sha256 digest of the exported file's bytes. */
  sha256: string;
  /** `<filePath>.sha256.txt` — the checksum sidecar path. */
  checksumPath: string;
}

/** Injectable seams so the orchestration is testable without electron/the real filesystem. */
export interface XExportDeps {
  /** Read the case's richer post artifacts (the only store with a `synthetic` flag). */
  readPosts: (caseId: string) => Promise<XPostArtifact[]>;
  /** Render a self-contained HTML document to a PDF Buffer (the app's existing exporter). */
  htmlToPdf: (html: string) => Promise<Buffer>;
  /** Write bytes/text to an absolute path — production default is a plain fs write (see the
   *  module doc: exports are an explicit hand-off OUTSIDE the encrypted vault, not at-rest
   *  intel storage). */
  writeFile: (path: string, data: Buffer | string) => Promise<void>;
}

function defaultDeps(): XExportDeps {
  return {
    readPosts: async (caseId) => {
      const { prodXStore } = await import('./store');
      return (await prodXStore()).posts.read(caseId);
    },
    htmlToPdf: async (html) => (await import('../services/export')).htmlToPdf(html),
    writeFile: async (path, data) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, data);
    }
  };
}

/**
 * Exclude synthetic/demo posts (Global Constraints honesty rule). A record is real,
 * exportable intel only when `synthetic` is NOT `true` — an absent/undefined flag (every
 * genuinely-captured `XPostArtifact`) passes through unchanged.
 */
export function excludeSynthetic(posts: readonly XPostArtifact[]): XPostArtifact[] {
  return posts.filter((post) => post.synthetic !== true);
}

function sha256Hex(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return createHash('sha256').update(buf).digest('hex');
}

/** The basename of a path, independent of the platform separator style baked into the
 *  input (mirrors the quarantine's `path.basename` without needing a `node:path` import
 *  here — the whole point of this helper is staying dependency-light). */
function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Write a `<filePath>.sha256.txt` sidecar next to an already-written export — ported
 * (behaviorally) from the quarantined `writeChecksumSidecar` (`electron/main.cjs:2094-2101`).
 * The sidecar line format (`<hex digest>  <basename>\n`) matches the standard `sha256sum`
 * output line, so it verifies with `sha256sum -c` unmodified.
 *
 * Exported (Task 15) so the interactive save-dialog export orchestration below — and the
 * network-CSV export, which is not a per-post `XPostArtifact` export and so never goes
 * through `exportXPostsToFile` — can both get the identical checksum-sidecar guarantee
 * without duplicating the digest/basename logic.
 */
export async function writeChecksumSidecar(
  deps: Pick<XExportDeps, 'writeFile'>,
  filePath: string,
  data: Buffer | string
): Promise<{ sha256: string; checksumPath: string }> {
  const digest = sha256Hex(data);
  const checksumPath = `${filePath}.sha256.txt`;
  await deps.writeFile(checksumPath, `${digest}  ${basename(filePath)}\n`);
  return { sha256: digest, checksumPath };
}

/**
 * Export a case's captured X posts to `filePath` in `format`, honesty-enforced end to end:
 * synthetic/demo posts are read from the store but dropped BEFORE serialization, so they are
 * never written, never counted, and never folded into the checksum. Writes the serialized
 * export to `filePath`, then a SHA-256 checksum sidecar alongside it.
 *
 * `format:'pdf'` renders `buildXItemsHtml`'s escaped HTML through the injected `htmlToPdf`
 * (the app's existing offscreen-BrowserWindow exporter — no new PDF dependency).
 */
export async function exportXPostsToFile(
  caseId: string,
  format: XExportFileFormat,
  filePath: string,
  overrides: Partial<XExportDeps> = {}
): Promise<XExportWriteResult> {
  const deps: XExportDeps = { ...defaultDeps(), ...overrides };
  const allPosts = await deps.readPosts(caseId);
  const posts = excludeSynthetic(allPosts);

  let data: Buffer | string;
  if (format === 'json') {
    data = itemsToJson(posts);
  } else if (format === 'csv') {
    data = itemsToCsv(posts);
  } else {
    data = await deps.htmlToPdf(buildXItemsHtml(caseId, posts));
  }

  await deps.writeFile(filePath, data);
  const checksum = await writeChecksumSidecar(deps, filePath, data);
  return { filePath, count: posts.length, ...checksum };
}
