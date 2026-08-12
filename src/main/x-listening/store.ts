/**
 * X Listening Station encrypt-at-rest data layer.
 *
 * Captured visible-DOM posts normalise into `HarvestedItem`s and land in the encrypted
 * scraping-case store under the `x` namespace; X-specific artifact sidecars (richer post
 * artifacts, analyst notes, follower/following networks, low-rate archive state, highlight
 * presets, an entity-rollup cache) sit alongside them, one JSON sidecar each, all routed
 * through secure-fs.
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
 *  thumbnail — a remote URL must never be stored here (no-remote-media-inlining).
 *  `displayName` is OPTIONAL and omitted when no display name was visible — it is never
 *  backfilled from the @handle (honesty: an unobserved value is never presented as
 *  captured; the renderer shows an absent display name as "Not visible").
 *
 *  Task 7 fields (optional so pre-Task-7 literals in older tests/fixtures stay valid —
 *  every account produced by `extract.ts`'s `normalizeNetwork` sets all three):
 *   - `evidenceHash`: sha256 of `canonicalRelationshipEvidence({target,kind,handle,
 *     displayName,bio})` (evidence.ts) — changes if any of those visible fields change.
 *   - `firstObservedAt`/`lastObservedAt`: the accumulator's conservative bookkeeping
 *     (`networks.save`, below). `firstObservedAt` is stamped once, on the scan that first
 *     saw this handle for this (target,kind), and never rewritten by a later scan.
 *     `lastObservedAt` advances only on a scan that actually RE-observes the handle. An
 *     account absent from a later scan keeps both fields exactly as they were — its record
 *     is never dropped, edited, or labelled "unfollowed"/"removed" (conservative,
 *     not-fabricating inference; see NETWORK-COLLECTION.md "Interpreting network deltas").
 *   - `synthetic`: true for a demo/seeded row (Task 12) — enforced-excluded from
 *     `computeNetworkAnalysis`/exports/evidence hashing by the callers that consume it. */
