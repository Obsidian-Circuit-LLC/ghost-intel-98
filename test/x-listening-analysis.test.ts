/**
 * Task 2 — pure analysis functions, ported (adapted) from the quarantined
 * `enterprise.cjs:40-231` (`extractEntities`/`computeNetworkAnalysis`/`deriveCollectionHealth`).
 *
 * Adaptations from the source (documented per Global Constraints — determinism + honesty):
 *  - `computeNetworkAnalysis` takes an already case-scoped `profiles`/`relationships` list
 *    (the caller does the caseId filtering — this module owns no case concept) plus an
 *    INJECTED `now` ISO string for `generatedAt` (never `new Date()` inside a pure function —
 *    the ~/.claude/CLAUDE.md determinism floor + this codebase's "caller supplies every
 *    timestamp" convention, see store.ts).
 *  - Both `computeNetworkAnalysis` AND `deriveCollectionHealth` defense-in-depth EXCLUDE any
 *    `synthetic: true` profile/relationship — the demo-data honesty invariant (Task 12 wires
 *    the demo flag; this function must not leak synthetic rows into real network intel even
 *    if a caller forgets to pre-filter).
 *  - `deriveCollectionHealth` takes only `runs` (no profiles/posts/relationships) per the
 *    plan's stated signature; it reports one health record per DISTINCT profileId seen in
 *    `runs` (a profile with zero runs simply has no entry — that's a UI-layer concern, not
 *    this pure function's).
 */
import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  computeNetworkAnalysis,
  deriveCollectionHealth,
  runLogRecordToRun,
  flattenNetworkArtifacts,
  type AnalysisProfile,
  type AnalysisRelationship,
  type XCollectionRun,
} from '../src/main/x-listening/analysis';
import type { XNetworkArtifact, XRunLogRecord } from '../src/main/x-listening/store';

describe('extractEntities', () => {
  it('extracts a mention', () => {
    expect(extractEntities('hello @ghostexodus how are you')).toContainEqual({
      type: 'mention',
      value: '@ghostexodus',
      normalizedValue: 'ghostexodus',
    });
  });

  it('extracts a hashtag (unicode-aware)', () => {
    expect(extractEntities('this is #OSINT news')).toContainEqual({
      type: 'hashtag',
      value: '#OSINT',
      normalizedValue: 'osint',
    });
  });

  it('extracts an email', () => {
    expect(extractEntities('contact me at analyst@example.com')).toContainEqual({
      type: 'email',
      value: 'analyst@example.com',
      normalizedValue: 'analyst@example.com',
    });
  });

  it('extracts a url and its domain, trimming trailing punctuation', () => {
    const out = extractEntities('see https://example.com/path.');
    expect(out).toContainEqual({ type: 'url', value: 'https://example.com/path', normalizedValue: 'https://example.com/path' });
    expect(out).toContainEqual({ type: 'domain', value: 'example.com', normalizedValue: 'example.com' });
  });

  it('extracts an eth address', () => {
    const addr = '0x' + 'a'.repeat(40);
    expect(extractEntities(`wallet ${addr}`)).toContainEqual({
      type: 'crypto_eth',
      value: addr,
      normalizedValue: addr.toLowerCase(),
    });
  });

  it('extracts a btc bech32 address', () => {
    const addr = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    expect(extractEntities(`send to ${addr}`)).toContainEqual({
      type: 'crypto_btc',
      value: addr,
      normalizedValue: addr,
    });
  });

  it('extracts a phone number (8-15 digits)', () => {
    const out = extractEntities('call +1 555-123-4567 now');
    expect(out.some((e) => e.type === 'phone' && e.normalizedValue === '15551234567')).toBe(true);
  });

  it('extracts an organization suffix pattern', () => {
    expect(extractEntities('works at Acme Corp')).toContainEqual({
      type: 'organization',
      value: 'Acme Corp',
      normalizedValue: 'acme corp',
    });
  });

  it('dedups identical entities by type+normalizedValue', () => {
    const out = extractEntities('@ghostexodus and @ghostexodus again');
    expect(out.filter((e) => e.type === 'mention')).toHaveLength(1);
  });

  it('returns [] for empty/undefined text, never throws', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities(undefined as unknown as string)).toEqual([]);
  });
});

