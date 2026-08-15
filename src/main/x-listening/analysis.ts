/**
 * X Listening Station — network analysis, collection health, entity extraction (Task 2).
 *
 * Ported (adapted) from the quarantined `enterprise.cjs:40-231`
 * (`extractEntities`/`computeNetworkAnalysis`/`deriveCollectionHealth`). PURE and
 * derived-on-read: no persistence, no electron, no filesystem — callers (later tasks) feed
 * in already-loaded/case-scoped store data and persist nothing back here.
 *
 * Determinism (Global Constraints / ~/.claude/CLAUDE.md determinism floor + this codebase's
 * "caller supplies every timestamp" convention — see store.ts): Enterprise's
 * `computeNetworkAnalysis` calls `new Date().toISOString()` internally for `generatedAt`.
 * This port instead takes `now` as an injected ISO-string parameter, so the function's output
 * is a pure function of its arguments and reproducible in a test.
 *
 * Honesty (demo-data exclusion — design doc "Demo data" / Task 12): both
 * `computeNetworkAnalysis` and `deriveCollectionHealth`-adjacent callers must never let a
 * `synthetic: true` record leak into real network intel. `computeNetworkAnalysis` filters
 * `synthetic` profiles/relationships out itself, defense-in-depth, so a caller that forgets
 * to pre-filter still can't taint the analysis.
 */
import type { XNetworkArtifact, XRunLogRecord } from './store';

// ---- entity extraction ----------------------------------------------------

export type EntityType =
  | 'mention'
  | 'hashtag'
  | 'email'
  | 'url'
  | 'domain'
  | 'crypto_eth'
  | 'crypto_btc'
  | 'phone'
  | 'organization';

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalizedValue: string;
}

/** Strip trailing sentence punctuation a URL match tends to swallow (`.`, `,`, `;`, `!`, `?`,
 *  a closing paren) — ported verbatim from `enterprise.cjs:36-38`. */
function cleanUrl(raw: string): string {
  return String(raw ?? '').replace(/[),.;!?]+$/g, '');
}

/** Extract mentions/hashtags/emails/urls+domains/eth+btc addresses/phone numbers/org names
 *  from free text — conservative, regex-based, never fabricates a match. Deduped by
 *  `type:normalizedValue`. Ported near-verbatim from `enterprise.cjs:40-80`. */
export function extractEntities(text: string): ExtractedEntity[] {
  const source = String(text ?? '');
  const values: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const add = (type: EntityType, value: string, normalized: string = value): void => {
    const v = String(value ?? '').trim();
    const n = String(normalized ?? '').trim();
    if (!v || !n) return;
    const key = `${type}:${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    values.push({ type, value: v, normalizedValue: n.toLowerCase() });
  };

  for (const match of source.matchAll(/(^|[^\w])@([A-Za-z0-9_]{1,15})\b/g)) add('mention', `@${match[2]}`, match[2]);
  for (const match of source.matchAll(/(^|[^\w])#([\p{L}\p{N}_]{2,80})/gu)) add('hashtag', `#${match[2]}`, match[2]);
  for (const match of source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) add('email', match[0], match[0]);
  for (const match of source.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = cleanUrl(match[0]);
    add('url', url, url);
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      if (host) add('domain', host, host);
    } catch {
      // Malformed URL captured from free text — ignore, matching enterprise.cjs:63-64.
    }
  }
  for (const match of source.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi)) {
    const domain = match[0].replace(/^www\./i, '');
    if (!domain.includes('@')) add('domain', domain, domain);
  }
  for (const match of source.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) add('crypto_eth', match[0], match[0]);
  for (const match of source.matchAll(/\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g)) add('crypto_btc', match[0], match[0]);
  for (const match of source.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) add('phone', match[0].trim(), digits);
  }
  const orgPattern = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,5}\s+(?:Inc\.?|LLC|Ltd\.?|Limited|PLC|Corp\.?|Corporation|Company|Group|Holdings|Foundation|Association|University|Institute|Agency|Ministry|Department))\b/g;
  for (const match of source.matchAll(orgPattern)) add('organization', match[1], match[1]);
  return values;
}

// ---- network analysis ------------------------------------------------------

/** A tracked X target — adapted from Enterprise's `state.profiles[]` row. `id` is the
 *  target's stable key (in this port, ordinarily the same value as its handle — the port's
 *  data model has no separate numeric profile id); `synthetic: true` marks a demo/seeded
 *  target, excluded below. */
