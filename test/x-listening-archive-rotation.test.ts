/**
 * X Listening Station — FA4: incremental-archive DEPTH ROTATION (audit HIGH #2 + #5,
 * + the archive-rotation medium).
 *
 * Pins `runArchiveRotation` (src/main/x-listening/archive.ts), the Enterprise `runArchiveCycle`
 * (`electron/main.cjs:1961-2056`) rebuilt on the hardened seams:
 *
 *  - Each tick runs exactly ONE round-robin operation (posts/follower/following of a SINGLE source),
 *    not every source at once — light per-tick load (`main.cjs:1966-1968,2041`).
 *  - The selected operation steps its source's per-profile pass depth one increment toward its
 *    ceiling (`postDepthPerCycle`→`maxPostDepth`, `networkDepthPerCycle`→`maxNetworkDepth`) and drives
 *    the matching Tor-gated capture at that depth (posts → FA1's `req.passes`).
 *  - `archiveFollowers`/`archiveFollowing` add follower/following ops (`buildArchiveOperations`).
 *  - Per-source depth counters + the round-robin pointer persist in `XArchiveState`; a blocked op
 *    advances NEITHER (an incomplete op must never look completed). Deterministic (injected clock).
 *
 * `archive.ts` is quarantine-clean at module load (no static electron import), so this file needs no
 * `vi.mock('electron', …)` — the capture seams are injected.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  DEFAULT_COLLECTION_SETTINGS,
  type XCollectionSettings,
} from '../src/shared/x-listening-collection-settings';
import type { XArchiveState } from '../src/main/x-listening/store';
import type {
  ArchiveOpOutcome,
  XArchiveRotationDeps,
  XArchiveRotationSource,
} from '../src/main/x-listening/archive';

const A: XArchiveRotationSource = { channelId: 'alice', channelLabel: '@alice', targetUsername: 'alice' };
const B: XArchiveRotationSource = { channelId: 'bob', channelLabel: '@bob', targetUsername: 'bob' };

function settings(over: Partial<XCollectionSettings> = {}): XCollectionSettings {
  return { ...DEFAULT_COLLECTION_SETTINGS, ...over };
}

/** A tiny in-memory archive-state store backing readState/writeState. */
function memState(seed?: XArchiveState) {
  const map = new Map<string, XArchiveState>();
  if (seed) map.set('case-a', seed);
  return {
    map,
    readState: async (caseId: string) => map.get(caseId) ?? null,
    writeState: async (caseId: string, state: XArchiveState) => {
      map.set(caseId, state);
    },
  };
}

const OK: ArchiveOpOutcome = { blocked: false, added: 1, posts: [] };

/** Build rotation deps around a memState with spyable capture seams (default: both succeed). */
function deps(
  store: ReturnType<typeof memState>,
  over: Partial<XArchiveRotationDeps> = {},
): Partial<XArchiveRotationDeps> {
  return {
    readState: store.readState,
    writeState: store.writeState,
    capturePosts: vi.fn(async () => OK),
    captureRelationship: vi.fn(async () => OK),
    now: () => '2026-08-14T12:00:00.000Z',
    ...over,
  };
}

const req = (sources: XArchiveRotationSource[], s: XCollectionSettings) => ({
  caseId: 'case-a',
  jobId: 'job-1',
  sources,
  settings: s,
});

describe('buildArchiveOperations: round-robin operation list', () => {
  it('emits {posts} always, {follower} iff archiveFollowers, {following} iff archiveFollowing', async () => {
    const { buildArchiveOperations } = await import('../src/main/x-listening/archive');
    expect(buildArchiveOperations([A], settings({ archiveFollowers: false, archiveFollowing: false })).map((o) => o.type)).toEqual(['posts']);
    expect(buildArchiveOperations([A], settings({ archiveFollowers: true, archiveFollowing: false })).map((o) => o.type)).toEqual(['posts', 'follower']);
    expect(buildArchiveOperations([A], settings({ archiveFollowers: true, archiveFollowing: true })).map((o) => o.type)).toEqual(['posts', 'follower', 'following']);
    // source-major ordering across multiple sources
    const ops = buildArchiveOperations([A, B], settings({ archiveFollowers: true, archiveFollowing: false }));
    expect(ops.map((o) => `${o.source.targetUsername}:${o.type}`)).toEqual(['alice:posts', 'alice:follower', 'bob:posts', 'bob:follower']);
  });
});

