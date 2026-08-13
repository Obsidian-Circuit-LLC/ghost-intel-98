/**
 * X Listening Station — notes/presets/export helpers + Phase-1/2 Enterprise-port IPC
 * registration (`registerXListeningIpc`).
 *
 * The clearnet-only X1-X8 surface this file used to host (connect/status/capture/
 * captureThreadComments/captureFollowers/captureFollowing/exportNetwork/runArchiveCycle(s)/
 * exportItems, all driving an unproxied `xWindow`) was retired wholesale at Task 16 once the
 * renderer (Task 13-15) stopped calling any of it — see `test/x-listening-whole-module-seam.test.ts`
 * for the standing invariant that pins the retirement. Every capture path this module now wires
 * is Tor-safe: sessions/windows live in `session.ts` (Tor-default, fail-closed, acked-clearnet
 * opt-in), timeline capture in `capture.ts`, network capture accumulation in `extract.ts`, and
 * archive cycles in `archive.ts`. This file keeps the surviving X6 analyst-notes store ops (pure,
 * namespace-agnostic — no Tor/clearnet trust-boundary distinction), the Task 10 preset local
 * search, the X8 JSON/CSV/HTML serializers `exports.ts` reuses, the Task 15 interactive
 * (save-dialog-gated) file exports, and the `registerXListeningIpc` wiring for all of it plus the
 * Phase-1/2 Enterprise-port handlers (Task 6).
 */

import { channels } from '@shared/ipc-contracts';
import { normalizeXSourceKey } from '@shared/x-listening-source';
import { assertTrustedSender } from '../capture/capture-window';
import { csvCell, escapeField } from '../capture/security';
import type { HarvestedItem } from '@shared/socmint/types';
import { networkToCsv } from './extract';
import { collectGateFromSettings, type XCollectionSettings } from '@shared/x-listening-collection-settings';
import { getCollectionSettings, saveCollectionSettings } from './collection-settings';
import { normalizeImageMode, type XImageMode } from '@shared/x-listening-image-policy';
import { getImagePolicy, setProfileImageMode, resolveEffectiveImageCollection } from './image-policy';
import { restartSchedule, stopSchedule, scheduleStatus } from './scheduler';
import { repairAvatars } from './avatar-repair';
import { prodXStore } from './store';
import type { XNote, XPostArtifact, XNetworkArtifact, XPreset, XEntityCacheEntry } from './store';
import { ensureUuid } from '../security/validate';

// ---- Phase-1 Enterprise-port surface (Task 6) ----------------------------
import {
  connectXSession as openXSession,
  getXStatus as getXSessionStatus,
  clearXSession as closeXSession,
  getXWindow,
  navigateXToProfile
} from './session';
import {
  captureTimeline,
  captureNetwork,
  verifyPost,
  openInX,
  type XTimelineCaptureRequest,
  type XOpenKind
} from './capture';
import {
  listCampaigns,
  createCampaign,
  switchCampaign,
  updateCampaign,
  deleteCampaign,
  duplicateCampaign
} from './campaigns';
import { getCampaignMeta, setCampaignMeta } from './campaign-meta';
import type { XCampaignMeta } from './campaign-meta';
import {
  computeNetworkAnalysis,
  deriveCollectionHealth,
  extractEntities,
  flattenNetworkArtifacts,
  type AnalysisProfile,
  type AnalysisRelationship
} from './analysis';
import { runArchiveSteps } from './archive';
import { loadDemoData } from './demo';
import { readCachedMedia } from './media';
import {
  exportXPostsToFile,
  writeChecksumSidecar,
  type XExportFileFormat,
  type XExportWriteResult
} from './exports';

// ---- X5: network export (the direct, non-file-write CSV-string surface `exportNetworkInteractive`
// falls back to below; the accumulator/capture itself lives in `extract.ts`/`demo.ts`) --------

/**
 * Read a case's captured networks and serialize them to a formula-guarded CSV string.
 * The renderer hands the returned text to the app's existing file-save flow; every
 * cell is neutralized by `csvCell` (via `networkToCsv`) so a scraped bio can never
 * execute as a spreadsheet formula.
 */
export async function exportNetworkCsv(caseId: string): Promise<{ csv: string; count: number }> {
  const artifacts = await (await prodXStore()).networks.read(caseId);
  // Honesty (charter): demo/seeded accounts (synthetic:true) must NEVER be exported as real
  // intel — strip them from every artifact before serialising, and count only the real rows.
  const real = artifacts.map((a) => ({
    ...a,
    accounts: (a.accounts ?? []).filter((acc) => !acc.synthetic)
  }));
  const count = real.reduce((n, a) => n + a.accounts.length, 0);
  return { csv: networkToCsv(real), count };
}

// ---- X6: analyst notes --------------------------------------------------

/** The longest note the store will accept — ported from quarantine `main.cjs:1310`. */
export const NOTE_MAX_LENGTH = 20000;

/** A note-save/read request from the renderer. `savedAt` is stamped MAIN-side. */
export interface SaveNoteRequest {
  caseId: string;
  /** The finding the note is pinned to (one note per finding). */
  findingId: string;
  text: string;
}

/** Injectable seams so the notes orchestration is testable without electron/secure-fs. */
export interface NotesDeps {
  /** Upsert one note keyed by findingId → the fresh note list. */
  saveNote: (caseId: string, findingId: string, text: string, savedAt: string) => Promise<XNote[]>;
  /** Read the case's notes. */
  readNotes: (caseId: string) => Promise<XNote[]>;
  /** Injected clock — the ISO `savedAt` stamped onto the note (determinism). */
  now: () => string;
}

function defaultNotesDeps(): NotesDeps {
  return {
    saveNote: async (caseId, findingId, text, savedAt) =>
      (await prodXStore()).notes.save(caseId, findingId, text, savedAt),
    readNotes: async (caseId) => (await prodXStore()).notes.read(caseId),
    now: () => new Date().toISOString()
  };
}

/**
 * Save (upsert) an analyst note against a finding. The text is trimmed and validated
 * (non-empty, ≤ NOTE_MAX_LENGTH) — ported from the quarantine `notes:add`/`notes:update`
 * guards (`main.cjs:1308-1310`, `1321-1323`) — and `savedAt` is stamped MAIN-side from
 * the injected clock, never accepted from the renderer. Returns the fresh note list.
 */
export async function saveNote(
  req: SaveNoteRequest,
  overrides: Partial<NotesDeps> = {}
): Promise<{ notes: XNote[] }> {
  const findingId = String(req?.findingId ?? '').trim();
  if (!findingId) {
    throw new Error('A note must be attached to a finding.');
  }
  const text = String(req?.text ?? '').trim();
  if (!text) {
    throw new Error('Note text is required.');
  }
  if (text.length > NOTE_MAX_LENGTH) {
    throw new Error(`Note is too long. Maximum length is ${NOTE_MAX_LENGTH} characters.`);
  }
  const deps = { ...defaultNotesDeps(), ...overrides };
  const notes = await deps.saveNote(req.caseId, findingId, text, deps.now());
  return { notes };
}

/** Read a case's analyst notes (encrypted `notes` artifact store). */
export async function readNotes(
  caseId: string,
  overrides: Partial<NotesDeps> = {}
): Promise<{ notes: XNote[] }> {
  const deps = { ...defaultNotesDeps(), ...overrides };
  return { notes: await deps.readNotes(caseId) };
}