// ---- computeNetworkAnalysis ---------------------------------------------

const NOW = '2026-08-11T00:00:00.000Z';

function profile(id: string, username: string, synthetic = false): AnalysisProfile {
  return { id, username, synthetic };
}

function rel(
  profileId: string,
  relationship: 'follower' | 'following',
  username: string,
  extra: Partial<AnalysisRelationship> = {},
): AnalysisRelationship {
  return { profileId, relationship, username, ...extra };
}

describe('computeNetworkAnalysis', () => {
  it('builds one identity per unique username across relationships, case-insensitively', () => {
    const profiles = [profile('p1', 'targetone')];
    const relationships = [
      rel('p1', 'follower', 'Shared_User'),
      rel('p1', 'following', 'shared_user'),
    ];
    const out = computeNetworkAnalysis(profiles, relationships, NOW);
    expect(out.identities).toHaveLength(1);
    expect(out.identities[0].followerOfProfileIds).toEqual(['p1']);
    expect(out.identities[0].followingFromProfileIds).toEqual(['p1']);
  });

  it('computes connectedTargets + overlapScore across two targets sharing a follower', () => {
    const profiles = [profile('p1', 'targetone'), profile('p2', 'targettwo')];
    const relationships = [
      rel('p1', 'follower', 'shared_user'),
      rel('p2', 'follower', 'shared_user'),
    ];
    const out = computeNetworkAnalysis(profiles, relationships, NOW);
    const shared = out.identities.find((i) => i.username.toLowerCase() === 'shared_user');
    expect(shared?.connectedTargets).toBe(2);
    expect(shared?.overlapScore).toBeGreaterThan(0);
  });

  it('computes pairwise commonFollowers/commonFollowing/commonAny between every profile pair', () => {
    const profiles = [profile('p1', 'targetone'), profile('p2', 'targettwo')];
    const relationships = [
      rel('p1', 'follower', 'shared_user'),
      rel('p2', 'follower', 'shared_user'),
      rel('p1', 'following', 'only_p1_following'),
    ];
    const out = computeNetworkAnalysis(profiles, relationships, NOW);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].commonFollowers).toEqual(['shared_user']);
    expect(out.pairs[0].commonFollowing).toEqual([]);
    expect(out.pairs[0].commonAny).toEqual(['shared_user']);
  });

  it('builds graph nodes for every target + every identity with connectedTargets >= 2, and edges only to those identities', () => {
    const profiles = [profile('p1', 'targetone'), profile('p2', 'targettwo')];
    const relationships = [
      rel('p1', 'follower', 'shared_user'),
      rel('p2', 'follower', 'shared_user'),
      rel('p1', 'following', 'lone_follow'),
    ];
    const out = computeNetworkAnalysis(profiles, relationships, NOW);
    const nodeIds = out.graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('target:p1');
    expect(nodeIds).toContain('target:p2');
    expect(nodeIds).toContain('identity:shared_user');
    expect(nodeIds).not.toContain('identity:lone_follow'); // connectedTargets===1, below the graph threshold
    expect(out.graph.edges.every((e) => e.target === 'identity:shared_user')).toBe(true);
  });

  it('uses the injected `now` verbatim for generatedAt (no internal clock read)', () => {
    const out = computeNetworkAnalysis([], [], NOW);
    expect(out.generatedAt).toBe(NOW);
  });

  it('is deterministic: identical input (including array order) yields byte-identical JSON output', () => {
    const profiles = [profile('p1', 'targetone'), profile('p2', 'targettwo')];
    const relationships = [rel('p1', 'follower', 'shared_user'), rel('p2', 'follower', 'shared_user')];
    const a = JSON.stringify(computeNetworkAnalysis(profiles, relationships, NOW));
    const b = JSON.stringify(computeNetworkAnalysis(profiles, relationships, NOW));
    expect(a).toBe(b);
  });

  describe('honesty: demo/synthetic exclusion', () => {
    it('excludes a synthetic profile and its relationships entirely from targetCount/graph', () => {
      const profiles = [profile('p1', 'targetone'), profile('demo1', 'demotarget', true)];
      const relationships = [
        rel('p1', 'follower', 'real_user'),
        rel('demo1', 'follower', 'demo_user'),
      ];
      const out = computeNetworkAnalysis(profiles, relationships, NOW);
      expect(out.targetCount).toBe(1);
      expect(out.identities.some((i) => i.username.toLowerCase() === 'demo_user')).toBe(false);
      expect(out.graph.nodes.some((n) => n.id === 'target:demo1')).toBe(false);
    });

    it('excludes a synthetic relationship even under a live (non-synthetic) profile', () => {
      const profiles = [profile('p1', 'targetone')];
      const relationships = [
        rel('p1', 'follower', 'real_user'),
        rel('p1', 'follower', 'demo_user', { synthetic: true }),
      ];
      const out = computeNetworkAnalysis(profiles, relationships, NOW);
      expect(out.relationshipCount).toBe(1);
      expect(out.identities.some((i) => i.username.toLowerCase() === 'demo_user')).toBe(false);
    });
  });
});