export interface AnalysisProfile {
  id: string;
  username: string;
  synthetic?: boolean;
}

/** One flattened follower/following observation — adapted from Enterprise's
 *  `state.relationships[]` row (`profileId` still points at `AnalysisProfile.id`). Task 7
 *  flattens a captured `XNetworkArtifact.accounts[]` into a list of these.
 *  `synthetic: true` marks a demo/seeded row, excluded below regardless of its profile. */
export interface AnalysisRelationship {
  profileId: string;
  relationship: 'follower' | 'following';
  username: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  url?: string;
  firstObservedAt?: string | null;
  lastObservedAt?: string | null;
  synthetic?: boolean;
}

export interface NetworkIdentity {
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  url: string;
  profileIds: string[];
  followerOfProfileIds: string[];
  followingFromProfileIds: string[];
  followerOf: string[];
  followingFrom: string[];
  connectedTargets: number;
  overlapScore: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export interface NetworkPair {
  profileAId: string;
  profileA: string;
  profileBId: string;
  profileB: string;
  commonFollowers: string[];
  commonFollowing: string[];
  commonAny: string[];
  commonFollowerCount: number;
  commonFollowingCount: number;
  commonAnyCount: number;
}

export interface NetworkGraphNode {
  id: string;
  type: 'target' | 'identity';
  label: string;
  profileId?: string;
  username: string;
  avatar: string;
  score: number;
  connectedTargets?: number;
}

export interface NetworkGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: 'follower' | 'following';
}

export interface NetworkAnalysis {
  generatedAt: string;
  targetCount: number;
  relationshipCount: number;
  uniqueIdentityCount: number;
  commonIdentityCount: number;
  highOverlapCount: number;
  pairs: NetworkPair[];
  identities: NetworkIdentity[];
  graph: { nodes: NetworkGraphNode[]; edges: NetworkGraphEdge[] };
}

