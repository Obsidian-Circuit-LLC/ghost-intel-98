/**
 * Task 2 — pure evidence functions, ported (adapted) from the quarantined
 * `enterprise.cjs:3-34` (`sha256`/`canonicalPostEvidence`/`canonicalRelationshipEvidence`).
 *
 * Honesty-fix coverage: Enterprise's `canonicalPostEvidence` omits `metrics` entirely, so a
 * post's displayed engagement counts could be edited post-collection without invalidating the
 * evidence hash. The port folds BOTH `metrics` (parsed) and `metricsRaw` (platform string,
 * per the store.ts XPostMetricsRaw doc) into the canonical form, so any change to either
 * changes the hash.
 */
import { describe, it, expect } from 'vitest';
import {
  sha256,
  canonicalPostEvidence,
  postEvidenceHash,
  canonicalRelationshipEvidence,
  relationshipEvidenceHash,
  type PostEvidenceSource,
  type RelationshipEvidenceSource,
} from '../src/main/x-listening/evidence';

function basePost(overrides: Partial<PostEvidenceSource> = {}): PostEvidenceSource {
  return {
    id: 'post-1',
    authorId: 'author-1',
    authorHandle: 'ghostexodus',
    channelId: 'ghostexodus',
    channelLabel: '@ghostexodus',
    url: 'https://x.com/ghostexodus/status/1',
    text: 'hello world',
    publishedAt: '2026-08-01T00:00:00.000Z',
    kind: 'post',
    parentPostId: null,
    mediaRefs: [],
    metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
    metricsRaw: { replies: '1', reposts: '2', likes: '3', views: '4' },
    provenance: { caseId: 'case-1' },
    ...overrides,
  };
}

function baseRel(overrides: Partial<RelationshipEvidenceSource> = {}): RelationshipEvidenceSource {
  return {
    target: 'ghostexodus',
    kind: 'followers',
    handle: 'someuser',
    displayName: 'Some User',
    bio: 'bio text',
    ...overrides,
  };
}