// ---- deriveCollectionHealth ----------------------------------------------

function run(overrides: Partial<XCollectionRun> = {}): XCollectionRun {
  return {
    profileId: 'p1',
    username: 'targetone',
    operation: 'posts',
    startedAt: '2026-08-01T00:00:00.000Z',
    added: 1,
    observed: 1,
    error: null,
    ...overrides,
  };
}

describe('deriveCollectionHealth', () => {
  it('reports HEALTHY for a profile whose latest run has no error and is not a plateau', () => {
    const out = deriveCollectionHealth([run()]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('HEALTHY');
    expect(out[0].profileId).toBe('p1');
  });

  it('reports ERROR when the latest run carries an error', () => {
    const out = deriveCollectionHealth([run({ error: 'rate limited' })]);
    expect(out[0].status).toBe('ERROR');
    expect(out[0].lastError).toBe('rate limited');
  });

  it('reports PLATEAU when the latest followers/following-family run observed>0 but added===0', () => {
    const out = deriveCollectionHealth([run({ operation: 'followers', added: 0, observed: 50 })]);
    expect(out[0].status).toBe('PLATEAU');
  });

  it('does NOT report PLATEAU for a posts-op run with added===0 (plateau is followers/following-family only)', () => {
    const out = deriveCollectionHealth([run({ operation: 'posts', added: 0, observed: 50 })]);
    expect(out[0].status).toBe('HEALTHY');
  });

  it('picks the most recent run by startedAt as lastRun/status source', () => {
    const older = run({ startedAt: '2026-08-01T00:00:00.000Z', error: 'stale error' });
    const newer = run({ startedAt: '2026-08-02T00:00:00.000Z', error: null });
    const out = deriveCollectionHealth([older, newer]);
    expect(out[0].status).toBe('HEALTHY');
    expect(out[0].lastRun!.startedAt).toBe('2026-08-02T00:00:00.000Z');
  });

  it('splits lastPostRun/lastFollowerRun/lastFollowingRun by operation family, falling back to the archive_* variant', () => {
    const runs = [
      run({ operation: 'archive_posts', startedAt: '2026-08-01T00:00:00.000Z' }),
      run({ operation: 'archive_followers', startedAt: '2026-08-01T01:00:00.000Z' }),
      run({ operation: 'following', startedAt: '2026-08-01T02:00:00.000Z' }),
    ];
    const out = deriveCollectionHealth(runs);
    expect(out[0].lastPostRun?.operation).toBe('archive_posts');
    expect(out[0].lastFollowerRun?.operation).toBe('archive_followers');
    expect(out[0].lastFollowingRun?.operation).toBe('following');
  });

  it('groups by distinct profileId — one health record per profile', () => {
    const out = deriveCollectionHealth([
      run({ profileId: 'p1' }),
      run({ profileId: 'p2', username: 'targettwo' }),
    ]);
    expect(out.map((h) => h.profileId).sort()).toEqual(['p1', 'p2']);
  });

  it('returns [] for no runs and no roster targets', () => {
    expect(deriveCollectionHealth([])).toEqual([]);
  });

  // ---- FB1: IDLE state + restored per-target counts --------------------

  it('reports IDLE for a roster target that has no runs at all', () => {
    const out = deriveCollectionHealth([], {
      targets: [{ profileId: 'p9', username: 'nevercollected' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('IDLE');
    expect(out[0].profileId).toBe('p9');
    expect(out[0].username).toBe('nevercollected');
    expect(out[0].lastRun).toBeNull();
    expect(out[0].lastError).toBeNull();
  });

  it('keeps a run-having roster target HEALTHY while a run-less one is IDLE (one record each)', () => {
    const out = deriveCollectionHealth([run({ profileId: 'p1', username: 'targetone' })], {
      targets: [
        { profileId: 'p1', username: 'targetone' },
        { profileId: 'p2', username: 'idletwo' },
      ],
    });
    const byId = Object.fromEntries(out.map((h) => [h.profileId, h.status]));
    expect(byId).toEqual({ p1: 'HEALTHY', p2: 'IDLE' });
  });

  it('restores postCount/followerCount/followingCount/oldestPostAt from posts + relationships', () => {
    const out = deriveCollectionHealth([run({ profileId: 'p1', username: 'targetone' })], {
      targets: [{ profileId: 'p1', username: 'targetone' }],
      posts: [
        { profileId: 'p1', createdAt: '2026-08-03T00:00:00.000Z' },
        { profileId: 'p1', createdAt: '2026-08-01T00:00:00.000Z' },
        { profileId: 'other', createdAt: '2020-01-01T00:00:00.000Z' },
      ],
      relationships: [
        { profileId: 'p1', relationship: 'follower' },
        { profileId: 'p1', relationship: 'follower' },
        { profileId: 'p1', relationship: 'following' },
        { profileId: 'other', relationship: 'follower' },
      ],
    });
    expect(out[0].postCount).toBe(2);
    expect(out[0].followerCount).toBe(2);
    expect(out[0].followingCount).toBe(1);
    // oldest = min publishedAt across THIS target's posts only (not `other`'s 2020 row)
    expect(out[0].oldestPostAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('an IDLE target still reports its counts (posts/networks captured, no run recorded)', () => {
    const out = deriveCollectionHealth([], {
      targets: [{ profileId: 'p1', username: 'targetone' }],
      posts: [{ profileId: 'p1', createdAt: '2026-08-01T00:00:00.000Z' }],
      relationships: [{ profileId: 'p1', relationship: 'follower' }],
    });
    expect(out[0].status).toBe('IDLE');
    expect(out[0].postCount).toBe(1);
    expect(out[0].followerCount).toBe(1);
    expect(out[0].oldestPostAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('defaults the 4 counts to 0/null when no posts/relationships supplied', () => {
    const out = deriveCollectionHealth([run()]);
    expect(out[0].postCount).toBe(0);
    expect(out[0].followerCount).toBe(0);
    expect(out[0].followingCount).toBe(0);
    expect(out[0].oldestPostAt).toBeNull();
  });
});

// ---- FB1: runLogRecordToRun (ERROR keyed off status, not a nonexistent `error` field) ----

function runLog(overrides: Partial<XRunLogRecord> = {}): XRunLogRecord {
  return {
    profileId: 'p1',
    username: 'targetone',
    operation: 'posts',
    observed: 3,
    added: 1,
    duplicates: 2,
    requestedPasses: 1,
    completedPasses: 2,
    reachedEnd: true,
    stopReason: 'complete',
    status: 'complete',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T00:01:00.000Z',
    ...overrides,
  };
}

describe('runLogRecordToRun', () => {
  it('maps a complete run to error:null (a healthy run must not be flagged ERROR)', () => {
    const r = runLogRecordToRun(runLog({ status: 'complete' }));
    expect(r.error).toBeNull();
    expect(r.added).toBe(1);
    expect(r.observed).toBe(3);
    expect(r.operation).toBe('posts');
    expect(r.startedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('keys ERROR off status==="error" (XRunLogRecord has no `error` field) and carries stopReason', () => {
    const r = runLogRecordToRun(runLog({ status: 'error', stopReason: 'rate limited' }));
    expect(r.error).toBe('rate limited');
    // and that error surfaces as ERROR through deriveCollectionHealth
    const out = deriveCollectionHealth([r]);
    expect(out[0].status).toBe('ERROR');
    expect(out[0].lastError).toBe('rate limited');
  });

  it('falls back to a generic "error" message when an error run has no stopReason', () => {
    const r = runLogRecordToRun(runLog({ status: 'error', stopReason: '' }));
    expect(r.error).toBe('error');
  });
});

// ---- Task 7: flattenNetworkArtifacts ------------------------------------

describe('flattenNetworkArtifacts', () => {
  const artifacts: XNetworkArtifact[] = [
    {
      target: '@target',
      kind: 'followers',
      capturedAt: '2026-08-11T00:00:00.000Z',
      accounts: [
        {
          handle: '@alice',
          displayName: 'Alice',
          bio: 'analyst',
          evidenceHash: 'ev-1',
          firstObservedAt: '2026-08-10T00:00:00.000Z',
          lastObservedAt: '2026-08-11T00:00:00.000Z',
        },
      ],
    },
    {
      target: '@target',
      kind: 'following',
      capturedAt: '2026-08-11T00:00:00.000Z',
      accounts: [
        { handle: '@carol', evidenceHash: 'ev-2', firstObservedAt: 't1', lastObservedAt: 't1' },
        { handle: '@demoacct', evidenceHash: 'ev-3', firstObservedAt: 't1', lastObservedAt: 't1', synthetic: true },
      ],
    },
  ];

  it('produces one profile per target and maps kind followers/following -> relationship follower/following', () => {
    const { profiles, relationships } = flattenNetworkArtifacts(artifacts);
    expect(profiles).toEqual([{ id: '@target', username: '@target' }]);
    expect(relationships.find((r) => r.username === '@alice')!.relationship).toBe('follower');
    expect(relationships.find((r) => r.username === '@carol')!.relationship).toBe('following');
  });

  it('propagates firstObservedAt/lastObservedAt onto each relationship row', () => {
    const { relationships } = flattenNetworkArtifacts(artifacts);
    const alice = relationships.find((r) => r.username === '@alice')!;
    expect(alice.firstObservedAt).toBe('2026-08-10T00:00:00.000Z');
    expect(alice.lastObservedAt).toBe('2026-08-11T00:00:00.000Z');
  });

  it('propagates synthetic so a demo account is excluded by computeNetworkAnalysis even without pre-filtering', () => {
    const { profiles, relationships } = flattenNetworkArtifacts(artifacts);
    const demo = relationships.find((r) => r.username === '@demoacct')!;
    expect(demo.synthetic).toBe(true);
    const out = computeNetworkAnalysis(profiles, relationships, '2026-08-11T00:00:00.000Z');
    expect(out.identities.map((i) => i.username)).not.toContain('@demoacct');
    expect(out.identities.map((i) => i.username).sort()).toEqual(['@alice', '@carol']);
  });

  it('returns empty profiles/relationships for no artifacts (honest, not hollow)', () => {
    expect(flattenNetworkArtifacts([])).toEqual({ profiles: [], relationships: [] });
  });
});