/** Injectable seams for `removeNote` — read+filter+write over the `notes` sidecar. The
 *  store (Task 1) has no dedicated `notes.remove`; a delete is a read-filter-write, same
 *  primitive the store's own `write` already exposes. */
export interface RemoveNoteDeps {
  readNotes: (caseId: string) => Promise<XNote[]>;
  writeNotes: (caseId: string, notes: XNote[]) => Promise<void>;
}

function defaultRemoveNoteDeps(): RemoveNoteDeps {
  return {
    readNotes: async (caseId) => (await prodXStore()).notes.read(caseId),
    writeNotes: async (caseId, notes) => (await prodXStore()).notes.write(caseId, notes)
  };
}

/**
 * Delete the note attached to `findingId`, if any (Task 10). A findingId with no note is a
 * harmless no-op — the store is still re-written with the unchanged list so this always
 * returns the CURRENT fresh list (the same "returns the fresh list" contract as `saveNote`).
 * Rejects a blank `findingId` before touching the store, mirroring `saveNote`'s guard.
 */
export async function removeNote(
  caseId: string,
  findingId: string,
  overrides: Partial<RemoveNoteDeps> = {}
): Promise<{ notes: XNote[] }> {
  const id = String(findingId ?? '').trim();
  if (!id) {
    throw new Error('A note must be attached to a finding.');
  }
  const deps = { ...defaultRemoveNoteDeps(), ...overrides };
  const existing = await deps.readNotes(caseId);
  const notes = existing.filter((note) => note.findingId !== id);
  await deps.writeNotes(caseId, notes);
  return { notes };
}

// ---- X8: export serializers — reused by exports.ts (Task 11) and the Task 15 interactive
// (save-dialog-gated) file exports below. -----------------------------------------------

/**
 * CSV columns for an X items export. The four metric columns carry the VERBATIM
 * rounded display token (e.g. `"1.2K"`) exactly as X rendered it — NEVER a
 * false-precision expanded integer (the review's false-precision finding). `verified`
 * is always `false` and `provenance` is always `visible-capture` (the honesty stamps).
 */
export const X_ITEMS_CSV_HEADER = [
  'kind',
  'handle',
  'author_id',
  'published_at',
  'harvested_at',
  'text',
  'url',
  'likes',
  'reposts',
  'replies',
  'views',
  'media_count',
  'verified',
  'provenance'
] as const;

/** A flat, export-facing view of a captured item. The store returns the base
 *  `HarvestedItem` type; the X-specific `metrics`/`kind`/`media`/honesty fields ride
 *  along at runtime (they were persisted by `normalizePost` et al.), read here
 *  defensively so a legacy or partial record never throws mid-export. */
interface XItemView {
  kind: string;
  handle: string;
  authorId: string;
  publishedAt: string;
  harvestedAt: string;
  text: string;
  url: string;
  likes: string;
  reposts: string;
  replies: string;
  views: string;
  mediaCount: number;
  /** Local `data:` thumbnails only — a remote URL is dropped, never carried to an <img src>. */
  media: string[];
  verified: boolean;
  provenance: string;
}

/** The runtime superset of a captured item — the X-specific fields the store round-trips. */
type XItemRuntime = HarvestedItem & {
  kind?: string;
  media?: unknown;
  verified?: unknown;
  captureProvenance?: unknown;
  metrics?: Record<string, { raw?: unknown } | undefined>;
};

/** The verbatim display token of one metric, or '' — never an expanded integer. */
function metricRaw(item: XItemRuntime, name: string): string {
  return String(item.metrics?.[name]?.raw ?? '');
}

/** Project a stored item to its flat export view. Remote media is filtered out here
 *  too (defense in depth) — only `data:` thumbnails survive to any rendered document. */
function viewItem(raw: HarvestedItem): XItemView {
  const item = raw as XItemRuntime;
  const media = Array.isArray(item.media)
    ? item.media.map((m) => String(m ?? '')).filter((m) => m.startsWith('data:'))
    : [];
  return {
    kind: String(item.kind ?? ''),
    handle: String(item.authorHandle ?? ''),
    authorId: String(item.authorId ?? ''),
    publishedAt: String(item.publishedAt ?? ''),
    harvestedAt: String(item.harvestedAt ?? ''),
    text: String(item.text ?? ''),
    url: String(item.url ?? ''),
    likes: metricRaw(item, 'likes'),
    reposts: metricRaw(item, 'reposts'),
    replies: metricRaw(item, 'replies'),
    views: metricRaw(item, 'views'),
    mediaCount: media.length,
    media,
    // Honesty stamps are NOT trusted from the record — they are what this collector
    // guarantees. A visible-DOM capture is never verified; the provenance is fixed.
    verified: false,
    provenance: 'visible-capture'
  };
}

/** JSON export — a direct, round-trippable serialization of the captured items. */
export function itemsToJson(items: readonly HarvestedItem[] | undefined): string {
  return JSON.stringify(items ?? [], null, 2);
}

/**
 * CSV export of the captured items, formula-injection safe. EVERY cell is routed
 * through `csvCell` — so a scraped tweet body like `=cmd|calc` is neutralized as
 * literal text (the review's spreadsheet formula-injection finding). Metrics are the
 * verbatim rounded tokens (honesty). A leading BOM + CRLF line endings match the app's
 * other CSV exports (mirrors `networkToCsv`).
 */
export function itemsToCsv(items: readonly HarvestedItem[] | undefined): string {
  const lines: string[] = [X_ITEMS_CSV_HEADER.map((h) => csvCell(h)).join(',')];
  for (const raw of items ?? []) {
    const v = viewItem(raw);
    lines.push(
      [
        v.kind,
        v.handle,
        v.authorId,
        v.publishedAt,
        v.harvestedAt,
        v.text,
        v.url,
        v.likes,
        v.reposts,
        v.replies,
        v.views,
        String(v.mediaCount),
        String(v.verified),
        v.provenance
      ]
        .map((cell) => csvCell(String(cell ?? '')))
        .join(',')
    );
  }
  return `﻿${lines.join('\r\n')}`;
}

/**
 * Build a self-contained HTML document of the captured items — the source the PDF
 * exporter (`htmlToPdf`) renders. EVERY scraped field is `escapeField`-escaped, so a
 * `<script>` tweet body appears as inert text, never live markup. Media is inlined
 * ONLY as `data:` thumbnails (`viewItem` already dropped any remote URL) — a remote
 * `src` must never reach an `<img>` and beacon the analyst's view (the review's media
 * finding). No remote CSS/JS/fonts — fully offline, matching the app's other exports.
 */
