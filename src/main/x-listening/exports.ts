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
import { normalizeXSourceKey } from '@shared/x-listening-source';
import { itemsToJson, itemsToCsv, buildXItemsHtml } from './ipc';
import type { XPostArtifact, XNote, XEntityCacheEntry, XProfileSnapshot } from './store';
import type { AnalysisRelationship, NetworkAnalysis } from './analysis';

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
  /** Serialize the JSON export from the (already synthetic-excluded) `posts` (FB4, audit
   *  HIGH #10). Production wires the full self-describing MANIFEST envelope (format/schemaVersion/
   *  provenance/manifestHash + the case's notes/matches/entities/profiles); OMITTED here so this
   *  low-level exporter's own default stays the plain round-trippable array (`itemsToJson`) — the
   *  envelope is assembled one layer up (`ipc.ts`'s interactive export), which has the case-scoped
   *  store reads the envelope needs. */
  serializeJson?: (caseId: string, posts: XPostArtifact[], filters?: XExportFilters) => Promise<string> | string;
  /** Read the case's analyst notes so the PDF export can restore the per-post analyst-notes
   *  section (M9, audit medium — his `main.cjs:2159-2166`). OMITTED here so the low-level
   *  exporter needs no store; production wires the case-scoped read one layer up (`ipc.ts`'s
   *  interactive export), mirroring `serializeJson`. Absent ⇒ the PDF renders no notes section. */
  readNotes?: (caseId: string) => Promise<XNote[]>;
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
 * M15: per-export SOURCE / TYPE / QUERY filters (his `exportData` filters, main.cjs export path;
 * renderer controls at main.tsx:349). `source` is a normalized source key ('all'/'' = no filter),
 * `kind` a post kind ('all'/'' = no filter), `query` a case-insensitive substring over post text +
 * @handle. Applied AFTER synthetic-exclusion so a demo record can never be surfaced by a filter.
 */
export interface XExportFilters {
  source?: string;
  kind?: string;
  query?: string;
}

