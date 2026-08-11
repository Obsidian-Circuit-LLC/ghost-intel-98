/**
 * X Listening Station — evidence preservation (Task 2).
 *
 * Ported (adapted, not verbatim — the target's post/relationship shapes differ from
 * Enterprise's) from the quarantined `enterprise.cjs:1-34` (`sha256`, `canonicalPostEvidence`,
 * `canonicalRelationshipEvidence`). PURE: `node:crypto` only, no electron, no filesystem.
 *
 * Honesty fix over Enterprise (Global Constraints / design doc "Evidence preservation"):
 * Enterprise's `canonicalPostEvidence` omits `metrics` entirely, so a post's displayed
 * engagement counts (likes/reposts/replies/views) could be edited post-collection without
 * invalidating the evidence hash. This port folds BOTH the parsed `metrics` AND the RAW
 * platform strings `metricsRaw` (per the store.ts `XPostMetricsRaw` doc, which anticipates
 * this exact fold) into the canonical shape — altering either changes `postEvidenceHash`.
 *
 * Determinism: every canonical object below is built as a fixed-key-order literal on every
 * call, so `JSON.stringify` (and therefore the hash) is a pure function of the input values,
 * never of iteration/insertion order or a clock. No `Date.now()`/`new Date()` anywhere here.
 */
import { createHash } from 'node:crypto';
import type { XNetworkArtifact, XNetworkAccount, XPostArtifact } from './store';

/** sha256 hex digest. A string is hashed verbatim (UTF-8); anything else is JSON.stringify'd
 *  first — ported verbatim from `enterprise.cjs:3-6`. */
export function sha256(value: unknown): string {
  const data = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// ---- post evidence -------------------------------------------------------

/** The subset of a captured post artifact that feeds evidence hashing — deliberately
 *  NARROWER than the full `XPostArtifact`: bookkeeping fields that aren't evidentiary of
 *  content (`harvestedAt` collection-time bookkeeping, `relevanceScore` a later ranking
 *  step, `synthetic` itself, `evidenceHash` — the value being computed, `messageId`/
 *  `mediaType`/`mediaRef`/`platform` — HarvestedItem plumbing not part of Enterprise's
 *  canonical set) are excluded on purpose so a change to them never perturbs the hash. */
export type PostEvidenceSource = Pick<
  XPostArtifact,
  | 'id'
  | 'authorId'
  | 'authorHandle'
  | 'channelId'
  | 'channelLabel'
  | 'url'
  | 'text'
  | 'publishedAt'
  | 'kind'
  | 'parentPostId'
  | 'metrics'
  | 'metricsRaw'
> & {
  mediaRefs?: XPostArtifact['mediaRefs'];
  provenance: Pick<XPostArtifact['provenance'], 'caseId'>;
};

export interface CanonicalPostEvidence {
  id: string;
  caseId: string;
  authorId: string;
  authorHandle: string;
  channelId: string;
  channelLabel: string;
  url: string;
  text: string;
  publishedAt: string;
  kind: string;
  parentPostId: string | null;
  mediaRefs: string[];
  metrics: { replies: number; reposts: number; likes: number; views: number };
  metricsRaw: { replies: string; reposts: string; likes: string; views: string };
}

/** Canonical evidence shape for one captured post. Adapted from `enterprise.cjs:8-22`:
 *  `profileId`→`channelId`, `username`/`sourceUsername`→`authorHandle`/`channelLabel`,
 *  `createdAt`→`publishedAt`, `media`→`mediaRefs` (LOCAL refs only per the no-remote-media
 *  invariant — never a remote URL), plus the metrics fold described above. Every field is
 *  coerced (never throws on a missing/malformed source field), mirroring Enterprise's
 *  `String(x || '')` defensiveness. */
export function canonicalPostEvidence(post: PostEvidenceSource): CanonicalPostEvidence {
  return {
    id: String(post.id ?? ''),
    caseId: String(post.provenance?.caseId ?? ''),
    authorId: String(post.authorId ?? ''),
    authorHandle: String(post.authorHandle ?? ''),
    channelId: String(post.channelId ?? ''),
    channelLabel: String(post.channelLabel ?? ''),
    url: String(post.url ?? ''),
    text: String(post.text ?? ''),
    publishedAt: String(post.publishedAt ?? ''),
    kind: String(post.kind ?? ''),
    parentPostId: post.parentPostId ?? null,
    mediaRefs: Array.isArray(post.mediaRefs) ? [...post.mediaRefs] : [],
    metrics: {
      replies: Number(post.metrics?.replies ?? 0),
      reposts: Number(post.metrics?.reposts ?? 0),
      likes: Number(post.metrics?.likes ?? 0),
      views: Number(post.metrics?.views ?? 0),
    },
    metricsRaw: {
      replies: String(post.metricsRaw?.replies ?? ''),
      reposts: String(post.metricsRaw?.reposts ?? ''),
      likes: String(post.metricsRaw?.likes ?? ''),
      views: String(post.metricsRaw?.views ?? ''),
    },
  };
}

/** sha256 of `canonicalPostEvidence(post)` — the value stored as `XPostArtifact.evidenceHash`. */
export function postEvidenceHash(post: PostEvidenceSource): string {
  return sha256(canonicalPostEvidence(post));
}

// ---- relationship evidence ------------------------------------------------

/** One captured follower/following ROW, flattened to (target, kind, account) for hashing —
 *  the per-account evidentiary unit. Adapted from Enterprise's `row` (`profileId`/
 *  `relationship`/`username`) to this port's `XNetworkArtifact`/`XNetworkAccount`
 *  vocabulary (`target`/`kind`/`handle`) established in store.ts (Task 1); Task 7 flattens a
 *  captured `XNetworkArtifact.accounts[]` into one of these per account. `url` is dropped
 *  from Enterprise's row (an account's profile URL is derivable from `handle`, not a
 *  separately-observed fact worth hashing) and `avatar` is likewise excluded — it is
 *  cached media (Task 9), not an evidentiary text fact, and its byte-hash is the media
 *  artifact's own evidence trail. */
export interface RelationshipEvidenceSource {
  target: string;
  kind: XNetworkArtifact['kind'];
  handle: XNetworkAccount['handle'];
  displayName?: XNetworkAccount['displayName'];
  bio?: XNetworkAccount['bio'];
}

export interface CanonicalRelationshipEvidence {
  target: string;
  kind: string;
  handle: string;
  displayName: string;
  bio: string;
}

/** Canonical evidence shape for one relationship row — adapted from `enterprise.cjs:24-34`. */
export function canonicalRelationshipEvidence(
  rel: RelationshipEvidenceSource,
): CanonicalRelationshipEvidence {
  return {
    target: String(rel.target ?? ''),
    kind: String(rel.kind ?? ''),
    handle: String(rel.handle ?? ''),
    displayName: String(rel.displayName ?? ''),
    bio: String(rel.bio ?? ''),
  };
}

/** sha256 of `canonicalRelationshipEvidence(rel)`. */
export function relationshipEvidenceHash(rel: RelationshipEvidenceSource): string {
  return sha256(canonicalRelationshipEvidence(rel));
}