export function buildXItemsHtml(caseId: string, items: readonly HarvestedItem[] | undefined): string {
  const rows = (items ?? [])
    .map((raw) => {
      const v = viewItem(raw);
      const imgs = v.media
        .map((src) => `<img src="${escapeField(src)}" alt="captured media"/>`)
        .join('');
      const metrics = `likes ${escapeField(v.likes || '—')} · reposts ${escapeField(
        v.reposts || '—'
      )} · replies ${escapeField(v.replies || '—')} · views ${escapeField(v.views || '—')}`;
      return (
        `<article class="x-item">` +
        `<header><span class="handle">${escapeField(v.handle)}</span> ` +
        `<span class="kind">${escapeField(v.kind)}</span> ` +
        `<time>${escapeField(v.publishedAt)}</time></header>` +
        `<p class="text">${escapeField(v.text)}</p>` +
        (imgs ? `<div class="media">${imgs}</div>` : '') +
        `<footer class="metrics">${metrics}</footer>` +
        (v.url ? `<footer class="url">${escapeField(v.url)}</footer>` : '') +
        `<footer class="stamp">visible-capture · unverified</footer>` +
        `</article>`
      );
    })
    .join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"/>` +
    `<title>X Listening Station export</title>` +
    `<style>body{font-family:sans-serif;margin:24px;color:#111}` +
    `.x-item{border:1px solid #ccc;border-radius:6px;padding:12px;margin:0 0 12px}` +
    `.handle{font-weight:bold}.kind{color:#666}.text{white-space:pre-wrap}` +
    `.media img{max-width:160px;max-height:160px;margin:4px}` +
    `.metrics,.url,.stamp{color:#666;font-size:12px}</style></head>` +
    `<body><h1>X Listening Station export — ${escapeField(caseId)}</h1>` +
    `<p class="stamp">${(items ?? []).length} captured item(s) · visible-DOM capture · unverified</p>` +
    rows +
    `</body></html>`
  );
}