interface IdentityAccumulator {
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  url: string;
  followerOfProfileIds: Set<string>;
  followingFromProfileIds: Set<string>;
  profileIds: Set<string>;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

/**
 * Flatten a case's captured `networks` artifacts (store.ts `XNetworkArtifact[]`, as
 * accumulated by `store.ts`'s `networks.save`) into the `AnalysisProfile[]` /
 * `AnalysisRelationship[]` shape `computeNetworkAnalysis` consumes (Task 7). One artifact
 * — one (target, kind) pair — contributes one tracked profile (keyed by `target`) plus one
 * relationship row per captured account, `kind:'followers'`→`relationship:'follower'` /
 * `'following'`→`'following'`. Every account field that exists on the Task 7 accumulator
 * (`evidenceHash` is intentionally NOT carried — `computeNetworkAnalysis` never consumes
 * it, and `AnalysisRelationship` has no such field) is propagated: `firstObservedAt` /
 * `lastObservedAt` feed the identity roll-up's own first/last-seen columns, and `synthetic`
 * is propagated so a demo/seeded account (Task 12) is excluded by
 * `computeNetworkAnalysis`'s own `synthetic` filter even if a caller forgets to pre-filter.
 *
 * Task 12 addition: a TARGET (profile) every one of whose captured accounts — across every
 * artifact contributing to it — is synthetic is itself a wholly demo/seeded target (the exact
 * shape `demo.ts` produces: a freshly demo-loaded campaign has no real network data at all).
 * Such a profile is marked `synthetic: true` too, not just its relationship rows, so
 * `computeNetworkAnalysis`'s own `liveProfiles = profiles.filter(p => !p.synthetic)` excludes
 * the fabricated target from `targetCount`/graph target nodes entirely — otherwise a demo
 * target would still surface as an isolated phantom node with zero real connections, a smaller
 * but real leak of fabricated data into "real" analysis output. A target with AT LEAST ONE real
 * (non-synthetic) account — e.g. demo data loaded into an already-monitored target — keeps its
 * profile live: it has genuine relationship data worth showing, and its demo rows are already
 * excluded at the relationship level above. A target with NO accounts observed at all (an
 * honest empty real capture, e.g. a followers page nobody follows) is left alone — never marked
 * synthetic — so an empty-but-real capture is never mistaken for a demo one.
 *
 * PURE — no store I/O; the caller does the read.
 */
export function flattenNetworkArtifacts(
  artifacts: readonly XNetworkArtifact[],
): { profiles: AnalysisProfile[]; relationships: AnalysisRelationship[] } {
  const profiles = new Map<string, AnalysisProfile>();
  const relationships: AnalysisRelationship[] = [];
  const hasAnyAccount = new Map<string, boolean>();
  const hasRealAccount = new Map<string, boolean>();
  for (const artifact of artifacts) {
    const id = String(artifact.target ?? '');
    if (!id) continue;
    if (!profiles.has(id)) profiles.set(id, { id, username: artifact.target });
    for (const account of artifact.accounts ?? []) {
      hasAnyAccount.set(id, true);
      if (!account.synthetic) hasRealAccount.set(id, true);
      relationships.push({
        profileId: id,
        relationship: artifact.kind === 'followers' ? 'follower' : 'following',
        username: account.handle,
        displayName: account.displayName,
        bio: account.bio,
        avatar: account.avatar,
        firstObservedAt: account.firstObservedAt ?? null,
        lastObservedAt: account.lastObservedAt ?? null,
        ...(account.synthetic ? { synthetic: true as const } : {}),
      });
    }
  }
  for (const [id, profile] of profiles) {
    if (hasAnyAccount.get(id) === true && hasRealAccount.get(id) !== true) {
      profile.synthetic = true;
    }
  }
  return { profiles: [...profiles.values()], relationships };
}

/**
 * Common-connection network analysis over a case-scoped set of tracked targets and their
 * captured follower/following rows — identities (one per unique @handle seen across all
 * targets), pairwise overlap between every pair of targets, and a graph of targets + the
 * identities connected to >=2 of them. Ported near-verbatim from `enterprise.cjs:82-201`
 * (minus the internal caseId filter — the caller passes an already case-scoped slice) with
 * two adaptations: `now` is an injected ISO timestamp (determinism), and `synthetic` rows
 * are excluded here as well as by the caller (honesty, defense-in-depth).
 */
export function computeNetworkAnalysis(
  profiles: AnalysisProfile[],
  relationships: AnalysisRelationship[],
  now: string,
): NetworkAnalysis {
  const liveProfiles = profiles.filter((p) => !p.synthetic);
  const profileById = new Map(liveProfiles.map((p) => [p.id, p]));
  const liveRelationships = relationships.filter(
    (r) => !r.synthetic && profileById.has(r.profileId),
  );

  const identityMap = new Map<string, IdentityAccumulator>();
  for (const row of liveRelationships) {
    const key = String(row.username ?? '').toLowerCase();
    if (!key) continue;
    let item = identityMap.get(key);
    if (!item) {
      item = {
        username: row.username,
        displayName: row.displayName || row.username,
        bio: row.bio || '',
        avatar: row.avatar || '',
        url: row.url || `https://x.com/${row.username}`,
        followerOfProfileIds: new Set(),
        followingFromProfileIds: new Set(),
        profileIds: new Set(),
        firstObservedAt: row.firstObservedAt || null,
        lastObservedAt: row.lastObservedAt || null,
      };
      identityMap.set(key, item);
    }
    item.profileIds.add(row.profileId);
    if (row.relationship === 'follower') item.followerOfProfileIds.add(row.profileId);
    if (row.relationship === 'following') item.followingFromProfileIds.add(row.profileId);
    if (String(row.lastObservedAt || '') > String(item.lastObservedAt || '')) {
      item.lastObservedAt = row.lastObservedAt || item.lastObservedAt;
    }
    if (!item.firstObservedAt || String(row.firstObservedAt || '') < String(item.firstObservedAt)) {
      item.firstObservedAt = row.firstObservedAt || item.firstObservedAt;
    }
  }

  const totalTargets = Math.max(1, liveProfiles.length);
  const identities: NetworkIdentity[] = [...identityMap.values()]
    .map((item) => {
      const profileIds = [...item.profileIds];
      const followerOfProfileIds = [...item.followerOfProfileIds];
      const followingFromProfileIds = [...item.followingFromProfileIds];
      const connectedTargets = profileIds.length;
      const relationshipDiversity =
        (followerOfProfileIds.length ? 1 : 0) + (followingFromProfileIds.length ? 1 : 0);
      const overlapScore = Math.min(
        100,
        Math.round((connectedTargets / totalTargets) * 90 + (relationshipDiversity === 2 ? 10 : 0)),
      );
      return {
        username: item.username,
        displayName: item.displayName,
        bio: item.bio,
        avatar: item.avatar,
        url: item.url,
        profileIds,
        followerOfProfileIds,
        followingFromProfileIds,
        followerOf: followerOfProfileIds.map((id) => profileById.get(id)?.username).filter(
          (v): v is string => Boolean(v),
        ),
        followingFrom: followingFromProfileIds.map((id) => profileById.get(id)?.username).filter(
          (v): v is string => Boolean(v),
        ),
        connectedTargets,
        overlapScore,
        firstObservedAt: item.firstObservedAt,
        lastObservedAt: item.lastObservedAt,
      };
    })
    .sort(
      (a, b) =>
        b.connectedTargets - a.connectedTargets ||
        b.overlapScore - a.overlapScore ||
        a.username.localeCompare(b.username),
    );

  const setsFor = (profileId: string, relationship: 'follower' | 'following'): Set<string> =>
    new Set(
      liveRelationships
        .filter((r) => r.profileId === profileId && r.relationship === relationship)
        .map((r) => String(r.username ?? '').toLowerCase()),
    );

  const pairs: NetworkPair[] = [];
  for (let i = 0; i < liveProfiles.length; i += 1) {
    for (let j = i + 1; j < liveProfiles.length; j += 1) {
      const a = liveProfiles[i];
      const b = liveProfiles[j];
      const aFollowers = setsFor(a.id, 'follower');
      const bFollowers = setsFor(b.id, 'follower');
      const aFollowing = setsFor(a.id, 'following');
      const bFollowing = setsFor(b.id, 'following');
      const commonFollowers = [...aFollowers].filter((u) => bFollowers.has(u));
      const commonFollowing = [...aFollowing].filter((u) => bFollowing.has(u));
      const anyA = new Set([...aFollowers, ...aFollowing]);
      const anyB = new Set([...bFollowers, ...bFollowing]);
      const commonAny = [...anyA].filter((u) => anyB.has(u));
      pairs.push({
        profileAId: a.id,
        profileA: a.username,
        profileBId: b.id,
        profileB: b.username,
        commonFollowers,
        commonFollowing,
        commonAny,
        commonFollowerCount: commonFollowers.length,
        commonFollowingCount: commonFollowing.length,
        commonAnyCount: commonAny.length,
      });
    }
  }
  pairs.sort((a, b) => b.commonAnyCount - a.commonAnyCount || b.commonFollowerCount - a.commonFollowerCount);

  const top = identities.filter((x) => x.connectedTargets >= 2).slice(0, 100);
  const nodes: NetworkGraphNode[] = [
    ...liveProfiles.map((p) => ({
      id: `target:${p.id}`,
      type: 'target' as const,
      label: `@${p.username}`,
      profileId: p.id,
      username: p.username,
      avatar: '',
      score: 100,
    })),
    ...top.map((x) => ({
      id: `identity:${x.username.toLowerCase()}`,
      type: 'identity' as const,
      label: `@${x.username}`,
      username: x.username,
      avatar: x.avatar || '',
      score: x.overlapScore,
      connectedTargets: x.connectedTargets,
    })),
  ];
  const graphIdentityNames = new Set(top.map((x) => x.username.toLowerCase()));
  const edges: NetworkGraphEdge[] = liveRelationships
    .filter((r) => graphIdentityNames.has(String(r.username ?? '').toLowerCase()))
    .map((r) => ({
      id: `${r.profileId}:${r.relationship}:${String(r.username).toLowerCase()}`,
      source: `target:${r.profileId}`,
      target: `identity:${String(r.username).toLowerCase()}`,
      relationship: r.relationship,
    }));

  return {
    generatedAt: now,
    targetCount: liveProfiles.length,
    relationshipCount: liveRelationships.length,
    uniqueIdentityCount: identities.length,
    commonIdentityCount: identities.filter((x) => x.connectedTargets >= 2).length,
    highOverlapCount: identities.filter(
      (x) => x.connectedTargets >= Math.max(2, Math.ceil(liveProfiles.length * 0.5)),
    ).length,
    pairs,
    identities,
    graph: { nodes, edges },
  };
}

// ---- collection health ------------------------------------------------------

export type CollectionOperation =
  | 'posts'
  | 'archive_posts'
  | 'followers'
  | 'archive_followers'
  | 'following'
  | 'archive_following';

/** One collection cycle's outcome for one target — adapted from Enterprise's
 *  `state.collectionRuns[]` row. `error`, when present, mirrors what Enterprise tracked as
 *  the PROFILE's sticky `lastError`; this port has no separate profile object here, so the
 *  most recent run's own `error` is the closest-available signal. */
export interface XCollectionRun {
  profileId: string;
  username: string;
  operation: CollectionOperation;
  /** ISO timestamp — injected clock (the caller stamps it at capture time), never computed
   *  here; used only for sort ordering (string comparison, matching `enterprise.cjs:207`). */
  startedAt: string;
  added?: number;
  observed?: number;
  error?: string | null;
}

export type CollectionStatus = 'HEALTHY' | 'ERROR' | 'PLATEAU' | 'IDLE';

/** A tracked target for the health roster (audit HIGH #6). GI98 has no first-class profile
 *  record — a "target" is DERIVED (see `campaigns.ts`) from captured posts/networks/runs — so
 *  the caller (ipc.ts) unions those sources into this roster. A roster target with NO runs
 *  yields an `IDLE` health record (Enterprise's 4th status, `enterprise.cjs:214`), instead of
 *  the record simply being absent. `profileId` is the caller's canonical source key. */
export interface XHealthTarget {
  profileId: string;
  username: string;
}

/** One captured post reduced to the two fields the health rollup needs: which target it came
 *  from (`profileId`, the caller's canonical source key) and its platform timestamp
 *  (`createdAt`) for the `oldestPostAt` column. */
export interface XHealthPost {
  profileId: string;
  createdAt: string | null;
}

/** One flattened follower/following observation for the health rollup — `profileId` is the
 *  target whose network it belongs to, `relationship` splits the follower/following counts. */
export interface XHealthRelationship {
  profileId: string;
  relationship: 'follower' | 'following';
}

/** Per-target contextual inputs restoring Enterprise's `postCount`/`followerCount`/
 *  `followingCount`/`oldestPostAt` columns + the `IDLE` roster (`enterprise.cjs:203-231`),
 *  all of which the runs-only port dropped. Every field is optional so a legacy caller
 *  passing only `runs` keeps the exact prior behaviour (roster derived from runs, counts 0). */
export interface DeriveCollectionHealthOptions {
  targets?: readonly XHealthTarget[];
  posts?: readonly XHealthPost[];
  relationships?: readonly XHealthRelationship[];
}

export interface XCollectionHealth {
  profileId: string;
  username: string;
  status: CollectionStatus;
  lastError: string | null;
  /** Restored Enterprise columns (`enterprise.cjs:221-224`). */
  postCount: number;
  followerCount: number;
  followingCount: number;
  oldestPostAt: string | null;
  lastPostRun: XCollectionRun | null;
  lastFollowerRun: XCollectionRun | null;
  lastFollowingRun: XCollectionRun | null;
  /** Null for an `IDLE` target (no run recorded yet) — matches Enterprise `lastAny || null`. */
  lastRun: XCollectionRun | null;
}

/**
 * Reduce a persisted run-log record (`store.ts` `XRunLogRecord`) to the health-layer
 * `XCollectionRun` shape. THE ERROR-KEYING FIX (audit HIGH #6): Enterprise's health keyed
 * ERROR off the profile's sticky `lastError`; the runs-only port keyed it off a `lastAny.error`
 * field that `XRunLogRecord` does NOT have (it carries `status`/`stopReason`, not `error`), so
 * ERROR could never fire. Here `error` is derived from `status === 'error'` (message = the
 * `stopReason`, or a generic `'error'`), so a failed run is now correctly flagged.
 */
export function runLogRecordToRun(record: XRunLogRecord): XCollectionRun {
  return {
    profileId: record.profileId,
    username: record.username,
    operation: record.operation,
    startedAt: record.startedAt,
    added: record.added,
    observed: record.observed,
    error: record.status === 'error' ? (record.stopReason || 'error') : null,
  };
}

const PLATEAU_OPERATIONS = new Set<CollectionOperation>([
  'followers',
  'following',
  'archive_followers',
  'archive_following',
]);

/**
 * Derive one collection-health record per tracked target — a near-verbatim port of
 * `enterprise.cjs:203-231`, restoring the three things the runs-only port dropped (audit HIGH #6):
 *
 *  1. The IDLE roster. Enterprise iterated `state.profiles` (every monitored target), so a target
 *     with zero runs surfaced as `IDLE`, not as an absent record. GI98 has no profile list, so the
 *     caller (ipc.ts) unions its derived sources into `options.targets`; every roster target is
 *     reported, and one with no runs yields `IDLE`. When `options.targets` is omitted the roster
 *     falls back to the distinct `profileId`s in `runs` — the exact prior (runs-only) behaviour.
 *  2. The `postCount`/`followerCount`/`followingCount`/`oldestPostAt` columns, computed from
 *     `options.posts`/`options.relationships` (0/null when omitted).
 *  3. Correct ERROR keying lives in `runLogRecordToRun` (the caller maps records through it before
 *     handing them here); this function keys ERROR off `run.error` as before.
 *
 * Status precedence — most-recent-run error, THEN the plateau check overrides it if BOTH conditions
 * hold — is preserved exactly as Enterprise computed it (`enterprise.cjs:214-215`). A target with no
 * runs is `IDLE` regardless of counts (`enterprise.cjs:214`: `lastAny ? 'HEALTHY' : 'IDLE'`).
 *
 * Determinism: roster iteration is Map insertion order — targets first (caller order), then any
 * run-only profile in first-seen order — a pure function of the argument order, never a clock or
 * readdir (matching the original and store.ts's "caller supplies order" convention).
 */
export function deriveCollectionHealth(
  runs: readonly XCollectionRun[],
  options: DeriveCollectionHealthOptions = {},
): XCollectionHealth[] {
  const runsByProfile = new Map<string, XCollectionRun[]>();
  for (const r of runs) {
    const list = runsByProfile.get(r.profileId);
    if (list) list.push(r);
    else runsByProfile.set(r.profileId, [r]);
  }

  // Roster: explicit targets first (stable caller order), then any profile seen only in runs.
  const roster = new Map<string, string>();
  for (const t of options.targets ?? []) {
    if (t.profileId && !roster.has(t.profileId)) roster.set(t.profileId, t.username);
  }
  for (const [profileId, list] of runsByProfile) {
    if (!roster.has(profileId)) roster.set(profileId, list[0]?.username ?? profileId);
  }

  const postsByProfile = new Map<string, XHealthPost[]>();
  for (const p of options.posts ?? []) {
    const list = postsByProfile.get(p.profileId);
    if (list) list.push(p);
    else postsByProfile.set(p.profileId, [p]);
  }
  const relsByProfile = new Map<string, XHealthRelationship[]>();
  for (const r of options.relationships ?? []) {
    const list = relsByProfile.get(r.profileId);
    if (list) list.push(r);
    else relsByProfile.set(r.profileId, [r]);
  }

  const health: XCollectionHealth[] = [];
  for (const [profileId, username] of roster) {
    const sorted = [...(runsByProfile.get(profileId) ?? [])].sort((a, b) =>
      String(b.startedAt).localeCompare(String(a.startedAt)),
    );
    const lastAny = sorted[0] ?? null;
    const last = (operation: CollectionOperation): XCollectionRun | null =>
      sorted.find((r) => r.operation === operation) ?? null;

    const profilePosts = postsByProfile.get(profileId) ?? [];
    const profileRels = relsByProfile.get(profileId) ?? [];
    const oldestPostAt =
      profilePosts
        .map((p) => p.createdAt)
        .filter((v): v is string => Boolean(v))
        .sort()[0] ?? null;

    let status: CollectionStatus;
    if (!lastAny) {
      status = 'IDLE';
    } else {
      status = lastAny.error ? 'ERROR' : 'HEALTHY';
      if (
        (lastAny.added ?? 0) === 0 &&
        (lastAny.observed ?? 0) > 0 &&
        PLATEAU_OPERATIONS.has(lastAny.operation)
      ) {
        status = 'PLATEAU';
      }
    }

    health.push({
      profileId,
      username,
      status,
      lastError: lastAny?.error ?? null,
      postCount: profilePosts.length,
      followerCount: profileRels.filter((r) => r.relationship === 'follower').length,
      followingCount: profileRels.filter((r) => r.relationship === 'following').length,
      oldestPostAt,
      lastPostRun: last('posts') ?? last('archive_posts'),
      lastFollowerRun: last('followers') ?? last('archive_followers'),
      lastFollowingRun: last('following') ?? last('archive_following'),
      lastRun: lastAny,
    });
  }
  return health;
}