/** Apply the M15 export filters to an already-synthetic-excluded post list (pure, deterministic). */
export function applyExportFilters(
  posts: readonly XPostArtifact[],
  filters: XExportFilters | undefined,
): XPostArtifact[] {
  const source = (filters?.source ?? '').trim();
  const kind = (filters?.kind ?? '').trim();
  const q = (filters?.query ?? '').trim().toLowerCase();
  const hasSource = !!source && source !== 'all';
  const hasKind = !!kind && kind !== 'all';
  return posts.filter((p) => {
    if (hasSource) {
      const key = normalizeXSourceKey(
        (p as { channelId?: unknown }).channelId != null
          ? String((p as { channelId?: unknown }).channelId)
          : String(p.authorHandle ?? ''),
      );
      if (key !== source) return false;
    }
    if (hasKind && String((p as { kind?: unknown }).kind ?? '') !== kind) return false;
    if (q) {
      const hay = `${String(p.text ?? '')} ${String(p.authorHandle ?? '')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
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
  overrides: Partial<XExportDeps> = {},
  filters?: XExportFilters
): Promise<XExportWriteResult> {
  const deps: XExportDeps = { ...defaultDeps(), ...overrides };
  const allPosts = await deps.readPosts(caseId);
  // M15: synthetic-exclusion FIRST (honesty rule — a filter must never surface a demo record),
  // THEN the per-export SOURCE / TYPE / QUERY filters. count/csv/pdf/json all see the same set.
  const posts = applyExportFilters(excludeSynthetic(allPosts), filters);

  let data: Buffer | string;
  if (format === 'json') {
    // FB4 (audit HIGH #10): production wires `serializeJson` to the self-describing manifest
    // envelope (M15: the applied filters ride into the envelope's `filters` metadata); absent it,
    // the low-level default is the plain round-trippable array.
    data = deps.serializeJson ? await deps.serializeJson(caseId, posts, filters) : itemsToJson(posts);
  } else if (format === 'csv') {
    data = itemsToCsv(posts);
  } else {
    // M9: thread the case's analyst notes into the PDF so the per-post notes section renders.
    // `readNotes` is optional (mirrors `serializeJson`); absent ⇒ no notes, footer evidence
    // fields still render from each artifact.
    const notes = deps.readNotes ? await deps.readNotes(caseId) : [];
    const notesByPost = new Map<string, XNote[]>();
    for (const note of notes) {
      const list = notesByPost.get(note.findingId);
      if (list) list.push(note);
      else notesByPost.set(note.findingId, [note]);
    }
    data = await deps.htmlToPdf(buildXItemsHtml(caseId, posts, notesByPost));
  }

  await deps.writeFile(filePath, data);
  const checksum = await writeChecksumSidecar(deps, filePath, data);
  return { filePath, count: posts.length, ...checksum };
}

// ---- FB4 (audit HIGH #10): self-describing JSON manifest envelope --------
// Enterprise's `exportJson`/`exportRelationshipsJson` never wrote a bare array — they wrote a
// self-describing envelope (`main.cjs:2116-2134` / `2485-2490`): a format string, schema version,
// the case + applied filters, the collected records, a provenance block, and a top-level
// `manifestHash` over the payload. We restore that, KEEPING our hardening: synthetic posts/accounts
// are excluded before anything is hashed or counted (the builder callers pass already-filtered
// data; the posts builder also excludes defensively), and the `manifestHash` is DETERMINISTIC —
// `stableStringify` sorts keys recursively so insertion order can't move the digest, and the
// time-varying `exportedAt` (and the analysis `generatedAt` clock) are NEVER folded into the hash
// (his `sha256(payload)` hashed `exportedAt`, so his manifest hash was not reproducible). The
// pure builders below take fully-read data so they are trivially testable; the case-scoped store
// reads that populate them live one layer up in `ipc.ts`.

/** The self-describing format tag written into a posts export (his `format`, rebranded). */
export const X_EXPORT_FORMAT = 'Ghost Intel 98 X Listening Station Export';
/** The self-describing format tag written into a network export. */
export const X_NETWORK_EXPORT_FORMAT = 'Ghost Intel 98 X Listening Station Network Export';
/** Export schema version — bumped when the envelope shape changes. */
export const X_EXPORT_SCHEMA_VERSION = 1;
/** The provenance block — how the intel was collected + the record hash algorithm (his
 *  `provenance`). `collectionMethod` is honest: an authenticated in-app browser session. */
export const X_EXPORT_PROVENANCE = {
  collectionMethod: 'authenticated_browser',
  generatedBy: 'Ghost Intel 98 X Listening Station',
  recordHashAlgorithm: 'SHA-256',
} as const;

/** One preset match recorded in the manifest (his `matches` row) — the post a saved highlight
 *  preset matched, which preset, and the specific keywords, so the export self-documents WHY a
 *  post is flagged. */
export interface XExportPresetMatch {
  presetId: string;
  presetName: string;
  postId: string;
  matchedKeywords: string[];
}

/** The self-describing posts export envelope (his `exportJson` payload). */
export interface XPostsExportEnvelope {
  format: string;
  schemaVersion: number;
  /** Injected-clock provenance — NOT folded into `manifestHash`. */
  exportedAt: string;
  case: unknown;
  filters: Record<string, unknown>;
  profiles: XProfileSnapshot[];
  posts: XPostArtifact[];
  notes: XNote[];
  matches: XExportPresetMatch[];
  entities: XEntityCacheEntry[];
  provenance: { collectionMethod: string; generatedBy: string; recordHashAlgorithm: string };
  /** Deterministic sha256 over the payload MINUS `exportedAt`/`manifestHash` (stable key order). */
  manifestHash: string;
}

/** The self-describing network export envelope (his `exportRelationshipsJson` payload). */
export interface XNetworkExportEnvelope {
  format: string;
  exportedAt: string;
  case: unknown;
  filters: Record<string, unknown>;
  relationships: AnalysisRelationship[];
  analysis: NetworkAnalysis;
  manifestHash: string;
}

/** Recursive, key-sorted serialization so `manifestHash` is stable regardless of the runtime
 *  insertion order of any object in the payload (his plain `JSON.stringify` was order-dependent). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Deterministic sha256 of an arbitrary payload via `stableStringify` (no `Date.now()` reaches
 *  this — callers pass a payload with every time-varying field already stripped). */
export function manifestHashOf(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

/** Pretty-print an envelope for the exported file (matches his `JSON.stringify(payload, null, 2)`). */
export function serializeExportEnvelope(env: unknown): string {
  return JSON.stringify(env, null, 2);
}

/**
 * Build the posts export envelope from already-read case data. Synthetic/demo posts are excluded
 * here (defense in depth — callers also pre-filter), so they are never written, counted, or
 * hashed. `manifestHash` is computed over the envelope EXCEPT `exportedAt` (provenance) and the
 * hash field itself, so re-exporting the same intel at a different time reproduces the same digest.
 */
export function buildPostsExportEnvelope(input: {
  case: unknown;
  filters?: Record<string, unknown>;
  profiles: readonly XProfileSnapshot[];
  posts: readonly XPostArtifact[];
  notes: readonly XNote[];
  matches: readonly XExportPresetMatch[];
  entities: readonly XEntityCacheEntry[];
  exportedAt: string;
}): XPostsExportEnvelope {
  const posts = excludeSynthetic(input.posts);
  const hashBase = {
    format: X_EXPORT_FORMAT,
    schemaVersion: X_EXPORT_SCHEMA_VERSION,
    case: input.case ?? null,
    filters: input.filters ?? {},
    profiles: [...input.profiles],
    posts,
    notes: [...input.notes],
    matches: [...input.matches],
    entities: [...input.entities],
    provenance: { ...X_EXPORT_PROVENANCE },
  };
  const manifestHash = manifestHashOf(hashBase);
  return {
    format: hashBase.format,
    schemaVersion: hashBase.schemaVersion,
    exportedAt: input.exportedAt,
    case: hashBase.case,
    filters: hashBase.filters,
    profiles: hashBase.profiles,
    posts: hashBase.posts,
    notes: hashBase.notes,
    matches: hashBase.matches,
    entities: hashBase.entities,
    provenance: hashBase.provenance,
    manifestHash,
  };
}

/**
 * Build the network export envelope embedding the `computeNetworkAnalysis` result. Synthetic
 * relationships are dropped from the exported list (honesty — a demo account must never export as
 * real intel; `computeNetworkAnalysis` already excludes them from the embedded analysis). The
 * `manifestHash` excludes `exportedAt` AND the analysis `generatedAt` clock, so it is deterministic
 * regardless of when the export ran.
 */
export function buildNetworkExportEnvelope(input: {
  case: unknown;
  filters?: Record<string, unknown>;
  relationships: readonly AnalysisRelationship[];
  analysis: NetworkAnalysis;
  exportedAt: string;
}): XNetworkExportEnvelope {
  const relationships = input.relationships.filter((r) => !r.synthetic);
  const filters = input.filters ?? {};
  const caseRec = input.case ?? null;
  // Zero the injected analysis clock for hashing only — the emitted envelope keeps the real value.
  const analysisForHash = { ...input.analysis, generatedAt: '' };
  const manifestHash = manifestHashOf({
    format: X_NETWORK_EXPORT_FORMAT,
    case: caseRec,
    filters,
    relationships,
    analysis: analysisForHash,
  });
  return {
    format: X_NETWORK_EXPORT_FORMAT,
    exportedAt: input.exportedAt,
    case: caseRec,
    filters,
    relationships,
    analysis: input.analysis,
    manifestHash,
  };
}
