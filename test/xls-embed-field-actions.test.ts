// @vitest-environment node
/**
 * The three FIELD-REPORTED dead buttons (GhostExodus, 2026-09-06):
 *
 *   "Clicking Open Real Thread and Verify Live are unresponsive."
 *   "Extract Followers/Following/Both is also unresponsive."
 *
 * His screenshot carries the whole diagnosis for one of them:
 *
 *   RENDERER ASYNC ERROR: Error invoking remote method 'xls:feed:verify-post':
 *   Error: [xls:feed:verify-post] Post not found in this campaign.
 *
 * THE BUGS THIS EXISTS TO CATCH.
 *
 *  1. OPEN REAL THREAD. His card calls `onOpenThread(post.id)` — an id. Our handler passed that
 *     straight to `openInX('thread', ref)`, which expects a post URL and validates it as one. A
 *     UUID is not a URL, so it threw before any window could open. HIS `openPostThread`
 *     (`main.cjs:1173`) looks the id up in his document first and opens `post.url`.
 *
 *  2. VERIFY LIVE. Our handler called `verifyPost(caseId, postId)` — the OLD split store's reader.
 *     His posts live in his single document. Same class as the display-picture defect: the seam
 *     was wired to the store nothing in the embed writes to.
 *
 *  3. EXTRACT FOLLOWERS. His `app:background-error` listener does `payload.context.toUpperCase()`
 *     (`StationApp.tsx:285`); we emitted `{ message }` with no `context`, so the ONE channel that
 *     reports a blocked extraction threw inside his callback and displayed nothing. The click then
 *     resolved through `run()`, which announced "Network extraction complete." That is exactly
 *     what "unresponsive" looks like — and it is why v3.77.0's blocked-reason reporting never
 *     reached him.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const openInX = vi.fn(async () => ({ opened: true, url: 'https://x.com/x/status/1' }));
const verifyPostMock = vi.fn(async () => ({ availability: 'available', verifiedAt: 'T', changed: false }));
const captureNetwork = vi.fn();
const captureTimeline = vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }));

vi.mock('../src/main/x-listening/capture', () => ({
  captureTimeline: (...a: unknown[]) => captureTimeline(...a),
  captureNetwork: (...a: unknown[]) => captureNetwork(...a),
  openInX: (...a: unknown[]) => openInX(...a),
  verifyPost: (...a: unknown[]) => verifyPostMock(...a),
}));
vi.mock('../src/main/x-listening/session', () => ({
  connectXSession: vi.fn(), getXStatus: vi.fn(), clearXSession: vi.fn(),
  resolveXTorGate: () => ({ blocked: false }),
  getXWindow: () => ({ id: 'win' }), navigateXToProfile: vi.fn(async () => ({ blocked: false })),
}));
vi.mock('../src/main/x-listening/collection-lock', () => ({
  withQueuedCollectionLock: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/main/x-listening/ipc', () => ({ loadClearnetEnabled: async () => false }));
vi.mock('../src/main/x-listening/media', () => ({ readCachedMedia: vi.fn(), cacheRemoteMedia: vi.fn() }));
vi.mock('../src/main/capture/capture-window', () => ({ assertTrustedSender: () => undefined }));

import { registerXlsEmbedIpc } from '../src/main/xls-embed/ipc';
import { makeStationStore, type PersistedStationState } from '../src/main/xls-embed/state-store';
import { XLS_CHANNELS, XLS_EVENT_CHANNELS } from '../src/shared/xls/channels';

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, Fn>();
  const sent: Array<{ channel: string; payload: never }> = [];
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
    now: () => '2026-09-06T12:00:00.000Z',
    makeId: () => `id-${++seq}`,
  });
  registerXlsEmbedIpc({
    handle: (channel: string, fn: never) => handlers.set(channel, fn),
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: never) => { sent.push({ channel, payload }); } },
    }),
    store,
    ctx: { now: () => '2026-09-06T12:00:00.000Z', makeId: () => `id-${++seq}` },
  } as never);
  return { handlers, store, sent };
}

/** Seed one target source and one collected finding, the way a real campaign holds them. */
async function seedPost(store: { load(): Promise<PersistedStationState>; save(s: PersistedStationState): Promise<void> }) {
  const s = await store.load();
  const caseId = s.activeCaseId;
  s.profiles.push({
    id: 'profile-1', caseId, username: 'exodusghost', displayName: 'GhostExodus', enabled: true,
    addedAt: 'T', lastCheckedAt: null, lastError: null, collectedCount: 1,
  } as never);
  s.posts.push({
    id: 'post-1', caseId, profileId: 'profile-1', username: 'exodusghost', sourceUsername: 'exodusghost',
    url: 'https://x.com/ExodusGhost/status/2073007611022004413',
    text: 'I joined #Anonymous in 2008 at age 24.', createdAt: 'T', collectedAt: 'T',
    kind: 'post', isReply: false, parentPostId: null,
    metrics: { replies: 11, reposts: 2, likes: 16, views: 0 }, media: [],
  } as never);
  await store.save(s);
  return { caseId };
}