describe('sha256', () => {
  it('hashes a raw string directly (no re-stringify)', () => {
    expect(sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('hashes a non-string value via a deterministic JSON.stringify', () => {
    const a = sha256({ x: 1, y: 2 });
    const b = sha256({ x: 1, y: 2 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe('canonicalPostEvidence', () => {
  it('folds parsed metrics into the canonical shape', () => {
    const c = canonicalPostEvidence(basePost());
    expect(c.metrics).toEqual({ replies: 1, reposts: 2, likes: 3, views: 4 });
  });

  it('folds the RAW platform metric strings into the canonical shape', () => {
    const c = canonicalPostEvidence(basePost());
    expect(c.metricsRaw).toEqual({ replies: '1', reposts: '2', likes: '3', views: '4' });
  });

  it('is missing-field tolerant like the source (coerces to empty/zero, never throws)', () => {
    const c = canonicalPostEvidence(
      basePost({
        metrics: {} as PostEvidenceSource['metrics'],
        metricsRaw: {},
        parentPostId: null,
      }),
    );
    expect(c.metrics).toEqual({ replies: 0, reposts: 0, likes: 0, views: 0 });
    expect(c.metricsRaw).toEqual({ replies: '', reposts: '', likes: '', views: '' });
  });

  it('pulls caseId from provenance.caseId', () => {
    const c = canonicalPostEvidence(basePost({ provenance: { caseId: 'case-xyz' } }));
    expect(c.caseId).toBe('case-xyz');
  });

  it('copies mediaRefs defensively (does not alias the input array)', () => {
    const refs = ['a.bin'];
    const post = basePost({ mediaRefs: refs });
    const c = canonicalPostEvidence(post);
    expect(c.mediaRefs).toEqual(['a.bin']);
    expect(c.mediaRefs).not.toBe(refs);
  });
});

describe('postEvidenceHash — evidence hash changes when metrics change (Task 2 requirement)', () => {
  it('changes when parsed metrics.likes changes, all else equal', () => {
    const h1 = postEvidenceHash(basePost());
    const h2 = postEvidenceHash(basePost({ metrics: { replies: 1, reposts: 2, likes: 999, views: 4 } }));
    expect(h1).not.toBe(h2);
  });

  it('changes when metricsRaw changes even if parsed metrics stay the same', () => {
    const h1 = postEvidenceHash(basePost());
    const h2 = postEvidenceHash(basePost({ metricsRaw: { replies: '1', reposts: '2', likes: '3', views: '4,000' } }));
    expect(h1).not.toBe(h2);
  });

  it('is stable for identical input (deterministic — no clock/RNG inside)', () => {
    const h1 = postEvidenceHash(basePost());
    const h2 = postEvidenceHash(basePost());
    expect(h1).toBe(h2);
  });

  it('changes when text changes', () => {
    const h1 = postEvidenceHash(basePost());
    const h2 = postEvidenceHash(basePost({ text: 'edited text' }));
    expect(h1).not.toBe(h2);
  });

  it('ignores fields outside the canonical set (e.g. an unrelated extra prop) — hash is a pure function of the canonical shape', () => {
    const post = basePost();
    const h1 = postEvidenceHash(post);
    const withExtra = { ...post, somethingIrrelevant: 'nope' } as unknown as PostEvidenceSource;
    const h2 = postEvidenceHash(withExtra);
    expect(h1).toBe(h2);
  });
});

describe('canonicalRelationshipEvidence', () => {
  it('produces a deterministic canonical shape from caseId/target/kind/handle', () => {
    const c = canonicalRelationshipEvidence(baseRel({ caseId: 'case-1' }));
    expect(c).toEqual({
      caseId: 'case-1',
      target: 'ghostexodus',
      kind: 'followers',
      handle: 'someuser',
      displayName: 'Some User',
      bio: 'bio text',
    });
  });

  it('coerces missing optional fields (incl. caseId) to empty strings, never throws', () => {
    const c = canonicalRelationshipEvidence({ target: 't', kind: 'following', handle: 'h' });
    expect(c.caseId).toBe('');
    expect(c.displayName).toBe('');
    expect(c.bio).toBe('');
  });
});

// ---- L4 (PC4): caseId in the relationship evidence canonical -------------
//
// His `canonicalRelationshipEvidence` (enterprise.cjs:24-34) folds `caseId` in, so the
// SAME account observed under two DIFFERENT cases hashes distinctly — the evidence trail
// is case-scoped. Ours had dropped caseId, so identical accounts across cases collided.
describe('relationshipEvidenceHash: caseId scoping (L4)', () => {
  it('the SAME account hashes DISTINCTLY across two different cases', () => {
    const h1 = relationshipEvidenceHash(baseRel({ caseId: 'case-1' }));
    const h2 = relationshipEvidenceHash(baseRel({ caseId: 'case-2' }));
    expect(h1).not.toBe(h2);
  });

  it('is stable for the same account within ONE case', () => {
    const h1 = relationshipEvidenceHash(baseRel({ caseId: 'case-1' }));
    const h2 = relationshipEvidenceHash(baseRel({ caseId: 'case-1' }));
    expect(h1).toBe(h2);
  });
});

describe('relationshipEvidenceHash', () => {
  it('changes when the handle changes', () => {
    const h1 = relationshipEvidenceHash(baseRel());
    const h2 = relationshipEvidenceHash(baseRel({ handle: 'otheruser' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when kind changes (followers vs following are distinct facts)', () => {
    const h1 = relationshipEvidenceHash(baseRel({ kind: 'followers' }));
    const h2 = relationshipEvidenceHash(baseRel({ kind: 'following' }));
    expect(h1).not.toBe(h2);
  });

  it('is stable for identical input', () => {
    const h1 = relationshipEvidenceHash(baseRel());
    const h2 = relationshipEvidenceHash(baseRel());
    expect(h1).toBe(h2);
  });
});