/** Strip path separators + illegal filename chars from an export basename. */
function sanitizeExportName(caseId: string, ext: string): string {
  const base =
    String(caseId ?? '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'case';
  return `x-listening-${base}.${ext}`;
}

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => void;

// ---- Phase-1 helpers (Task 6) --------------------------------------------

/**
 * Read the Tor-default posture opt-out MAIN-side and trusted: a lazy dynamic import (this
 * module never pulls the settings graph at import time) and a fail-CLOSED catch — any
 * settings-read error yields `false` (Tor mode), never a silent widen to clearnet.
 */
async function loadClearnetEnabled(): Promise<boolean> {
  try {
    const { settingsStore } = await import('../storage/json-fs');
    const settings = await settingsStore.read();
    return settings.xListening?.clearnet === true;
  } catch {
    return false;
  }
}

/**
 * Read a case's captured `networks` artifacts (store.ts, accumulated by Task 7's
 * `networks.save`) and flatten them into the `AnalysisProfile[]` / `AnalysisRelationship[]`
 * shape `computeNetworkAnalysis` (analysis.ts, Task 2) consumes — the actual flattening is
 * the pure `flattenNetworkArtifacts` (analysis.ts, Task 7); this is just the store read.
 */
async function buildNetworkAnalysisInputs(
  caseId: string
): Promise<{ profiles: AnalysisProfile[]; relationships: AnalysisRelationship[] }> {
  const store = await prodXStore();
  const artifacts = await store.networks.read(caseId);
  return flattenNetworkArtifacts(artifacts);
}

/**
 * Derive an entity rollup over a case's captured post artifacts (store.ts `posts`,
 * populated by capture.ts's `captureTimeline`) via `extractEntities` (analysis.ts, Task 2).
 * Computed fresh on every call — nothing here is persisted to the `entitiesCache` sidecar
 * (design doc: "derived-on-read"). Honesty: a `synthetic` (demo/seeded) post is excluded, same
 * as `computeNetworkAnalysis`'s synthetic-profile/relationship exclusion — a demo record must
 * never inflate real entity intel.
 */
function aggregateEntities(posts: readonly XPostArtifact[]): XEntityCacheEntry[] {
  const byKey = new Map<string, XEntityCacheEntry>();
  for (const post of posts) {
    if (post.synthetic) continue;
    for (const found of extractEntities(post.text)) {
      const key = `${found.type}:${found.normalizedValue}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          id: key,
          type: found.type,
          value: found.value,
          normalizedValue: found.normalizedValue,
          postIds: [],
          sourceUsernames: [],
          firstObservedAt: post.publishedAt,
          lastObservedAt: post.publishedAt,
          count: 0
        };
        byKey.set(key, entry);
      }
      if (post.id && !entry.postIds.includes(post.id)) entry.postIds.push(post.id);
      if (post.authorHandle && !entry.sourceUsernames.includes(post.authorHandle)) {
        entry.sourceUsernames.push(post.authorHandle);
      }
      entry.count += 1;
      if (post.publishedAt) {
        if (!entry.firstObservedAt || post.publishedAt < entry.firstObservedAt) {
          entry.firstObservedAt = post.publishedAt;
        }
        if (!entry.lastObservedAt || post.publishedAt > entry.lastObservedAt) {
          entry.lastObservedAt = post.publishedAt;
        }
      }
    }
  }
  return [...byKey.values()];
}

// ---- Task 10: highlight presets — local search + remove ------------------
// `presets.read`/`presets.write`/`presets.save` (pure upsert-by-id) shipped with Task 1;
// `presetsRead`/`presetsSave` IPC shipped with Task 6. This adds the missing delete and the
// actual local-search matcher/runner, ported from quarantine `evaluatePreset`/
// `rebuildMatchesForPosts` (`main.cjs:1731-1768`).

/** One highlight-preset match: a post whose text satisfied the preset's keywords/mode/
 *  profile filter, and the specific keywords that matched (for renderer highlighting). */
export interface XPresetMatch {
  postId: string;
  matchedKeywords: string[];
}

/**
 * Evaluate ONE preset against ONE post → the keywords that matched (`[]` for no match).
 * Pure port of quarantine `evaluatePreset` (`main.cjs:1731-1747`):
 *  - `profileIds`, when non-empty, restricts matching to posts from those targets. Enterprise
 *    keyed this off a numeric `post.profileId`; this port's equivalent "which target was this
 *    captured from" field is `post.channelId` (the monitored timeline — `extract.ts`
 *    `NormalizeContext.channelId`).
 *  - keyword/text comparison respects `caseSensitive` (default false).
 *  - `mode:'all'` requires EVERY keyword to match, else `[]`; `mode:'any'` (default) returns
 *    whichever keywords matched.
 */
export function evaluatePreset(preset: XPreset, post: XPostArtifact): string[] {
  if (preset.profileIds.length && !preset.profileIds.includes(post.channelId)) {
    return [];
  }
  const source = preset.caseSensitive ? post.text : post.text.toLowerCase();
  const keywords = preset.keywords.map((k) => String(k).trim()).filter(Boolean);
  const matched = keywords.filter((keyword) => {
    const needle = preset.caseSensitive ? keyword : keyword.toLowerCase();
    return source.includes(needle);
  });
  if (preset.mode === 'all') {
    return matched.length === keywords.length ? matched : [];
  }
  return matched;
}

/** Injectable seams for `runPreset` — pure store reads, no capture window, no network. */
export interface PresetRunDeps {
  readPresets: (caseId: string) => Promise<XPreset[]>;
  readPosts: (caseId: string) => Promise<XPostArtifact[]>;
}

function defaultPresetRunDeps(): PresetRunDeps {
  return {
    readPresets: async (caseId) => (await prodXStore()).presets.read(caseId),
    readPosts: async (caseId) => (await prodXStore()).posts.read(caseId)
  };
}

/**
 * Run one saved preset (by id) over a case's captured posts → the matches, for local
 * highlight-search / renderer highlighting. Derived-on-read, never persisted — same
 * discipline as `computeNetworkAnalysis`/`aggregateEntities` (a `matches` sidecar would go
 * stale the moment a post is edited or removed). Honesty: a `synthetic` (demo/seeded) post
 * is excluded, defense-in-depth alongside `aggregateEntities`'s same filter — a demo record
 * must never surface as a "real" search hit.
 */
export async function runPreset(
  caseId: string,
  presetId: string,
  overrides: Partial<PresetRunDeps> = {}
): Promise<{ matches: XPresetMatch[] }> {
  const deps = { ...defaultPresetRunDeps(), ...overrides };
  const [presets, posts] = await Promise.all([deps.readPresets(caseId), deps.readPosts(caseId)]);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error('Preset not found in this campaign.');
  }
  const matches: XPresetMatch[] = [];
  for (const post of posts) {
    if (post.synthetic) continue;
    const matchedKeywords = evaluatePreset(preset, post);
    if (matchedKeywords.length) matches.push({ postId: post.id, matchedKeywords });
  }
  return { matches };
}

/** Injectable seams for `removePreset` — read+filter+write over the `presets` sidecar,
 *  mirroring `removeNote`'s shape (the store has no dedicated `presets.remove`). */
export interface RemovePresetDeps {
  readPresets: (caseId: string) => Promise<XPreset[]>;
  writePresets: (caseId: string, presets: XPreset[]) => Promise<void>;
}

function defaultRemovePresetDeps(): RemovePresetDeps {
  return {
    readPresets: async (caseId) => (await prodXStore()).presets.read(caseId),
    writePresets: async (caseId, presets) => (await prodXStore()).presets.write(caseId, presets)
  };
}

/** Delete the preset with the given id, if any (Task 10). An id with no preset is a
 *  harmless no-op that still returns the current fresh list, mirroring `removeNote`. */
export async function removePreset(
  caseId: string,
  presetId: string,
  overrides: Partial<RemovePresetDeps> = {}
): Promise<{ presets: XPreset[] }> {
  const deps = { ...defaultRemovePresetDeps(), ...overrides };
  const existing = await deps.readPresets(caseId);
  const presets = existing.filter((p) => p.id !== presetId);
  await deps.writePresets(caseId, presets);
  return { presets };
}

// ---- Task D1: per-source cascade removal (Target Sources REMOVE) ----------
// A "source" is not a first-class persisted record in the hardened core — it is DERIVED
// client-side from the captured posts (Enterprise's `state.profiles` was retired). So removing a
// source = deleting the evidence keyed to that username: its captured posts AND any follower/
// following network artifacts extracted FOR it. This is a read-filter-write over the `posts` and
// `networks` sidecars — the same primitive `removeNote`/`removePreset` already use (the store
// exposes no dedicated per-source delete). Pure filter (no `Date.now()`/RNG, no hash recompute —
// each surviving artifact is written back byte-for-byte, so evidence hashes are untouched).

/** Injectable seams for `removeSource` — read+filter+write over the `posts` and `networks`
 *  sidecars, mirroring `removeNote`/`removePreset`'s shape. */
export interface RemoveSourceDeps {
  readPosts: (caseId: string) => Promise<XPostArtifact[]>;
  writePosts: (caseId: string, posts: XPostArtifact[]) => Promise<void>;
  readNetworks: (caseId: string) => Promise<XNetworkArtifact[]>;
  writeNetworks: (caseId: string, networks: XNetworkArtifact[]) => Promise<void>;
}

function defaultRemoveSourceDeps(): RemoveSourceDeps {
  return {
    readPosts: async (caseId) => (await prodXStore()).posts.read(caseId),
    writePosts: async (caseId, posts) => (await prodXStore()).posts.write(caseId, posts),
    readNetworks: async (caseId) => (await prodXStore()).networks.read(caseId),
    writeNetworks: async (caseId, networks) => (await prodXStore()).networks.write(caseId, networks)
  };
}

/** Canonicalize a handle/source-key for comparison. The SHARED canonicalizer the renderer's
 *  `sourceGroups` key derivation also uses, so a source card and its cascade-delete agree exactly
 *  (else two casings render as two cards but removing one deletes both — evidence loss). */
const normalizeSourceKey = normalizeXSourceKey;

/**
 * Cascade-remove a derived source from a campaign (Task D1): delete every captured post whose
 * `channelId`/`authorHandle` matches `sourceKey`, and every network artifact whose `target`
 * matches. A key that matches nothing is a harmless no-op that still rewrites the (unchanged)
 * lists, mirroring `removeNote`/`removePreset`. Rejects a blank `sourceKey` before touching the
 * store. Returns the counts removed. Synthetic/demo rows are removed too when they match — a demo
 * source the analyst chose to delete should not linger (they are still excluded from analysis/
 * exports/hashing everywhere else; this is a straight user-initiated delete, not an analysis path).
 */
export async function removeSource(
  caseId: string,
  sourceKey: string,
  overrides: Partial<RemoveSourceDeps> = {}
): Promise<{ removedPosts: number; removedNetworks: number }> {
  const key = normalizeSourceKey(sourceKey);
  if (!key) {
    throw new Error('Removing a source requires a source key.');
  }
  const deps = { ...defaultRemoveSourceDeps(), ...overrides };

  const posts = await deps.readPosts(caseId);
  const keptPosts = posts.filter(
    (p) => normalizeSourceKey(p.channelId || p.authorHandle) !== key
  );
  const removedPosts = posts.length - keptPosts.length;
  await deps.writePosts(caseId, keptPosts);

  const networks = await deps.readNetworks(caseId);
  const keptNetworks = networks.filter((n) => normalizeSourceKey(n.target) !== key);
  const removedNetworks = networks.length - keptNetworks.length;
  await deps.writeNetworks(caseId, keptNetworks);

  return { removedPosts, removedNetworks };
}

// ---- Task 15: interactive (native-save-dialog-gated) file exports --------
// Closes the `exportXPostsToFile`/network-CSV arbitrary-write finding: `exports.ts`'s
// `exportXPostsToFile` trusts its `filePath` argument verbatim, so a channel that took a
// renderer-supplied path would let a compromised/malicious renderer write anywhere the app
// process can write. These wrap the SAME synthetic-excluding serializers behind a NATIVE
// `dialog.showSaveDialog` — the operator, not the renderer, always picks the destination.

/** The file-export formats offered through the interactive (save-dialog) path — mirrors
 *  `exports.ts`'s `XExportFileFormat` (json/csv/pdf; the Enterprise-port design scopes the
 *  captured-item export surface to these three, per Task 11). */
const X_EXPORT_FILE_FORMATS: readonly XExportFileFormat[] = ['json', 'csv', 'pdf'];

function isXExportFileFormat(v: unknown): v is XExportFileFormat {
  return typeof v === 'string' && (X_EXPORT_FILE_FORMATS as readonly string[]).includes(v);
}

interface SaveDialogFilter {
  name: string;
  extensions: string[];
}
interface SaveDialogOutcome {
  canceled: boolean;
  filePath?: string;
}

const EXPORT_FILE_FILTERS: Record<XExportFileFormat, SaveDialogFilter[]> = {
  json: [{ name: 'JSON', extensions: ['json'] }],
  csv: [{ name: 'CSV', extensions: ['csv'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }]
};

/** Injectable seams for the interactive export orchestration — production defaults resolve
 *  electron / node:fs LAZILY (dynamic import), so importing this module — or calling these
 *  functions with full test overrides — never touches either. */
export interface InteractiveExportDeps {
  /** Show a native save dialog; production default is a parentless `dialog.showSaveDialog`
   *  (matches `bookmarksBoard.exportBoard`'s `register.ts` convention). */
  showSaveDialog: (defaultPath: string, filters: SaveDialogFilter[]) => Promise<SaveDialogOutcome>;
  /** Refuse to write through a symlink — mirrors `register.ts`'s inline `lstat` guard applied
   *  to every other save-dialog export in the app. */
  assertNotSymlink: (filePath: string) => Promise<void>;
  writeFile: (filePath: string, data: Buffer | string) => Promise<void>;
  /** Forwarded to `exportXPostsToFile`'s own `readPosts` seam (tests only — production omits
   *  this so `exportXPostsToFile` uses ITS OWN default, the real encrypted `posts` store). */
  readPosts?: (caseId: string) => Promise<import('./store').XPostArtifact[]>;
  /** Forwarded in place of the module-level `exportNetworkCsv` (tests only — production omits
   *  this so the real, already-synthetic-filtered `exportNetworkCsv` runs). */
  readNetworkCsv?: (caseId: string) => Promise<{ csv: string; count: number }>;
}

async function defaultAssertNotSymlink(filePath: string): Promise<void> {
  const { lstat } = await import('node:fs/promises');
  try {
    const st = await lstat(filePath);
    if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
  }
}

function defaultInteractiveExportDeps(): InteractiveExportDeps {
  return {
    showSaveDialog: async (defaultPath, filters) => {
      const { dialog } = await import('electron');
      return dialog.showSaveDialog({ defaultPath, filters });
    },
    assertNotSymlink: defaultAssertNotSymlink,
    writeFile: async (filePath, data) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, data);
    }
  };
}

export type InteractiveExportResult = ({ canceled: false } & XExportWriteResult) | { canceled: true };

/**
 * Export a campaign's captured posts through a NATIVE save dialog — the operator picks the
 * destination; the renderer never supplies a filesystem path. Delegates the actual
 * read/filter/serialize/write/checksum to `exports.ts`'s `exportXPostsToFile` — synthetic/demo
 * posts are excluded THERE, not here (single source of truth for that honesty rule).
 */
export async function exportPostsInteractive(
  caseId: string,
  format: XExportFileFormat,
  overrides: Partial<InteractiveExportDeps> = {}
): Promise<InteractiveExportResult> {
  const deps: InteractiveExportDeps = { ...defaultInteractiveExportDeps(), ...overrides };
  const res = await deps.showSaveDialog(sanitizeExportName(caseId, format), EXPORT_FILE_FILTERS[format]);
  if (res.canceled || !res.filePath) return { canceled: true };
  await deps.assertNotSymlink(res.filePath);
  const written = await exportXPostsToFile(caseId, format, res.filePath, {
    writeFile: deps.writeFile,
    ...(deps.readPosts ? { readPosts: deps.readPosts } : {})
  });
  return { canceled: false, ...written };
}

export type InteractiveNetworkExportResult =
  | ({ canceled: false; filePath: string; count: number } & { sha256: string; checksumPath: string })
  | { canceled: true };

/**
 * Export a campaign's captured networks (synthetic-excluded via `exportNetworkCsv`) as CSV
 * through the SAME native-save-dialog discipline as `exportPostsInteractive`, plus a SHA-256
 * checksum sidecar (`writeChecksumSidecar`, exports.ts) — parity with the post export's
 * evidentiary guarantee even though network CSV isn't a per-post `XPostArtifact` export.
 */
export async function exportNetworkInteractive(
  caseId: string,
  overrides: Partial<InteractiveExportDeps> = {}
): Promise<InteractiveNetworkExportResult> {
  const deps: InteractiveExportDeps = { ...defaultInteractiveExportDeps(), ...overrides };
  const res = await deps.showSaveDialog(sanitizeExportName(caseId, 'csv'), [
    { name: 'CSV', extensions: ['csv'] }
  ]);
  if (res.canceled || !res.filePath) return { canceled: true };
  await deps.assertNotSymlink(res.filePath);
  const readNetworkCsv = deps.readNetworkCsv ?? exportNetworkCsv;
  const { csv, count } = await readNetworkCsv(caseId);
  await deps.writeFile(res.filePath, csv);
  const checksum = await writeChecksumSidecar({ writeFile: deps.writeFile }, res.filePath, csv);
  return { canceled: false, filePath: res.filePath, count, ...checksum };
}

/**
 * Wire every X Listening Station channel. Every handler validates the sender frame
 * FIRST (`assertTrustedSender`) — a hardened capture window can host a hostile
 * remote page, so an IPC message from a non-app frame must never be honoured —
 * then runs under the injected `handle`.
 *
 * The injected `handle` MUST be an event-PRESERVING wrapper: register.ts supplies
 * `safeHandleWithEvent` (vault gate + error sanitisation + the raw
 * `IpcMainInvokeEvent` forwarded as the handler's first argument). This is NOT the
 * plain `safeHandle` the investigation seams use — that one discards the event and
 * passes only the renderer args, which would leave `assertTrustedSender` reading a
 * renderer-controlled value (spoofable) or `undefined` (fails closed). The event
 * this handler validates is delivered by Electron/`ipcMain`, never by the renderer.
 */
export function registerXListeningIpc(deps: { handle: HandleWithEvent }): void {
  // Notes are pure store ops (no capture window, no network) — they need no
  // connectivity gate, only the sender check + arg validation. `savedAt` is stamped
  // MAIN-side inside `saveNote`; the renderer supplies only caseId/findingId/text.
  deps.handle(channels.xListening.saveNote, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as Partial<SaveNoteRequest> | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.findingId !== 'string' ||
      typeof req.text !== 'string'
    ) {
      throw new Error('Saving a note requires a caseId, findingId and text.');
    }
    return saveNote({ caseId: ensureUuid(req.caseId, 'caseId'), findingId: req.findingId, text: req.text });
  });
  deps.handle(channels.xListening.readNotes, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading notes requires a caseId.');
    }
    return readNotes(ensureUuid(caseIdArg, 'caseId'));
  });
  deps.handle(channels.xListening.removeNote, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; findingId?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.findingId !== 'string') {
      throw new Error('Removing a note requires a caseId and findingId.');
    }
    return removeNote(ensureUuid(req.caseId, 'caseId'), req.findingId);
  });
  // Task D1 — per-source cascade removal. `assertTrustedSender` FIRST; then require a caseId +
  // a non-empty `sourceKey` string before delegating. UUID-gates the caseId; the sourceKey is
  // canonicalized + matched inside `removeSource` (no window opens, no network egress — a local
  // secure-fs read-filter-write only).
  deps.handle(channels.xListening.removeSource, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; sourceKey?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.sourceKey !== 'string' || !req.sourceKey) {
      throw new Error('Removing a source requires a caseId and sourceKey.');
    }
    return removeSource(ensureUuid(req.caseId, 'caseId'), req.sourceKey);
  });

  // ---- Task F2: per-campaign COLLECTION SETTINGS (System-tab form) ----------
  // Derived read + a clamped write over the encrypted per-campaign sidecar. No capture window, no
  // network egress. `getCollectionSettings` heals a partial/absent record to a full clamped one;
  // `saveCollectionSettings` clamps EVERY numeric field MAIN-side before persisting (the renderer is
  // never trusted with a raw number — Enterprise `settings:save` discipline). Both UUID-gate the
  // caseId ahead of any store path being built. G1 (scheduling) + F1 (image policy) read the record
  // produced here; the capture path (captureTimeline collect gate + captureNetwork base passes)
  // consults it directly.
  deps.handle(channels.xListening.getCollectionSettings, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading collection settings requires a caseId.');
    }
    return getCollectionSettings(ensureUuid(caseIdArg, 'caseId'));
  });

  deps.handle(channels.xListening.saveCollectionSettings, async (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; settings?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || !req.caseId || typeof req.settings !== 'object' || !req.settings) {
      throw new Error('Saving collection settings requires a caseId and a settings object.');
    }
    const caseId = ensureUuid(req.caseId, 'caseId');
    const saved = await saveCollectionSettings(caseId, req.settings as Partial<XCollectionSettings>);
    // G1: a changed automaticSweeps / sweepInterval / archiveEnabled / archiveInterval must re-arm the
    // free-running timers (Enterprise `settings:save` → `restartAutoSweep()`/`restartArchiveTimer()`).
    // Fire-and-forget: a scheduling hiccup must never fail the settings save. `restartSchedule` reads
    // the just-persisted record itself, so it always sees the clamped values.
    void restartSchedule(caseId).catch((err) => console.warn('[XListening] restartSchedule (save):', err));
    return saved;
  });

  // ---- Task F1: per-profile IMAGE-COLLECTION policy ------------------------
  // A derived read of the encrypted per-campaign policy map + F2's campaign `retrieveImages`, and a
  // MAIN-side-validated write. No capture window, no network egress. `getImagePolicy` heals a
  // partial/absent map to a clean canonical one; `setProfileImageMode` rejects any mode that is not
  // 'on'|'off'|'inherit' (the renderer is never trusted with the mode string) and canonicalizes the
  // source key before persisting. The capture path (`captureTimeline`) consults the SAME policy: an
  // 'off' source has no post media fetched/cached.
  deps.handle(channels.xListening.getImagePolicy, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading the image policy requires a caseId.');
    }
    return getImagePolicy(ensureUuid(caseIdArg, 'caseId'));
  });

  deps.handle(channels.xListening.setProfileImageMode, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; sourceKey?: unknown; mode?: unknown } | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' || !req.caseId ||
      typeof req.sourceKey !== 'string' || !req.sourceKey ||
      (req.mode !== 'on' && req.mode !== 'off' && req.mode !== 'inherit')
    ) {
      throw new Error("Setting an image mode requires a caseId, sourceKey and a mode of 'on', 'off' or 'inherit'.");
    }
    // Belt-and-braces: normalize the mode here too (setProfileImageMode also validates MAIN-side).
    const mode: XImageMode = normalizeImageMode(req.mode);
    return setProfileImageMode(ensureUuid(req.caseId, 'caseId'), req.sourceKey, mode);
  });

  // ---- Phase-1 Enterprise-port surface (Task 6) --------------------------
  // Session: caseId-scoped, Tor-default (session.ts). `clearnetEnabled` is read MAIN-side and
  // trusted — the renderer never widens the network posture; it only ever flips the persisted
  // setting through the (Task 13) one-time real-IP-acknowledged settings flow.
  deps.handle(channels.xListening.openSession, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Opening an X session requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    const clearnetEnabled = await loadClearnetEnabled();
    const result = await openXSession(caseId, clearnetEnabled);
    // G1: (re)arm this campaign's automatic sweep/archive timers on a successful connect. The timer
    // is source-exact (free-running), but each scheduled sweep's capture still routes the Tor gate
    // (fail-closed) — no clearnet egress unless clearnet+clearnetAck. A blocked connect arms nothing.
    // Fire-and-forget: a scheduling hiccup must never fail the connect itself.
    if (!result.blocked) {
      void restartSchedule(caseId).catch((err) => console.warn('[XListening] restartSchedule (open):', err));
      // H1: run the bounded, Tor-gated, idempotent avatar-repair startup pass for the active campaign
      // — Enterprise armed `scheduleAvatarRepair` exactly when the X session first reported connected
      // (`main.cjs:1104-1106`). Fire-and-forget: a repair hiccup must never fail the connect, and the
      // pass FAILS CLOSED itself (no window, no egress) if Tor is down. Idempotent, so repeated
      // connects don't re-fetch already-cached avatars.
      void repairAvatars(caseId).catch((err) => console.warn('[XListening] repairAvatars (open):', err));
    }
    return result;
  });

  deps.handle(channels.xListening.sessionStatus, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Session status requires a caseId.');
    }
    return getXSessionStatus(ensureUuid(caseIdArg, 'caseId'));
  });

  deps.handle(channels.xListening.closeSession, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Closing an X session requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    // G1: disconnecting the session HALTS the campaign's sweep/archive timers — an unattended sweep
    // must never run against a session the operator closed.
    stopSchedule(caseId);
    return closeXSession(caseId);
  });

  // G1: read the campaign's automatic-sweep/archive SCHEDULE status (scheduler.ts) — the armed
  // cadence + next-fire times for the renderer's next-sweep indicator + Pause. Pure in-memory read of
  // the scheduler registry; no capture window, no network egress. Sender check + arg validation only.
  deps.handle(channels.xListening.scheduleStatus, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading the schedule status requires a caseId.');
    }
    return scheduleStatus(ensureUuid(caseIdArg, 'caseId'));
  });

  // Timeline capture (capture.ts): the analyst navigates the campaign's VISIBLE capture window
  // to the target profile manually (via openSession); this channel captures whatever page is
  // currently loaded there. The collect toggles are read MAIN-side — the renderer never widens
  // capture beyond what the operator opted into.
  deps.handle(channels.xListening.captureTimeline, async (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as Partial<XTimelineCaptureRequest> | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.channelId !== 'string' ||
      typeof req.targetUsername !== 'string'
    ) {
      throw new Error('Capturing a timeline requires a caseId, channelId and targetUsername.');
    }
    const caseId = ensureUuid(req.caseId, 'caseId');
    // One-click capture (fix for the "X is not connected" trap): the auth cookie is case-independent
    // and persisted, so the renderer can read "signed in" while THIS campaign has no live capture
    // window (e.g. after an app restart, or before Open Session was ever clicked). Rather than
    // erroring, ENSURE a window — opened Tor-gated + FAIL CLOSED (no clearnet unless clearnet+ack) —
    // then navigate it to the target profile and wait for the timeline before scraping.
    let win = getXWindow(caseId);
    if (!win) {
      const opened = await openXSession(caseId, await loadClearnetEnabled());
      if (opened.blocked) {
        return {
          blocked: true,
          reason: opened.reason ?? 'Tor is not ready — cannot open a capture window. Wait for Tor, or enable the clearnet opt-in.',
          added: 0,
          skipped: 0,
          posts: [],
        };
      }
      win = getXWindow(caseId);
    }
    if (!win) {
      return { blocked: true, reason: 'Could not open a capture window for this campaign.', added: 0, skipped: 0, posts: [] };
    }
    // Drive the window to the target profile so the analyst does not have to hand-navigate it first
    // (the "Capture Timeline" field says "capture THIS username"). A blocked/signed-out page returns
    // its reason; a render timeout is non-fatal (the capture below then reports 0 honestly).
    const nav = await navigateXToProfile(caseId, req.targetUsername);
    if (nav.blocked) {
      return { blocked: true, reason: nav.reason, added: 0, skipped: 0, posts: [] };
    }
    // F2: the surrounding-thread collect gate is derived from THIS campaign's per-campaign
    // COLLECTION SETTINGS (RECORD TYPES), MAIN-side — the renderer never widens capture; it only
    // ever edits the persisted per-campaign record through `saveCollectionSettings` (clamped there).
    // `getCollectionSettings` is fail-safe (heals to minimal-capture defaults on any read error).
    const collectionSettings = await getCollectionSettings(caseId);
    const collect = collectGateFromSettings(collectionSettings);
    // F1: resolve this source's EFFECTIVE image policy MAIN-side, reusing the campaign settings just
    // read (no second read) — the per-profile override resolved against `retrieveImages`. Injected so
    // `captureTimeline` skips media caching for an 'off' source (no pbs.twimg fetch at all).
    const imagesEnabled = await resolveEffectiveImageCollection(caseId, req.targetUsername, {
      loadRetrieveImages: async () => collectionSettings.retrieveImages,
    });
    return captureTimeline(
      win,
      {
        caseId,
        jobId: typeof req.jobId === 'string' ? req.jobId : caseId,
        channelId: req.channelId,
        channelLabel: typeof req.channelLabel === 'string' ? req.channelLabel : `@${req.channelId}`,
        targetUsername: req.targetUsername,
        collect
      },
      { imagesEnabledForSource: async () => imagesEnabled },
    );
  });

  // Task 14: list every captured post artifact for a campaign — the persisted source of truth
  // (`captureTimeline` above returns only the freshly captured batch from one call). No capture
  // window, no network; sender check + arg validation only, same shape as `entities` below.
  deps.handle(channels.xListening.postsList, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Listing posts requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    const store = await prodXStore();
    return store.posts.read(caseId);
  });

  // Campaigns (campaigns.ts): self-managed x-namespace scraping cases — no core investigation
  // case need be bound. `switch`/`update`/`delete` UUID-gate their id the same way every other
  // store-backed handler in this file does, ahead of any store path being built.
  deps.handle(channels.xListening.campaignsList, (e) => {
    assertTrustedSender(e);
    return listCampaigns();
  });

  deps.handle(channels.xListening.campaignsCreate, (e, nameArg) => {
    assertTrustedSender(e);
    if (typeof nameArg !== 'string') {
      throw new Error('Creating a campaign requires a name.');
    }
    return createCampaign(nameArg);
  });

  deps.handle(channels.xListening.campaignsSwitch, (e, idArg) => {
    assertTrustedSender(e);
    if (typeof idArg !== 'string' || !idArg) {
      throw new Error('Switching campaigns requires an id.');
    }
    return switchCampaign(ensureUuid(idArg, 'campaignId'));
  });

  deps.handle(channels.xListening.campaignsUpdate, async (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as
      | { id?: unknown; name?: unknown; purpose?: unknown; description?: unknown }
      | undefined;
    if (!req || typeof req.id !== 'string' || typeof req.name !== 'string') {
      throw new Error('Updating a campaign requires an id and a name.');
    }
    const campaignId = ensureUuid(req.id, 'campaignId');
    const updated = await updateCampaign(campaignId, req.name);
    // Editor meta (purpose/description) rides on the same SAVE. Only persisted when at least one of
    // the two X-specific fields is present, so a plain rename (Phase-13 dock) is unaffected. The
    // renderer's raw strings are normalized MAIN-side by setCampaignMeta (coerced + length-capped).
    if (typeof req.purpose === 'string' || typeof req.description === 'string') {
      await setCampaignMeta(campaignId, {
        purpose: typeof req.purpose === 'string' ? req.purpose : '',
        description: typeof req.description === 'string' ? req.description : '',
      });
    }
    return updated;
  });

  deps.handle(channels.xListening.campaignsDelete, (e, idArg) => {
    assertTrustedSender(e);
    if (typeof idArg !== 'string' || !idArg) {
      throw new Error('Deleting a campaign requires an id.');
    }
    return deleteCampaign(ensureUuid(idArg, 'campaignId'));
  });

  // Task J1 — duplicate a campaign's SETUP (presets/settings/image-policy/editor-meta) into a fresh
  // investigation with zero collected counts. UUID-gates the id ahead of any store path, same as the
  // other campaign handlers.
  deps.handle(channels.xListening.campaignsDuplicate, (e, idArg) => {
    assertTrustedSender(e);
    if (typeof idArg !== 'string' || !idArg) {
      throw new Error('Duplicating a campaign requires an id.');
    }
    return duplicateCampaign(ensureUuid(idArg, 'campaignId'));
  });

  // Task J1 — read every campaign's editor meta as a `{ [id]: {purpose, description} }` map so the
  // renderer can populate each CAMPAIGN card + the EDIT modal in one round-trip. No capture window,
  // no network; sender check only. getCampaignMeta is itself fail-safe (empty default on any hiccup).
  deps.handle(channels.xListening.campaignsMeta, async (e) => {
    assertTrustedSender(e);
    const list = await listCampaigns();
    const out: Record<string, XCampaignMeta> = {};
    for (const c of list) {
      out[c.id] = await getCampaignMeta(c.id);
    }
    return out;
  });

  // Derived reads (analysis.ts, Task 2) — no capture window, no network; sender check + arg
  // validation only.
  deps.handle(channels.xListening.analysis, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Analysis requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    const { profiles, relationships } = await buildNetworkAnalysisInputs(caseId);
    return computeNetworkAnalysis(profiles, relationships, new Date().toISOString());
  });

  deps.handle(channels.xListening.health, (e) => {
    assertTrustedSender(e);
    // No collection-run log is persisted yet (a later task adds one) — an honest empty roster
    // beats a fabricated one. See the channel doc in ipc-contracts.ts.
    return deriveCollectionHealth([]);
  });

  deps.handle(channels.xListening.entities, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Entities requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    const store = await prodXStore();
    const posts = await store.posts.read(caseId);
    return aggregateEntities(posts);
  });

  // Presets: pure store CRUD (extend XStore, Task 1) — no capture window, no network.
  deps.handle(channels.xListening.presetsRead, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Reading presets requires a caseId.');
    }
    const store = await prodXStore();
    return { presets: await store.presets.read(ensureUuid(caseIdArg, 'caseId')) };
  });

  deps.handle(channels.xListening.presetsSave, async (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as (Partial<XPreset> & { caseId?: unknown }) | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.id !== 'string' ||
      typeof req.name !== 'string' ||
      !Array.isArray(req.keywords)
    ) {
      throw new Error('Saving a preset requires a caseId, id, name and keywords.');
    }
    const caseId = ensureUuid(req.caseId, 'caseId');
    const preset: XPreset = {
      id: req.id,
      name: req.name,
      keywords: req.keywords.map((k) => String(k)),
      mode: req.mode === 'all' ? 'all' : 'any',
      caseSensitive: req.caseSensitive === true,
      profileIds: Array.isArray(req.profileIds) ? req.profileIds.map((p) => String(p)) : [],
      enabled: req.enabled !== false,
      updatedAt: new Date().toISOString()
    };
    const store = await prodXStore();
    return { presets: await store.presets.save(caseId, preset) };
  });

  deps.handle(channels.xListening.presetsRemove, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; id?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.id !== 'string') {
      throw new Error('Removing a preset requires a caseId and id.');
    }
    return removePreset(ensureUuid(req.caseId, 'caseId'), req.id);
  });

  deps.handle(channels.xListening.presetsRun, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; id?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.id !== 'string') {
      throw new Error('Running a preset requires a caseId and id.');
    }
    return runPreset(ensureUuid(req.caseId, 'caseId'), req.id);
  });

  // ---- Task 15: Changes tab (raw networks read) ----------------------------
  deps.handle(channels.xListening.networksList, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Listing networks requires a caseId.');
    }
    const store = await prodXStore();
    return store.networks.read(ensureUuid(caseIdArg, 'caseId'));
  });

  // ---- Task 15(d): archive status + a run driven off the Tor-default campaign window ----
  deps.handle(channels.xListening.archiveStatus, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Archive status requires a caseId.');
    }
    const store = await prodXStore();
    return store.archiveState.read(ensureUuid(caseIdArg, 'caseId'));
  });

  deps.handle(channels.xListening.archiveRun, async (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as
      | Partial<{
          caseId: string;
          channelId: string;
          channelLabel: string;
          targetUsername: string;
          maxCycles: number;
        }>
      | undefined;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.channelId !== 'string' ||
      typeof req.targetUsername !== 'string'
    ) {
      throw new Error('Running an archive step requires a caseId, channelId and targetUsername.');
    }
    const caseId = ensureUuid(req.caseId, 'caseId');
    const win = getXWindow(caseId);
    if (!win) {
      throw new Error(
        'X is not connected for this campaign. Open the session and sign in before archiving.'
      );
    }
    const maxCycles = Number(req.maxCycles);
    return runArchiveSteps(
      win,
      {
        caseId,
        jobId: caseId,
        channelId: req.channelId,
        channelLabel: typeof req.channelLabel === 'string' ? req.channelLabel : `@${req.channelId}`,
        targetUsername: req.targetUsername
      },
      { maxCycles: Number.isFinite(maxCycles) && maxCycles > 0 ? maxCycles : 1 }
    );
  });

  // ---- Task 15(a): demo data (demo.ts, Task 12) ----------------------------
  deps.handle(channels.xListening.loadDemoData, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Loading demo data requires a caseId.');
    }
    const caseId = ensureUuid(caseIdArg, 'caseId');
    return loadDemoData(caseId, caseId);
  });

  // ---- Task 15(b): interactive (save-dialog-gated) exports -----------------
  deps.handle(channels.xListening.exportPostsToFile, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; format?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || !req.caseId) {
      throw new Error('Export requires a caseId.');
    }
    if (!isXExportFileFormat(req.format)) {
      throw new Error('Export requires a format of json, csv or pdf.');
    }
    return exportPostsInteractive(ensureUuid(req.caseId, 'caseId'), req.format);
  });

  deps.handle(channels.xListening.exportNetworkToFile, (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Network export requires a caseId.');
    }
    return exportNetworkInteractive(ensureUuid(caseIdArg, 'caseId'));
  });

  // ---- Task A2: historical change events (store.ts listChangeEvents) --------
  // Derived read (no capture window, no network) — newest-first, capped ~500. Sender check +
  // arg validation only, same shape as `networksList`/`postsList`.
  deps.handle(channels.xListening.changeEvents, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Listing change events requires a caseId.');
    }
    const store = await prodXStore();
    return store.listChangeEvents(ensureUuid(caseIdArg, 'caseId'));
  });

  // ---- Task A3: collection run log (store.ts listRunLog) -------------------
  // Derived read (no capture window, no network) — newest-first, capped ~100. Sender check + arg
  // validation only, same shape as `changeEvents`/`networksList`. The records are emitted by the
  // capture/archive paths (capture.ts `captureTimeline` → run-log.ts).
  deps.handle(channels.xListening.runLog, async (e, caseIdArg) => {
    assertTrustedSender(e);
    if (typeof caseIdArg !== 'string' || !caseIdArg) {
      throw new Error('Listing the run log requires a caseId.');
    }
    const store = await prodXStore();
    return store.listRunLog(ensureUuid(caseIdArg, 'caseId'));
  });

  // ---- Task A1: live post verification (VERIFY LIVE) -----------------------
  // Opens the stored post's real URL in a Tor-gated capture window (capture.ts `verifyPost` reads
  // the acked clearnet flag + `resolveXTorGate` itself, MAIN-side — fail-closed, no clearnet
  // fallback). Sender check + arg validation only here; the network posture + URL guards live in
  // `verifyPost`. `caseId` is UUID-gated; `postId` is passed through and validated against the
  // stored post's URL inside `verifyPost` (a postId with no stored post throws downstream).
  deps.handle(channels.xListening.verifyPost, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; postId?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.postId !== 'string' || !req.postId) {
      throw new Error('Verifying a post requires a caseId and postId.');
    }
    return verifyPost(ensureUuid(req.caseId, 'caseId'), req.postId);
  });

  // ---- Task C1: live follower/following network extraction (captureNetwork) ----------------
  // Opens a Tor-gated hidden capture window (capture.ts `captureNetwork` reads the acked clearnet
  // flag + `resolveXTorGate` itself, MAIN-side — fail-closed, no clearnet fallback), navigated to
  // the target's /followers or /following page. The target URL is validated + built BEFORE any
  // window opens (reuses the `^[A-Za-z0-9_]{1,15}$` username guard); a malformed target throws
  // inside `captureNetwork`, opening nothing. Sender check + arg-shape validation only here; `kind`
  // is allowlisted to the two valid relationship surfaces so a bogus value can never reach the
  // helper. Consumed by the Network tab's EXTRACT FOLLOWERS/FOLLOWING/BOTH actions.
  deps.handle(channels.xListening.captureNetwork, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as
      | { caseId?: unknown; channelId?: unknown; targetUsername?: unknown; kind?: unknown }
      | undefined;
    const kind = req?.kind;
    if (
      !req ||
      typeof req.caseId !== 'string' ||
      typeof req.targetUsername !== 'string' ||
      !req.targetUsername ||
      (kind !== 'followers' && kind !== 'following')
    ) {
      throw new Error(
        'Extracting a network requires a caseId, targetUsername and a kind of followers or following.'
      );
    }
    const targetUsername = req.targetUsername;
    const channelId = typeof req.channelId === 'string' && req.channelId ? req.channelId : targetUsername;
    return captureNetwork({
      caseId: ensureUuid(req.caseId, 'caseId'),
      channelId,
      targetUsername,
      kind: kind as 'followers' | 'following'
    });
  });

  // ---- Task E1: Tor-gated "open in X" affordances (openInX) ----------------
  // Opens an in-app X window for a `{ kind, ref }` affordance (capture.ts `openInX` reads the acked
  // clearnet flag + `resolveXTorGate` itself, MAIN-side — fail-closed, no clearnet fallback). The
  // URL is validated + constructed BEFORE any window opens (reuses the openPostThread guards +
  // `^[A-Za-z0-9_]{1,15}$`); a malformed ref throws inside `openInX`, opening nothing. Sender check +
  // arg-shape validation only here; `kind` is allowlisted to the three valid surfaces so a bogus
  // value can never reach the helper. The window opens IN-APP (hardened capture window), never via
  // an OS shell open-external hand-off. Consumed by C2b (graph inspector) + D1 ("View X").
  deps.handle(channels.xListening.openInX, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { kind?: unknown; ref?: unknown } | undefined;
    const kind = req?.kind;
    if (
      !req ||
      (kind !== 'thread' && kind !== 'profile' && kind !== 'identity') ||
      typeof req.ref !== 'string' ||
      !req.ref
    ) {
      throw new Error('Opening X requires a kind of thread, profile or identity and a ref.');
    }
    return openInX(kind as XOpenKind, req.ref);
  });

  // ---- Task 15(a)/(c): read a cached local media ref back as a data: URI ---
  deps.handle(channels.xListening.mediaRead, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; ref?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string' || typeof req.ref !== 'string') {
      throw new Error('Reading cached media requires a caseId and ref.');
    }
    return readCachedMedia(ensureUuid(req.caseId, 'caseId'), req.ref);
  });
}