beforeEach(() => {
  openInX.mockClear();
  verifyPostMock.mockClear();
  captureNetwork.mockReset();
  captureTimeline.mockReset();
  captureTimeline.mockResolvedValue({ blocked: false, added: 0, skipped: 0, posts: [] } as never);
});

describe('OPEN REAL THREAD (his card passes a post id, not a URL)', () => {
  it('resolves the id to the stored post URL before opening a window', async () => {
    const { handlers, store } = harness();
    await seedPost(store);

    await handlers.get(XLS_CHANNELS.openThread)!({}, 'post-1');

    // The decisive assertion: `openInX` must receive the post's URL. Handed the raw id it throws
    // "The selected post does not contain a valid X status URL" and opens nothing.
    expect(openInX).toHaveBeenCalledWith('thread', 'https://x.com/ExodusGhost/status/2073007611022004413');
  });

  it('reports his own error when the finding is not in the active campaign', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    await expect(handlers.get(XLS_CHANNELS.openThread)!({}, 'no-such-post'))
      .rejects.toThrow(/finding not found/i);
    expect(openInX).not.toHaveBeenCalled();
  });
});

describe('VERIFY LIVE (his posts live in his document, not the old split store)', () => {
  it('hands verifyPost a store that actually contains the finding', async () => {
    const { handlers, store } = harness();
    const { caseId } = await seedPost(store);

    await handlers.get(XLS_CHANNELS.verifyPost)!({}, 'post-1');

    const [, postId, , injected] = verifyPostMock.mock.calls[0] as unknown as [string, string, unknown, {
      posts: { read(c: string): Promise<Array<{ id: string; url: string }>> };
    }];
    expect(postId).toBe('post-1');
    expect(injected, 'a store must be injected — the default reads the OLD split store').toBeTruthy();
    const posts = await injected.posts.read(caseId);
    expect(posts.map((p) => p.id)).toContain('post-1');
    expect(posts.find((p) => p.id === 'post-1')!.url).toBe('https://x.com/ExodusGhost/status/2073007611022004413');
  });

  it('writes the verification outcome back into his document', async () => {
    const { handlers, store } = harness();
    const { caseId } = await seedPost(store);

    verifyPostMock.mockImplementation((async (_c: string, _p: string, _o: unknown, injected: {
      posts: { transform(c: string, fn: (rows: Array<Record<string, unknown>>) => { next: Array<Record<string, unknown>>; write: boolean; result: unknown }): Promise<unknown> };
    }) => {
      await injected.posts.transform(caseId, (rows) => ({
        next: rows.map((p) => (p.id === 'post-1' ? { ...p, availability: 'unavailable', verifiedAt: 'V' } : p)),
        write: true,
        result: undefined,
      }));
      return { availability: 'unavailable', verifiedAt: 'V', changed: false };
    }) as never);

    await handlers.get(XLS_CHANNELS.verifyPost)!({}, 'post-1');

    const post = (await store.load()).posts.find((p) => p.id === 'post-1')!;
    expect(post.availability).toBe('unavailable');
    expect(post.verifiedAt).toBe('V');
    // …and nothing else about the finding was disturbed.
    expect(post.text).toBe('I joined #Anonymous in 2008 at age 24.');
    expect(post.metrics).toEqual({ replies: 11, reposts: 2, likes: 16, views: 0 });
  });
});

