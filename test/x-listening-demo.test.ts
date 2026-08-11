/**
 * X Listening Station Enterprise port — Task 12: demo data with honesty markers.
 *
 * `buildDemoData`/`loadDemoData` (demo.ts) adapt quarantine `loadDemoData`
 * (`electron/main.cjs:2519-2610`): every demo post AND every demo follower/following
 * relationship must carry `synthetic: true`, and that flag must actually work end to end —
 * `computeNetworkAnalysis` (analysis.ts) must never surface a demo-only identity, and
 * `exportXPostsToFile` (exports.ts) must never write, count, or hash a demo post. Those two
 * consumers' OWN filtering logic is already unit-tested elsewhere (x-listening-analysis.test.ts,
 * x-listening-exports.test.ts); this suite proves demo.ts's actual output is what triggers that
 * filtering — a demo.ts that forgot to set `synthetic` would sail through those consumers'
 * tests untouched but leak here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildDemoData,
  loadDemoData,
  DEMO_PROFILES,
  DEMO_COLLECTOR_VERSION,
} from '../src/main/x-listening/demo';
import { computeNetworkAnalysis, flattenNetworkArtifacts } from '../src/main/x-listening/analysis';
import { exportXPostsToFile } from '../src/main/x-listening/exports';
import type { XPostArtifact, XNetworkArtifact } from '../src/main/x-listening/store';

const CASE_ID = 'case-demo-1';
const JOB_ID = 'job-demo-1';
const NOW = '2026-08-11T12:00:00.000Z';

describe('buildDemoData', () => {
  it('marks EVERY demo post synthetic:true', () => {
    const { posts } = buildDemoData(CASE_ID, JOB_ID, NOW);
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.synthetic).toBe(true);
    }
  });

  it('marks EVERY demo network account (both followers and following artifacts) synthetic:true', () => {
    const { networks } = buildDemoData(CASE_ID, JOB_ID, NOW);
    expect(networks.length).toBeGreaterThan(0);
    for (const artifact of networks) {
      expect(artifact.accounts.length).toBeGreaterThan(0);
      for (const account of artifact.accounts) {
        expect(account.synthetic).toBe(true);
      }
    }
  });

  it('produces one followers artifact and one following artifact per seeded demo profile', () => {
    const { networks } = buildDemoData(CASE_ID, JOB_ID, NOW);
    for (const profile of DEMO_PROFILES) {
      const target = `@${profile.username}`;
      expect(networks.some((a) => a.target === target && a.kind === 'followers')).toBe(true);
      expect(networks.some((a) => a.target === target && a.kind === 'following')).toBe(true);
    }
  });

  it('stamps a distinct demo collector version on every post, never the real one', () => {
    const { posts } = buildDemoData(CASE_ID, JOB_ID, NOW);
    for (const post of posts) {
      expect(post.provenance.collectorVersion).toBe(DEMO_COLLECTOR_VERSION);
      expect(post.provenance.collectorVersion).not.toBe('x-listening/1.0.0');
    }
  });

  it('is a pure function of (caseId, jobId, now) — byte-identical output on repeat calls', () => {
    const a = buildDemoData(CASE_ID, JOB_ID, NOW);
    const b = buildDemoData(CASE_ID, JOB_ID, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('builds valid, well-formed XPostArtifact records (real evidence-hashed, non-empty text/url)', () => {
    const { posts } = buildDemoData(CASE_ID, JOB_ID, NOW);
    for (const post of posts) {
      expect(post.text.length).toBeGreaterThan(0);
      expect(post.url.startsWith('https://x.com/')).toBe(true);
      expect(post.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(post.provenance.caseId).toBe(CASE_ID);
    }
  });

  it('caps a demo network handle to the visible 1-15 char handle shape', () => {
    const { networks } = buildDemoData(CASE_ID, JOB_ID, NOW);
    for (const artifact of networks) {
      for (const account of artifact.accounts) {
        // handle is "@" + up to 15 chars
        expect(account.handle.length).toBeLessThanOrEqual(16);
        expect(account.handle).toMatch(/^@[A-Za-z0-9_]{1,15}$/);
      }
    }
  });
});

describe('honesty: demo data excluded from computeNetworkAnalysis', () => {
  it('a demo-only case produces zero targets/identities — nothing leaks into "real" analysis', () => {
    const { networks } = buildDemoData(CASE_ID, JOB_ID, NOW);
    const { profiles, relationships } = flattenNetworkArtifacts(networks);
    const analysis = computeNetworkAnalysis(profiles, relationships, NOW);
    expect(analysis.targetCount).toBe(0);
    expect(analysis.relationshipCount).toBe(0);
    expect(analysis.identities).toEqual([]);
    expect(analysis.graph.nodes).toEqual([]);
    expect(analysis.graph.edges).toEqual([]);
  });

  it('mixed real + demo networks: analysis reflects ONLY the real target, no demo identity', () => {
    const { networks: demoNetworks } = buildDemoData(CASE_ID, JOB_ID, NOW);
    const realNetwork: XNetworkArtifact = {
      target: '@realtarget',
      kind: 'followers',
      capturedAt: NOW,
      accounts: [
        {
          handle: '@realfollower',
          displayName: 'Real Follower',
          evidenceHash: 'ev-real',
          firstObservedAt: NOW,
          lastObservedAt: NOW,
        },
      ],
    };
    const { profiles, relationships } = flattenNetworkArtifacts([realNetwork, ...demoNetworks]);
    const analysis = computeNetworkAnalysis(profiles, relationships, NOW);

    expect(analysis.targetCount).toBe(1);
    expect(analysis.relationshipCount).toBe(1);
    expect(analysis.identities.map((i) => i.username)).toEqual(['@realfollower']);
    // none of the demo handles (e.g. @SignalWatchObserver-capped, @OpenSourceDeskSource…)
    // ever surface as an identity
    for (const artifact of demoNetworks) {
      for (const account of artifact.accounts) {
        expect(analysis.identities.some((i) => i.username === account.handle)).toBe(false);
      }
    }
    expect(analysis.graph.nodes.map((n) => n.username)).toEqual(['@realtarget']);
  });
});

function realPost(over: Partial<XPostArtifact> = {}): XPostArtifact {
  return {
    id: 'real-1',
    platform: 'x',
    authorHandle: '@alice',
    authorId: 'alice',
    text: 'genuine collected intel',
    channelId: 'alice',
    channelLabel: '@alice',
    messageId: '9001',
    publishedAt: '2026-08-01T00:00:00.000Z',
    harvestedAt: '2026-08-06T12:00:00.000Z',
    url: 'https://x.com/alice/status/9001',
    provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: CASE_ID },
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
    metricsRaw: { replies: '1', reposts: '2', likes: '3', views: '4' },
    evidenceHash: 'real-evidence-hash',
    ...over,
  };
}

describe('honesty: demo posts excluded from exports and their SHA-256 hash', () => {
  it('a mixed real + demo case export contains only the real post, hashed over real-only bytes', async () => {
    const { posts: demoPosts } = buildDemoData(CASE_ID, JOB_ID, NOW);
    const readPosts = vi.fn(async () => [realPost(), ...demoPosts]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile(CASE_ID, 'json', '/exports/demo-mixed.json', {
      readPosts,
      writeFile,
    });

    // exactly the one real post survived
    expect(res.count).toBe(1);
    const fileData = String(written.get('/exports/demo-mixed.json'));
    expect(fileData).toContain('genuine collected intel');
    for (const demoPost of demoPosts) {
      expect(fileData).not.toContain(demoPost.text);
      expect(fileData).not.toContain(demoPost.id);
    }

    // the checksum is a hash of the REAL-ONLY export bytes — no demo content was ever
    // folded into anything "evidence" hashes
    const expectedDigest = createHash('sha256').update(fileData, 'utf8').digest('hex');
    expect(res.sha256).toBe(expectedDigest);

    // and independently: hashing JUST the real post's own JSON matches what got written
    const realOnlyJson = JSON.stringify([realPost()], null, 2);
    expect(fileData).toBe(realOnlyJson);
  });

  it('a demo-only case exports zero records — nothing to hash, nothing written but an empty array', async () => {
    const { posts: demoPosts } = buildDemoData(CASE_ID, JOB_ID, NOW);
    const readPosts = vi.fn(async () => demoPosts);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile(CASE_ID, 'json', '/exports/demo-only.json', {
      readPosts,
      writeFile,
    });

    expect(res.count).toBe(0);
    expect(String(written.get('/exports/demo-only.json'))).toBe('[]');
  });
});

describe('loadDemoData', () => {
  it('persists the built demo posts via savePosts and each network artifact via saveNetwork', async () => {
    const savedPosts: Array<{ caseId: string; posts: XPostArtifact[] }> = [];
    const savedNetworks: Array<{ caseId: string; artifact: XNetworkArtifact }> = [];
    const savePosts = vi.fn(async (caseId: string, posts: XPostArtifact[]) => {
      savedPosts.push({ caseId, posts });
      return { added: posts.length, skipped: 0 };
    });
    const saveNetwork = vi.fn(async (caseId: string, artifact: XNetworkArtifact) => {
      savedNetworks.push({ caseId, artifact });
      return 1;
    });

    const result = await loadDemoData(CASE_ID, JOB_ID, {
      savePosts,
      saveNetwork,
      now: () => NOW,
    });

    expect(savePosts).toHaveBeenCalledTimes(1);
    expect(savedPosts[0]!.caseId).toBe(CASE_ID);
    expect(savedPosts[0]!.posts.every((p) => p.synthetic === true)).toBe(true);

    // one saveNetwork call per built artifact (2 profiles x followers+following = 4)
    expect(saveNetwork).toHaveBeenCalledTimes(savedNetworks.length);
    expect(savedNetworks.length).toBe(result.networks.length);
    for (const { caseId, artifact } of savedNetworks) {
      expect(caseId).toBe(CASE_ID);
      expect(artifact.accounts.every((a) => a.synthetic === true)).toBe(true);
    }

    expect(result.added).toBe(result.posts.length);
    expect(result.skipped).toBe(0);
  });

  it('defaults jobId to caseId when omitted', async () => {
    let seenJobId: string | undefined;
    const savePosts = vi.fn(async (_caseId: string, posts: XPostArtifact[]) => {
      seenJobId = posts[0]?.provenance.jobId;
      return { added: posts.length, skipped: 0 };
    });
    const saveNetwork = vi.fn(async () => 1);

    await loadDemoData(CASE_ID, undefined, { savePosts, saveNetwork, now: () => NOW });
    expect(seenJobId).toBe(CASE_ID);
  });
});