describe('stepPostDepth / stepNetworkDepth: pure depth stepping (Enterprise formulas)', () => {
  it('post depth grows by postDepthPerCycle and clamps at maxPostDepth', async () => {
    const { stepPostDepth } = await import('../src/main/x-listening/archive');
    const s = settings({ profileScrollPasses: 5, postDepthPerCycle: 2, maxPostDepth: 10 });
    expect(stepPostDepth(5, s)).toBe(7); // 5→7
    expect(stepPostDepth(7, s)).toBe(9); // 7→9
    expect(stepPostDepth(9, s)).toBe(10); // 9→11 clamped to 10
    expect(stepPostDepth(10, s)).toBe(10); // held at the ceiling
    // never below the base budget
    expect(stepPostDepth(0, s)).toBe(5);
  });

  it('network depth grows by networkDepthPerCycle and clamps at maxNetworkDepth', async () => {
    const { stepNetworkDepth } = await import('../src/main/x-listening/archive');
    const s = settings({ followerBasePasses: 8, networkDepthPerCycle: 3, maxNetworkDepth: 12 });
    expect(stepNetworkDepth(8, s, 'follower')).toBe(11); // 8→11
    expect(stepNetworkDepth(11, s, 'follower')).toBe(12); // 11→14 clamped to 12
    expect(stepNetworkDepth(12, s, 'follower')).toBe(12); // held
  });
});

describe('runArchiveRotation: successive steps deepen the post-pass depth (audit HIGH #2)', () => {
  it('drives captureTimeline at an increasing, clamped depth and persists the per-profile counter', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState();
    const passesSeen: number[] = [];
    const d = deps(store, {
      capturePosts: vi.fn(async (_source, passes) => {
        passesSeen.push(passes);
        return OK;
      }),
    });
    const s = settings({ profileScrollPasses: 5, postDepthPerCycle: 2, maxPostDepth: 10, archiveFollowers: false, archiveFollowing: false });

    for (let i = 0; i < 4; i++) {
      const res = await runArchiveRotation(req([A], s), d);
      expect(res.ran).toBe(true);
      expect(res.operation?.type).toBe('posts');
    }
    // 5 → 7 → 9 → 10 (clamped) → 10 (held)
    expect(passesSeen).toEqual([7, 9, 10, 10]);
    // the persisted per-profile counter reached and held the ceiling
    expect(store.map.get('case-a')?.profiles?.alice?.postPasses).toBe(10);
    expect(store.map.get('case-a')?.profiles?.alice?.lastPostRunAt).toBe('2026-08-14T12:00:00.000Z');
    // captureRelationship never touched with both toggles off
    expect(d.captureRelationship).not.toHaveBeenCalled();
    expect(store.map.get('case-a')?.cycles).toBe(4);
  });
});

describe('runArchiveRotation: archiveFollowers adds a follower op (audit HIGH #5)', () => {
  it('the second round-robin tick runs a follower capture stepping networkDepthPerCycle', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState();
    const relCalls: { kind: string; passes: number; target: string }[] = [];
    const d = deps(store, {
      captureRelationship: vi.fn(async (source, kind, passes) => {
        relCalls.push({ kind, passes, target: source.targetUsername });
        return OK;
      }),
    });
    const s = settings({
      archiveFollowers: true,
      archiveFollowing: false,
      followerBasePasses: 8,
      networkDepthPerCycle: 3,
      maxNetworkDepth: 160,
    });

    // Tick 1: index 0 → posts op (no follower capture yet).
    const t1 = await runArchiveRotation(req([A], s), d);
    expect(t1.operation?.type).toBe('posts');
    expect(d.captureRelationship).not.toHaveBeenCalled();
    expect(store.map.get('case-a')?.nextOperationIndex).toBe(1);

    // Tick 2: index 1 → follower op, stepped 8 → 11.
    const t2 = await runArchiveRotation(req([A], s), d);
    expect(t2.operation?.type).toBe('follower');
    expect(t2.requestedPasses).toBe(11);
    expect(relCalls).toEqual([{ kind: 'follower', passes: 11, target: 'alice' }]);
    expect(store.map.get('case-a')?.profiles?.alice?.followerPasses).toBe(11);
    // 2 ops for one source → pointer wraps back to 0
    expect(store.map.get('case-a')?.nextOperationIndex).toBe(0);
  });
});