describe('EXTRACT FOLLOWERS reports a block through a payload his listener can read', () => {
  it('emits a background error carrying `context`', async () => {
    const { handlers, store, sent } = harness();
    await seedPost(store);
    captureNetwork.mockResolvedValue({
      blocked: true, reason: 'Tor is not connected.', kind: 'followers',
      target: '@exodusghost', observed: 0, added: 0, completedPasses: 0, reachedEnd: false,
    });

    await expect(handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower'))
      .rejects.toThrow(/Tor is not connected/);

    const error = sent.find((m) => m.channel === XLS_EVENT_CHANNELS.onBackgroundError);
    expect(error, 'a blocked extraction must announce itself').toBeTruthy();
    const payload = error!.payload as unknown as { context?: string; message?: string; observedAt?: string };
    // HIS listener does `payload.context.toUpperCase()`. Without `context` that throws inside the
    // callback and he sees nothing at all — the button looks dead.
    expect(typeof payload.context, 'his listener calls payload.context.toUpperCase()').toBe('string');
    expect(payload.context).toBeTruthy();
    expect(payload.message).toMatch(/Tor is not connected/);
    expect(typeof payload.observedAt).toBe('string');
    // Prove it against his actual callback body.
    expect(() => `BACKGROUND ${payload.context!.toUpperCase()}: ${payload.message}`).not.toThrow();
  });

  it('every background error the station emits satisfies his contract', async () => {
    const { handlers, store, sent } = harness();
    await seedPost(store);
    // A sweep whose only target fails: the v3.77.0 honesty path, same emit site.
    captureNetwork.mockResolvedValue({ blocked: false, kind: 'followers', target: '@x', observed: 0, added: 0, completedPasses: 1, reachedEnd: true });
    captureNetwork.mockResolvedValueOnce({ blocked: true, reason: 'blocked', kind: 'followers', target: '@x', observed: 0, added: 0, completedPasses: 0, reachedEnd: false });
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower').catch(() => undefined);

    const errors = sent.filter((m) => m.channel === XLS_EVENT_CHANNELS.onBackgroundError);
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      const p = e.payload as unknown as { context?: string; message?: string; observedAt?: string };
      expect(typeof p.context).toBe('string');
      expect(typeof p.message).toBe('string');
      expect(typeof p.observedAt).toBe('string');
    }
  });
});

describe('a failure his UI can read (his `run()` announces success unless we throw)', () => {
  it('a blocked extraction rejects, so the notice is the reason and not "complete"', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    captureNetwork.mockResolvedValue({
      blocked: true, reason: 'Tor is not connected.', kind: 'followers',
      target: '@exodusghost', observed: 0, added: 0, completedPasses: 0, reachedEnd: false,
    });

    // His `extractNetwork` calls `run()`, which sets the notice to the SUCCESS string on any
    // resolved value. A resolved `{ blocked: true }` therefore displays "Network extraction
    // complete." over the top of the background error — the click reads as doing nothing at all.
    await expect(handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower'))
      .rejects.toThrow(/Tor is not connected/);
  });

  it('still records the failed run in his collection log before rejecting', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    captureNetwork.mockResolvedValue({
      blocked: true, reason: 'The saved X session is no longer signed in.', kind: 'followers',
      target: '@exodusghost', observed: 0, added: 0, completedPasses: 0, reachedEnd: false,
    });
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower').catch(() => undefined);

    const run = (await store.load()).collectionRuns.at(-1)!;
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/no longer signed in/);
    expect(run.operation).toBe('followers');
  });

  it('a sweep in which every target failed rejects rather than reporting completion', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    captureTimeline.mockRejectedValue(new Error('Connect to X before collecting.') as never);
    await expect(handlers.get(XLS_CHANNELS.refreshAll)!({}))
      .rejects.toThrow(/all 1 source\(s\) failed: connect to x before collecting/i);
  });
});