export interface XNetworkAccount {
  handle: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  evidenceHash?: string;
  firstObservedAt?: string;
  lastObservedAt?: string;
  synthetic?: boolean;
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

/** Parsed integer metrics for a captured post — the derived numbers used for display/sort/
 *  analysis. Kept alongside `metricsRaw` (below) so no precision is silently fabricated: a
 *  platform label like "1.2K" becomes 1200 here, but the source string survives for audit. */
export interface XPostMetrics {
  replies: number;
  reposts: number;
  likes: number;
  views: number;
}

/** The RAW platform-rendered metric strings ("1.2K", "3,401", "") as captured, before a
 *  parser derives an integer. Honesty fix over Enterprise (which discards the raw string
 *  once parsed): kept here so a reviewer can audit the parse, and folded into
 *  canonicalPostEvidence (evidence.ts) so altering a displayed count post-collection
 *  invalidates the evidence hash instead of going unnoticed. */
export interface XPostMetricsRaw {
  replies?: string;
  reposts?: string;
  likes?: string;
  views?: string;
}

/** A captured post/reply/repost/comment — a `HarvestedItem` superset carrying the richer
 *  fields (from Enterprise) that don't fit the cross-platform `HarvestedItem` shape. Stored
 *  in the `x-posts.json` sidecar, separate from the plain `HarvestedItem` list in
 *  `x-items.json` (the cross-module dashboard's source of truth) — this is the module's own
 *  richer record.
 *  `mediaRefs`, when present, are LOCAL secure-fs references only (byte-hash-named files
 *  under the case dir) — a remote media URL must never be stored here, same no-remote-media
 *  discipline as `XNetworkAccount.avatar`.
 *  `synthetic`, when true, marks a demo/seeded record — callers MUST exclude synthetic posts
 *  from `computeNetworkAnalysis`, exports, and evidence hashing (Global Constraints honesty
 *  rule; enforced by later tasks, not by the store itself). */
export interface XPostArtifact extends HarvestedItem {
  kind: 'post' | 'reply' | 'repost' | 'comment';
  parentPostId: string | null;
  metrics: XPostMetrics;
  metricsRaw: XPostMetricsRaw;
  evidenceHash: string;
  synthetic?: boolean;
  mediaRefs?: string[];
  /** Prior captured versions of THIS post, appended on a text/media re-ingest diff (Task A2,
   *  ported from Enterprise `ingestPosts`/`verifyPostLive`). Capped at `X_MAX_POST_VERSIONS`
   *  (oldest dropped). Absent until the first change is observed. */
  versionHistory?: XPostVersion[];
  /** Live-verification state (Task A1, VERIFY LIVE — ported from Enterprise `verifyPostLive`).
   *  Absent until the post is verified against its live URL. `'available'` = still reachable;
   *  `'unavailable'` = deleted/removed/gone at its original URL. Not part of the evidence hash
   *  (it is a re-observation timestamped by `verifiedAt`, not the captured content itself). */
  availability?: 'available' | 'unavailable';
  /** Caller-supplied ISO time of the last live verification (injected clock — never computed in
   *  a hash path). Absent until the first `verifyPost`. */
  verifiedAt?: string;
}

/** One archived prior version of a post — the text/media as they stood BEFORE a re-ingest that
 *  observed a change. `sha256` is the prior version's evidence hash (reused from evidence.ts,
 *  deterministic); `capturedAt` is the caller-supplied ISO time the change was observed (injected
 *  clock — never computed here). `media`, when present, is the prior LOCAL `mediaRefs` array (no
 *  remote URL is ever stored, same discipline as `XPostArtifact.mediaRefs`). */
export interface XPostVersion {
  text: string;
  media?: unknown;
  capturedAt: string;
  sha256: string;
}

/** Longest `versionHistory` a post retains before the oldest entry is dropped (Enterprise
 *  `main.cjs:1793` — `slice(-20)`). */
export const X_MAX_POST_VERSIONS = 20;

/** Newest `changeEvents` a case retains (and the cap `listChangeEvents` returns). Enterprise
 *  stored 5000 and returned 2000; this port keeps a tighter, single 500-cap (design A2). */
export const X_MAX_CHANGE_EVENTS = 500;

/** One historical change event for a case — the union the Change Intel tab (B1) renders.
 *  `at` is the caller-supplied ISO observation time (injected clock). `id` is a deterministic
 *  content-derived digest (no unseeded RNG). Kind-specific fields are optional so all three
 *  shapes share one persisted list:
 *   - `post_changed`  → `{ postId, summary, sourceUsername, at }` (text/media re-ingest diff)
 *   - `profile_change`→ `{ profileId, summary, at }` (metadata-signature diff vs last snapshot)
 *   - `post_unavailable` → `{ postId, summary, at }` (a live post no longer reachable — reserved
 *     for A1's VERIFY LIVE; the shape is supported here so the log/renderer need no later change). */
export type XChangeEventKind = 'post_changed' | 'profile_change' | 'post_unavailable';

export interface XChangeEvent {
  id: string;
  kind: XChangeEventKind;
  at: string;
  summary: string;
  postId?: string;
  profileId?: string;
  sourceUsername?: string;
}

/** Newest collection-run records a case retains (and the cap `listRunLog` returns). Enterprise
 *  kept 1000-2000 app-wide (`main.cjs:401`); this port keeps a tighter, single per-case 100-cap
 *  (design A3) — the Change Intel COLLECTION RUN LOG is a recent-activity view, not an archive. */
export const X_MAX_RUN_LOG = 100;

/** The collection operations a run record can describe — a manual/live capture (`posts`,
 *  `followers`, `following`) or an incremental-archive cycle (`archive_*`). Structurally identical
 *  to analysis.ts `CollectionOperation`, kept independent so store.ts stays the LOWER layer
 *  (analysis.ts imports FROM store.ts, never the reverse). */
export type XRunOperation =
  | 'posts'
  | 'followers'
  | 'following'
  | 'archive_posts'
  | 'archive_followers'
  | 'archive_following';

/** One per-operation collection-run record — ported from Enterprise `startCollectionRun`/
 *  `finishCollectionRun` (`main.cjs:420-457`), the COLLECTION RUN LOG the Change Intel tab (B1)
 *  renders. Purely OPERATIONAL telemetry: it carries no captured content and feeds NO evidence
 *  hash, so it holds no `id`/RNG — a record is keyed by (profileId, operation, startedAt) at the
 *  render layer. `startedAt`/`endedAt` are caller-supplied injected-clock ISO strings
 *  (determinism — never computed here). `duplicates = max(0, observed - added)` mirrors Enterprise
 *  (`main.cjs:453`). `status` is `'complete'` on a finished run, `'error'` on a blocked/failed one
 *  (the union stays open to a future stopReason-derived status without a store migration). */
export interface XRunLogRecord {
  profileId: string;
  username: string;
  operation: XRunOperation;
  observed: number;
  added: number;
  duplicates: number;
  requestedPasses: number;
  completedPasses: number;
  reachedEnd: boolean;
  stopReason: string;
  status: 'complete' | 'error' | string;
  startedAt: string;
  endedAt: string;
}

/** One captured profile-metadata snapshot. `signature` is the deterministic sha256 of the
 *  canonical `{bio,avatar,location,website}` (evidence.ts `profileMetadataSignature`) — the gate
 *  that decides whether a re-capture is a no-op or a `profile_change`. `capturedAt` is the
 *  caller-supplied ISO time (injected clock). Fields are the trimmed canonical values. */
export interface XProfileSnapshot {
  profileId: string;
  sourceUsername?: string;
  bio: string;
  avatar: string;
  location: string;
  website: string;
  capturedAt: string;
  signature: string;
}

/** A saved keyword/phrase highlight preset, evaluated locally over captured posts
 *  (Enterprise `presets:save`/`presets:run`) — matching happens in-app, never server-side. */
export interface XPreset {
  id: string;
  name: string;
  keywords: string[];
  mode: 'any' | 'all';
  caseSensitive: boolean;
  profileIds: string[];
  enabled: boolean;
  /** ISO timestamp supplied by the caller (injected clock) — never computed here. */
  updatedAt: string;
}

/** One cached extracted-entity rollup for a case (mention/hashtag/email/url/domain/crypto/
 *  phone/organization) — a cumulative index over `extractEntities(post.text)` so entity
 *  search/browse doesn't re-scan every post's text on every read. Purely derived data: safe
 *  to rebuild from `posts` at any time; this cache exists only to avoid re-scanning. */
export interface XEntityCacheEntry {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  postIds: string[];
  sourceUsernames: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  count: number;
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
  /** Resolve the post-artifacts sidecar path for a case. */
  postsPath(caseId: string): string;
  /** Resolve the presets artifact path for a case. */
  presetsPath(caseId: string): string;
  /** Resolve the entity-cache artifact path for a case. */
  entitiesCachePath(caseId: string): string;
  /** Resolve the historical change-events sidecar path for a case (Task A2). */
  changeEventsPath(caseId: string): string;
  /** Resolve the profile-snapshots sidecar path for a case (Task A2). */
  profileSnapshotsPath(caseId: string): string;
  /** Resolve the collection-run-log sidecar path for a case (Task A3). */
  runLogPath(caseId: string): string;
}

// ---- helpers -----------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Merge a freshly captured account list into the PERSISTED account list for the same
 * (target, kind) artifact — the Task 7 accumulator. Dedup key is the lowercased @handle
 * (i.e. the (target, kind, handle) triple, target+kind already fixed by the artifact this
 * runs within — mirrors "dedup by (profileId, relationship, username)").
 *
 * CONSERVATIVE (no auto-unfollow inference): an account present in `existing` but absent
 * from `incoming` — not re-observed on this scan — is carried into the result UNCHANGED.
 * It is never dropped, never edited, and nothing here computes or stamps any
 * "unfollowed"/"removed" status; its absence just means the scan didn't happen to (re-)see
 * it, which is not evidence of anything (NETWORK-COLLECTION.md "Interpreting network
 * deltas"). An account re-observed this scan keeps its ORIGINAL `firstObservedAt` but takes
 * every other field — including `lastObservedAt` — from the fresh capture (the caller,
 * `normalizeNetwork`, stamps `firstObservedAt`/`lastObservedAt` to the same `capturedAt` on
 * every freshly normalized account, so a genuinely new account's first/last are both "now").
 */
function mergeNetworkAccounts(
  existing: readonly XNetworkAccount[],
  incoming: readonly XNetworkAccount[],
): XNetworkAccount[] {
  const priorByHandle = new Map(existing.map((a) => [a.handle.toLowerCase(), a]));
  const seenThisScan = new Set<string>();
  const merged: XNetworkAccount[] = [];
  for (const acct of incoming) {
    const key = acct.handle.toLowerCase();
    seenThisScan.add(key);
    const prior = priorByHandle.get(key);
    merged.push(prior?.firstObservedAt ? { ...acct, firstObservedAt: prior.firstObservedAt } : acct);
  }
  for (const prior of existing) {
    if (!seenThisScan.has(prior.handle.toLowerCase())) merged.push(prior);
  }
  return merged;
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
    /**
     * Upsert ONE analyst note keyed by `findingId` — a re-save of the same finding
     * REPLACES its note rather than appending a duplicate (an `XNote` carries no
     * note-id; a finding has at most one note). `savedAt` is caller-supplied (the
     * injected clock — determinism), never computed here. Returns the fresh note
     * list so the caller can rerender without a second read. */
    save(caseId: string, findingId: string, text: string, savedAt: string): Promise<XNote[]>;
  };
  networks: {
    read(caseId: string): Promise<XNetworkArtifact[]>;
    write(caseId: string, networks: XNetworkArtifact[]): Promise<void>;
    /**
     * Upsert one captured network artifact, keyed by (target, kind) case-insensitively —
     * a re-capture of the same target's followers/following ACCUMULATES into the prior
     * snapshot (Task 7 `mergeNetworkAccounts`, module-private) rather than replacing it:
     * accounts re-observed this scan are refreshed (keeping their original
     * `firstObservedAt`), accounts newly seen are added, and accounts from a prior scan
     * NOT seen this time are carried over unchanged — conservative, no auto-unfollow
     * inference. Returns the total artifact count for the case. */
    save(caseId: string, artifact: XNetworkArtifact): Promise<number>;
  };
  archiveState: {
    /** Null before the first write. */
    read(caseId: string): Promise<XArchiveState | null>;
    write(caseId: string, state: XArchiveState): Promise<void>;
  };
  posts: {
    /** All captured post artifacts for a case, in append order. */
    read(caseId: string): Promise<XPostArtifact[]>;
    /** Replace the full list wholesale (for a caller that already merged/updated in memory). */
    write(caseId: string, posts: XPostArtifact[]): Promise<void>;
    /** Upsert post artifacts (dedup by `id`, append order preserved) — mirrors `saveItems`. */
    save(caseId: string, posts: XPostArtifact[]): Promise<{ added: number; skipped: number }>;
  };
  presets: {
    read(caseId: string): Promise<XPreset[]>;
    write(caseId: string, presets: XPreset[]): Promise<void>;
    /** Upsert one preset keyed by `id` — a re-save of the same id REPLACES it rather than
     *  appending a duplicate. Returns the fresh preset list. */
    save(caseId: string, preset: XPreset): Promise<XPreset[]>;
  };
  entitiesCache: {
    read(caseId: string): Promise<XEntityCacheEntry[]>;
    write(caseId: string, entities: XEntityCacheEntry[]): Promise<void>;
  };
  changeEvents: {
    /** All change events for a case, in APPEND (oldest-first) order. */
    read(caseId: string): Promise<XChangeEvent[]>;
    /** Append one event; the persisted list is capped to the newest `X_MAX_CHANGE_EVENTS`
     *  (oldest dropped). Returns the fresh (append-order) list. */
    append(caseId: string, event: XChangeEvent): Promise<XChangeEvent[]>;
  };
  profileSnapshots: {
    read(caseId: string): Promise<XProfileSnapshot[]>;
    write(caseId: string, snapshots: XProfileSnapshot[]): Promise<void>;
    /** Append one snapshot (append order = capture order). Returns the fresh list. */
    append(caseId: string, snapshot: XProfileSnapshot): Promise<XProfileSnapshot[]>;
    /** The most-recently-appended snapshot for a profile in this case, or null if none. */
    latest(caseId: string, profileId: string): Promise<XProfileSnapshot | null>;
  };
  /** Newest-first, `X_MAX_CHANGE_EVENTS`-capped view of a case's change events — the Change
   *  Intel tab's read (Task A2; consumed via `channels.xListening.changeEvents`). */
  listChangeEvents(caseId: string): Promise<XChangeEvent[]>;
  runLog: {
    /** All collection-run records for a case, in APPEND (oldest-first) order. */
    read(caseId: string): Promise<XRunLogRecord[]>;
    /** Append one record; the persisted list is capped to the newest `X_MAX_RUN_LOG`
     *  (oldest dropped). Returns the fresh (append-order) list. */
    append(caseId: string, record: XRunLogRecord): Promise<XRunLogRecord[]>;
  };
  /** Newest-first, `X_MAX_RUN_LOG`-capped view of a case's collection runs — the Change Intel
   *  tab's COLLECTION RUN LOG read (Task A3; consumed via `channels.xListening.runLog`). */
  listRunLog(caseId: string): Promise<XRunLogRecord[]>;
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
      save(caseId, findingId, text, savedAt) {
        // Direct readJsonArr/writeJson (NOT notes.read/write) inside the lock:
        // withLock is not reentrant, and read/write take the SAME key.
        return withLock(`x-listening:notes:${caseId}`, async () => {
          const existing = await readJsonArr<XNote>(deps, deps.notesPath(caseId));
          const note: XNote = { findingId, text, savedAt };
          const idx = existing.findIndex((n) => n.findingId === findingId);
          if (idx >= 0) existing[idx] = note;
          else existing.push(note);
          await writeJson(deps, deps.notesPath(caseId), existing);
          return existing;
        });
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
          if (idx >= 0) {
            existing[idx] = {
              ...artifact,
              accounts: mergeNetworkAccounts(existing[idx].accounts ?? [], artifact.accounts ?? []),
            };
          } else {
            existing.push(artifact);
          }
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

    posts: {
      read(caseId) {
        return withLock(`x-listening:posts:${caseId}`, () =>
          readJsonArr<XPostArtifact>(deps, deps.postsPath(caseId)),
        );
      },
      write(caseId, posts) {
        return withLock(`x-listening:posts:${caseId}`, () =>
          writeJson(deps, deps.postsPath(caseId), posts),
        );
      },
      save(caseId, posts) {
        return withLock(`x-listening:posts:${caseId}`, async () => {
          const p = deps.postsPath(caseId);
          const existing = await readJsonArr<XPostArtifact>(deps, p);
          const seen = new Set(existing.map((i) => i.id));
          let added = 0;
          let skipped = 0;
          for (const post of posts) {
            if (seen.has(post.id)) {
              skipped++;
            } else {
              existing.push(post);
              seen.add(post.id);
              added++;
            }
          }
          if (added > 0) await writeJson(deps, p, existing);
          return { added, skipped };
        });
      },
    },

    presets: {
      read(caseId) {
        return withLock(`x-listening:presets:${caseId}`, () =>
          readJsonArr<XPreset>(deps, deps.presetsPath(caseId)),
        );
      },
      write(caseId, presets) {
        return withLock(`x-listening:presets:${caseId}`, () =>
          writeJson(deps, deps.presetsPath(caseId), presets),
        );
      },
      save(caseId, preset) {
        // Direct readJsonArr/writeJson (NOT presets.read/write) inside the lock: withLock is
        // not reentrant, and read/write take the SAME key.
        return withLock(`x-listening:presets:${caseId}`, async () => {
          const existing = await readJsonArr<XPreset>(deps, deps.presetsPath(caseId));
          const idx = existing.findIndex((p) => p.id === preset.id);
          if (idx >= 0) existing[idx] = preset;
          else existing.push(preset);
          await writeJson(deps, deps.presetsPath(caseId), existing);
          return existing;
        });
      },
    },

    entitiesCache: {
      read(caseId) {
        return withLock(`x-listening:entities:${caseId}`, () =>
          readJsonArr<XEntityCacheEntry>(deps, deps.entitiesCachePath(caseId)),
        );
      },
      write(caseId, entities) {
        return withLock(`x-listening:entities:${caseId}`, () =>
          writeJson(deps, deps.entitiesCachePath(caseId), entities),
        );
      },
    },

    changeEvents: {
      read(caseId) {
        return withLock(`x-listening:changeEvents:${caseId}`, () =>
          readJsonArr<XChangeEvent>(deps, deps.changeEventsPath(caseId)),
        );
      },
      append(caseId, event) {
        // Direct readJsonArr/writeJson (NOT changeEvents.read) inside the lock: withLock is not
        // reentrant, and read/append take the SAME key.
        return withLock(`x-listening:changeEvents:${caseId}`, async () => {
          const existing = await readJsonArr<XChangeEvent>(deps, deps.changeEventsPath(caseId));
          existing.push(event);
          // Cap to the newest X_MAX_CHANGE_EVENTS (drop oldest) so the log never grows unbounded.
          const capped =
            existing.length > X_MAX_CHANGE_EVENTS ? existing.slice(-X_MAX_CHANGE_EVENTS) : existing;
          await writeJson(deps, deps.changeEventsPath(caseId), capped);
          return capped;
        });
      },
    },

    profileSnapshots: {
      read(caseId) {
        return withLock(`x-listening:profileSnapshots:${caseId}`, () =>
          readJsonArr<XProfileSnapshot>(deps, deps.profileSnapshotsPath(caseId)),
        );
      },
      write(caseId, snapshots) {
        return withLock(`x-listening:profileSnapshots:${caseId}`, () =>
          writeJson(deps, deps.profileSnapshotsPath(caseId), snapshots),
        );
      },
      append(caseId, snapshot) {
        return withLock(`x-listening:profileSnapshots:${caseId}`, async () => {
          const existing = await readJsonArr<XProfileSnapshot>(deps, deps.profileSnapshotsPath(caseId));
          existing.push(snapshot);
          await writeJson(deps, deps.profileSnapshotsPath(caseId), existing);
          return existing;
        });
      },
      async latest(caseId, profileId) {
        return withLock(`x-listening:profileSnapshots:${caseId}`, async () => {
          const existing = await readJsonArr<XProfileSnapshot>(deps, deps.profileSnapshotsPath(caseId));
          // Append order IS capture order (deterministic — never readdir/clock ordered), so the
          // last matching entry is the most recent snapshot for this profile.
          for (let i = existing.length - 1; i >= 0; i--) {
            if (existing[i]!.profileId === profileId) return existing[i]!;
          }
          return null;
        });
      },
    },

    async listChangeEvents(caseId) {
      const events = await withLock(`x-listening:changeEvents:${caseId}`, () =>
        readJsonArr<XChangeEvent>(deps, deps.changeEventsPath(caseId)),
      );
      // Newest-first for the renderer; the persisted list is already capped, so reverse a bounded
      // tail (defensive re-cap in case a legacy file exceeded the cap).
      const bounded = events.length > X_MAX_CHANGE_EVENTS ? events.slice(-X_MAX_CHANGE_EVENTS) : events;
      return bounded.reverse();
    },

    runLog: {
      read(caseId) {
        return withLock(`x-listening:runLog:${caseId}`, () =>
          readJsonArr<XRunLogRecord>(deps, deps.runLogPath(caseId)),
        );
      },
      append(caseId, record) {
        // Direct readJsonArr/writeJson (NOT runLog.read) inside the lock: withLock is not reentrant,
        // and read/append take the SAME key.
        return withLock(`x-listening:runLog:${caseId}`, async () => {
          const existing = await readJsonArr<XRunLogRecord>(deps, deps.runLogPath(caseId));
          existing.push(record);
          // Cap to the newest X_MAX_RUN_LOG (drop oldest) so the log never grows unbounded.
          const capped = existing.length > X_MAX_RUN_LOG ? existing.slice(-X_MAX_RUN_LOG) : existing;
          await writeJson(deps, deps.runLogPath(caseId), capped);
          return capped;
        });
      },
    },

    async listRunLog(caseId) {
      const records = await withLock(`x-listening:runLog:${caseId}`, () =>
        readJsonArr<XRunLogRecord>(deps, deps.runLogPath(caseId)),
      );
      // Newest-first for the renderer; the persisted list is already capped, so reverse a bounded
      // tail (defensive re-cap in case a legacy file exceeded the cap).
      const bounded = records.length > X_MAX_RUN_LOG ? records.slice(-X_MAX_RUN_LOG) : records;
      return bounded.reverse();
    },
  };
}

// ---- production-wired singleton ----------------------------------------
// Lazy: electron/paths/secure-fs are resolved only on first call, so importing this module
// in tests that inject their own deps never evaluates electron. The item sidecar reuses the
// canonical scrapingCaseItemsFile('x', …) path (single source of truth); the artifact
// sidecars are per-case JSON files alongside it under scrapingCaseDir('x', id).

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
    postsPath: (id) => artifact(id, 'x-posts.json'),
    presetsPath: (id) => artifact(id, 'x-presets.json'),
    entitiesCachePath: (id) => artifact(id, 'x-entities-cache.json'),
    changeEventsPath: (id) => artifact(id, 'x-change-events.json'),
    profileSnapshotsPath: (id) => artifact(id, 'x-profile-snapshots.json'),
    runLogPath: (id) => artifact(id, 'x-run-log.json'),
  });
  return _prod;
}

/** Test-only: drop the cached production store. */
export function __resetProdXStore(): void {
  _prod = null;
}
