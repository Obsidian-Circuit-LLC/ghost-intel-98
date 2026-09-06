// @vitest-environment node
/**
 * Live collection must write the RICH artifact into his document.
 *
 * THE BUG THIS EXISTS TO CATCH. `captureTimeline` persists through TWO injectable seams:
 *   - `savePosts(caseId, XPostArtifact[])` — kind, metrics, avatar, mediaRefs, evidence hash
 *   - `saveItems(caseId, HarvestedItem[])` — a thin sidecar with none of that
 *
 * v3.73.0–v3.74.2 injected only `saveItems`. So his document received stripped posts with no
 * avatar and no media, while the rich copies went to the OLD store where his station never looks.
 * Fresh collection therefore produced no pictures at all — and because the pre-embed data had been
 * migrated correctly, everything looked fine until GhostExodus purged and re-scraped:
 *
 *   "It may be that it's not scraping at all, but was merely displaying archived or cached scrapes
 *    from previous beta tests. I just purged it all, and noticed it's not scraping."
 *
 * Nothing caught it because every existing test drove the pure document functions directly; none
 * exercised which seam the IPC layer actually wires into capture.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const captureTimeline = vi.fn();

vi.mock('../src/main/x-listening/capture', () => ({
  captureTimeline: (...args: unknown[]) => captureTimeline(...args),
  captureNetwork: vi.fn(),
  openInX: vi.fn(),
  verifyPost: vi.fn(),
}));
/** Models the real trap: the auth cookie persists, so "connected" can be true with NO window. */
const sessionState = { window: null as unknown, connectCalls: [] as unknown[][] };
vi.mock('../src/main/x-listening/session', () => ({
  connectXSession: vi.fn(async (...args: unknown[]) => {
    sessionState.connectCalls.push(args);
    sessionState.window = { id: 'opened-window' };
    return { blocked: false };
  }),
  getXStatus: vi.fn(),
  clearXSession: vi.fn(),
  resolveXTorGate: () => ({ blocked: false }),
  getXWindow: () => sessionState.window,
  navigateXToProfile: vi.fn(async () => ({ blocked: false })),
}));
vi.mock('../src/main/x-listening/collection-lock', () => ({
  withQueuedCollectionLock: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/main/x-listening/ipc', () => ({ loadClearnetEnabled: async () => false }));
vi.mock('../src/main/x-listening/media', () => ({ readCachedMedia: vi.fn(), cacheRemoteMedia: vi.fn() }));
vi.mock('../src/main/capture/capture-window', () => ({ assertTrustedSender: () => undefined }));

import { registerXlsEmbedIpc } from '../src/main/xls-embed/ipc';
import { makeStationStore } from '../src/main/xls-embed/state-store';
import { XLS_CHANNELS } from '../src/shared/xls/channels';

/** The rich artifact a real capture produces — the shape that actually has pictures in it. */
const ARTIFACT = {
  id: 'post-1',
  channelId: 'darkwebtoday',
  authorHandle: 'darkwebtoday',
  displayName: 'Dark Web Today',
  avatar: 'https://pbs.twimg.com/profile_images/9/z.jpg',
  text: 'fresh capture',
  url: 'https://x.com/darkwebtoday/status/9',
  publishedAt: '2026-08-29T10:00:00.000Z',
  harvestedAt: '2026-08-29T10:05:00.000Z',
  kind: 'post',
  parentPostId: null,
  metrics: { replies: 1, reposts: 0, likes: 5, views: 50 },
  evidenceHash: 'hash-1',
  mediaRefs: ['x-media/' + 'd'.repeat(64)],
};

function harness() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  let seq = 0;
  const files = new Map<string, string>();
  const store = makeStationStore({
    readFile: async (p: string) => {
      const v = files.get(p);
      if (!v) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return Buffer.from(v, 'utf8');
    },
    writeFile: async (p: string, d: string) => { files.set(p, d); },
    statePath: () => '/vault/station.json',
    now: () => '2026-08-29T12:00:00.000Z',
    makeId: () => `id-${++seq}`,
  });
  registerXlsEmbedIpc({
    handle: (channel: string, fn: never) => handlers.set(channel, fn),
    getWindow: () => null,
    store,
    ctx: { now: () => '2026-08-29T12:00:00.000Z', makeId: () => `id-${++seq}` },
  } as never);
  return { handlers, store };
}

describe('live collection writes the rich artifact into his document', () => {
  beforeEach(() => {
    captureTimeline.mockReset();
    sessionState.window = { id: 'win' };
    sessionState.connectCalls = [];
  });

  it('injects savePosts — the seam that carries avatar and media', async () => {
    let seen: Record<string, unknown> | undefined;
    captureTimeline.mockImplementation(async (...args: unknown[]) => {
      seen = (args[2] ?? {}) as Record<string, unknown>;
      const o = seen as { savePosts?: Function };
      if (typeof o.savePosts === 'function') await o.savePosts('case', [ARTIFACT]);
      return { blocked: false, added: 1, skipped: 0, posts: [ARTIFACT] };
    });

    const { handlers, store } = harness();
    await (handlers.get(XLS_CHANNELS.addProfile) as never as Function)({}, 'darkwebtoday');
    const state = await store.load();
    const profileId = state.profiles[0].id;

    await (handlers.get(XLS_CHANNELS.refreshProfile) as never as Function)({}, profileId);

    // The decisive assertion: the RICH seam must be wired.
    expect(seen && typeof seen.savePosts, 'savePosts must be injected').toBe('function');

    const post = (await store.load()).posts[0];
    expect(post, 'the captured post landed in his document').toBeTruthy();
    // The two fields that make pictures possible, and were missing from the thin sidecar.
    expect(post.avatar).toBe('https://pbs.twimg.com/profile_images/9/z.jpg');
    expect(post.media).toEqual(['x-media/' + 'd'.repeat(64)]);
    // …plus the rest of the rich shape his UI renders.
    expect(post.kind).toBe('post');
    expect(post.metrics).toEqual({ replies: 1, reposts: 0, likes: 5, views: 50 });
    expect(post.evidenceHash).toBe('hash-1');
  });

  it('neutralises the thin sidecar so it cannot write a second copy elsewhere', async () => {
    let seen: Record<string, unknown> | undefined;
    captureTimeline.mockImplementation(async (...args: unknown[]) => {
      seen = (args[2] ?? {}) as Record<string, unknown>;
      return { blocked: false, added: 0, skipped: 0, posts: [] };
    });

    const { handlers, store } = harness();
    await (handlers.get(XLS_CHANNELS.addProfile) as never as Function)({}, 'darkwebtoday');
    const profileId = (await store.load()).profiles[0].id;
    await (handlers.get(XLS_CHANNELS.refreshProfile) as never as Function)({}, profileId);

    // Still supplied, so capture's own bookkeeping works — but it must persist nothing. The default
    // would write a second, thinner copy into the OLD store, which nothing in the embed reads.
    expect(typeof seen?.saveItems).toBe('function');
    const result = await (seen!.saveItems as Function)('case', [ARTIFACT]);
    expect(result).toEqual({ added: 0, skipped: 0 });
  });

  it('OPENS a capture window when the cookie says connected but none exists', async () => {
    // THE TRAP, already hit once in v3.71.1 and recorded as "signed in (cookie) != ready to capture
    // (window)". The auth cookie is case-independent and persists, so the UI reads SESSION
    // CONNECTED after a restart while this campaign has no live window. The embed threw
    // "Connect to X before collecting", refreshAll swallowed it per-target, and the sweep still
    // reported "Collection sweep complete" having collected nothing — exactly what the field video
    // shows: 0 posts, 0 findings, no error anywhere the analyst could see.
    sessionState.window = null;
    captureTimeline.mockImplementation(async (...args: unknown[]) => {
      const o = (args[2] ?? {}) as { savePosts?: Function };
      if (typeof o.savePosts === 'function') await o.savePosts('case', [ARTIFACT]);
      return { blocked: false, added: 1, skipped: 0, posts: [ARTIFACT] };
    });

    const { handlers, store } = harness();
    await (handlers.get(XLS_CHANNELS.addProfile) as never as Function)({}, 'darkwebtoday');
    const profileId = (await store.load()).profiles[0].id;
    await (handlers.get(XLS_CHANNELS.refreshProfile) as never as Function)({}, profileId);

    // It ensured a window instead of giving up…
    expect(sessionState.connectCalls.length, 'a capture window must be opened').toBe(1);
    // …HIDDEN, because a sweep must never pop the Chromium browser at the analyst.
    expect(sessionState.connectCalls[0][2]).toMatchObject({ visible: false });
    // …and the capture then actually happened.
    expect((await store.load()).posts).toHaveLength(1);
  });

  it('does NOT claim the sweep completed when every target failed', async () => {
    // "Collection sweep complete." with zero collected and no reason is how this stayed invisible.
    sessionState.window = { id: 'win' };
    captureTimeline.mockImplementation(async () => { throw new Error('page never loaded'); });

    const { handlers, store } = harness();
    await (handlers.get(XLS_CHANNELS.addProfile) as never as Function)({}, 'darkwebtoday');

    // v3.79.0 STRENGTHENED this from a resolved `{ failed, reason }` to a rejection. Reporting the
    // reason in the return value was not enough: his `run()` sets the notice to its SUCCESS string
    // for any resolved value, so "Collection sweep complete." was painted over the reason before he
    // could read it. Only a rejection reaches the screen.
    await expect((handlers.get(XLS_CHANNELS.refreshAll) as never as Function)({}))
      .rejects.toThrow(/all 1 source\(s\) failed: page never loaded/i);

    // The failure is also recorded where he can find it: the collection run log.
    const runs = (await store.load()).collectionRuns;
    expect(runs.some((r) => r.status === 'error')).toBe(true);
  });
});