describe('runArchiveRotation: one operation per tick (round-robin, archive-rotation medium)', () => {
  it('advances exactly one op per tick across sources and wraps', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState();
    let postCalls = 0;
    let relCalls = 0;
    const d = deps(store, {
      capturePosts: vi.fn(async () => {
        postCalls++;
        return OK;
      }),
      captureRelationship: vi.fn(async () => {
        relCalls++;
        return OK;
      }),
    });
    const s = settings({ archiveFollowers: true, archiveFollowing: false });
    // ops = [alice:posts, alice:follower, bob:posts, bob:follower]

    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
      const before = postCalls + relCalls;
      const res = await runArchiveRotation(req([A, B], s), d);
      // exactly ONE capture ran this tick
      expect(postCalls + relCalls).toBe(before + 1);
      seq.push(`${res.operation?.source.targetUsername}:${res.operation?.type}`);
    }
    expect(seq).toEqual(['alice:posts', 'alice:follower', 'bob:posts', 'bob:follower', 'alice:posts']);
    // pointer landed at 1 after the 5th tick (wrapped once)
    expect(store.map.get('case-a')?.nextOperationIndex).toBe(1);
  });
});

describe('runArchiveRotation: fail-closed + edges', () => {
  it('a blocked op advances NEITHER the pointer NOR the depth', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState();
    const s = settings({ archiveFollowers: true, archiveFollowing: false });
    // Tick 1: posts completes → pointer to 1.
    await runArchiveRotation(req([A], s), deps(store));
    expect(store.map.get('case-a')?.nextOperationIndex).toBe(1);
    const snapshot = JSON.stringify(store.map.get('case-a'));

    // Tick 2: follower op is blocked → nothing advances.
    const blocked = await runArchiveRotation(
      req([A], s),
      deps(store, { captureRelationship: vi.fn(async () => ({ blocked: true, reason: 'Tor down', added: 0, posts: [] })) }),
    );
    expect(blocked.ran).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toMatch(/tor/i);
    // state byte-identical to before the blocked op (pointer stays 1, followerPasses unchanged)
    expect(JSON.stringify(store.map.get('case-a'))).toBe(snapshot);
    expect(store.map.get('case-a')?.nextOperationIndex).toBe(1);
  });

  it('no sources → no-op tick, nothing captured', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState();
    const d = deps(store);
    const res = await runArchiveRotation(req([], settings()), d);
    expect(res.ran).toBe(false);
    expect(res.operation).toBeNull();
    expect(d.capturePosts).not.toHaveBeenCalled();
    expect(d.captureRelationship).not.toHaveBeenCalled();
    expect(store.map.size).toBe(0);
  });

  it('heals a legacy {cursor,cycles,lastRunAt} state (no profiles/index) without throwing', async () => {
    const { runArchiveRotation } = await import('../src/main/x-listening/archive');
    const store = memState({ cursor: '50', cycles: 3, lastRunAt: '2026-08-10T00:00:00.000Z' } as XArchiveState);
    const s = settings({ profileScrollPasses: 5, postDepthPerCycle: 2, maxPostDepth: 40 });
    const res = await runArchiveRotation(req([A], s), deps(store));
    expect(res.ran).toBe(true);
    expect(res.requestedPasses).toBe(7); // seeded from base 5, stepped +2
    const persisted = store.map.get('case-a');
    expect(persisted?.cycles).toBe(4); // built on the legacy count
    expect(persisted?.profiles?.alice?.postPasses).toBe(7);
    expect(persisted?.nextOperationIndex).toBe(0);
  });
});

describe('captureProfileTimeline forwards the FA4 passes override into FA1 (capture.ts wiring)', () => {
  it('threads req.passes into the timeline capture request; absent ⇒ undefined', async () => {
    const { captureProfileTimeline } = await import('../src/main/x-listening/capture');
    const seenReqs: Array<number | undefined> = [];
    const base = {
      loadClearnetEnabled: async () => false,
      resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9050' } }),
      openWindow: async () =>
        ({ webContents: { setWebRTCIPHandlingPolicy() {} }, isDestroyed: () => false, destroy() {} }) as never,
      capture: async (_win: unknown, r: { passes?: number }) => {
        seenReqs.push(r.passes);
        return { blocked: false, added: 0, skipped: 0, posts: [] };
      },
    };
    await captureProfileTimeline({ caseId: 'c', channelId: 'alice', channelLabel: '@alice', targetUsername: 'alice', passes: 9 }, base as never);
    await captureProfileTimeline({ caseId: 'c', channelId: 'alice', channelLabel: '@alice', targetUsername: 'alice' }, base as never);
    expect(seenReqs).toEqual([9, undefined]);
  });
});