describe('the extraction shows its work while it runs', () => {
  it('forwards per-pass progress to his sweep-progress channel, and clears it at the end', async () => {
    const { handlers, store, sent } = harness();
    await seedPost(store);
    captureNetwork.mockImplementation((async (_req: unknown, over: {
      onProgress?: (p: { message: string; current: number; total: number }) => void;
    }) => {
      over.onProgress?.({ message: 'Extracting @exodusghost — pass 1/9 — 0 unique', current: 1, total: 9 });
      over.onProgress?.({ message: 'Extracting @exodusghost — pass 2/9 — 24 unique', current: 2, total: 9 });
      return { blocked: false, kind: 'followers', target: '@exodusghost', observed: 24, added: 24, completedPasses: 2, reachedEnd: true };
    }) as never);

    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower');

    const progress = sent.filter((m) => m.channel === XLS_EVENT_CHANNELS.onSweepProgress)
      .map((m) => m.payload as unknown as { message: string; running: boolean });
    // A long scrape with no visible progress is indistinguishable from a dead button — the whole
    // reason this was reported as "unresponsive" three times.
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress[0].running).toBe(true);
    expect(progress.some((p) => /24 unique/.test(p.message))).toBe(true);
    // …and it must not leave the UI stuck: his extract buttons are disabled while `running`.
    expect(progress.at(-1)!.running).toBe(false);
  });

  it('clears the progress bar even when the extraction is blocked', async () => {
    const { handlers, store, sent } = harness();
    await seedPost(store);
    captureNetwork.mockResolvedValue({
      blocked: true, reason: 'Tor is not connected.', kind: 'followers',
      target: '@exodusghost', observed: 0, added: 0, completedPasses: 0, reachedEnd: false,
    });
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower').catch(() => undefined);

    const progress = sent.filter((m) => m.channel === XLS_EVENT_CHANNELS.onSweepProgress)
      .map((m) => m.payload as unknown as { running: boolean });
    expect(progress.at(-1)!.running, 'a stuck progress bar disables every extract button').toBe(false);
  });
});

describe('an extraction that read nothing says so', () => {
  it('rejects with a plain-language message rather than announcing completion', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    // Not blocked, no error, no accounts — the LAST silent path. Before the progress line existed
    // this was indistinguishable from a dead button, and his `run()` announced "Network extraction
    // complete." over the top of it.
    captureNetwork.mockResolvedValue({
      blocked: false, kind: 'followers', target: '@exodusghost',
      observed: 0, added: 0, completedPasses: 9, reachedEnd: true,
    });

    await expect(handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower'))
      .rejects.toThrow(/without reading any accounts/i);
  });

  it('records the empty read in his collection log', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    captureNetwork.mockResolvedValue({
      blocked: false, kind: 'followers', target: '@exodusghost',
      observed: 0, added: 0, completedPasses: 9, reachedEnd: true,
    });
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower').catch(() => undefined);

    const run = (await store.load()).collectionRuns.at(-1)!;
    expect(run.observed).toBe(0);
    expect(run.passesCompleted).toBe(9);
  });

  it('a scan that DID read accounts resolves normally', async () => {
    const { handlers, store } = harness();
    await seedPost(store);
    captureNetwork.mockImplementation((async (_r: unknown, over: {
      saveNetwork: (c: string, a: { accounts: Array<Record<string, unknown>> }) => Promise<number>;
    }) => {
      await over.saveNetwork('c', { accounts: [{ username: 'someone', displayName: 'Someone' }] });
      return { blocked: false, kind: 'followers', target: '@exodusghost', observed: 1, added: 1, completedPasses: 2, reachedEnd: true };
    }) as never);

    const res = await handlers.get(XLS_CHANNELS.extractRelationships)!({}, 'profile-1', 'follower') as { added: number };
    expect(res.added).toBe(1);
    expect((await store.load()).relationships.map((r) => r.username)).toContain('someone');
  });
});
