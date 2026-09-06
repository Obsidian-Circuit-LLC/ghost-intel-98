// @vitest-environment node
/**
 * The four collections in his document that were only ever DELETED FROM, never written.
 *
 * `entities`, `profileSnapshots`, `networkSnapshots` and `networkEvents` each appear in the embed
 * exactly once outside `defaultStationState`: in a filter that removes rows when a profile or
 * campaign is deleted. Nothing ever adds one. So ENTITY INDEX and CHANGE INTEL are structurally
 * incapable of showing anything, which is exactly what his sidebar reads: `ENTITY INDEX 0`,
 * `CHANGE INTEL 0`, against a campaign with 55 collected findings.
 *
 * This is the SAME defect as VERIFY LIVE reading the old split store, in four more places: Ghost
 * Intel 98 already implements every one of these (`extractEntities`, `snapshotProfile`,
 * `deriveNetworkDeltaEvents`), hardened and tested — the embed just never pointed them at his
 * document, so the results went to per-case sidecars his station does not read.
 *
 * Plus the follower rows' display pictures, and the sweep failure that is announced and then
 * painted over.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const captureNetwork = vi.fn();
const captureTimeline = vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }));

vi.mock('../src/main/x-listening/capture', () => ({
  captureTimeline: (...a: unknown[]) => captureTimeline(...a),
  captureNetwork: (...a: unknown[]) => captureNetwork(...a),
  openInX: vi.fn(),
  verifyPost: vi.fn(),
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
import { XLS_CHANNELS } from '../src/shared/xls/channels';

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

/** The rich artifact a real capture hands to `savePosts`. */
const ARTIFACT = {
  id: 'post-1', channelId: 'exodusghost', authorHandle: 'exodusghost', displayName: 'GhostExodus',
  avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg',
  text: 'reach me at ops@example.org or https://example.org — cc @dcs_vortex #Anonymous',
  url: 'https://x.com/ExodusGhost/status/2073007611022004413',
  publishedAt: '2026-09-01T10:00:00.000Z', harvestedAt: '2026-09-01T10:05:00.000Z',
  kind: 'post', parentPostId: null,
  metrics: { replies: 1, reposts: 0, likes: 5, views: 50 }, evidenceHash: 'h1', mediaRefs: [],
};

async function seedProfile(handlers: Map<string, Fn>, store: { load(): Promise<PersistedStationState> }) {
  await handlers.get(XLS_CHANNELS.addProfile)!({}, 'exodusghost');
  return (await store.load()).profiles[0].id;
}

beforeEach(() => {
  captureNetwork.mockReset();
  captureTimeline.mockReset();
  captureTimeline.mockResolvedValue({ blocked: false, added: 0, skipped: 0, posts: [] } as never);
});

describe('ENTITY INDEX is populated from collected findings', () => {
  it('indexes the entities in a captured post', async () => {
    captureTimeline.mockImplementation((async (_w: unknown, _r: unknown, over: {
      savePosts: (c: string, p: unknown[]) => Promise<unknown>;
    }) => {
      await over.savePosts('c', [ARTIFACT]);
      return { blocked: false, added: 1, skipped: 0, posts: [ARTIFACT] };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);

    const entities = (await store.load()).entities;
    expect(entities.length, 'ENTITY INDEX has been reading 0 against 55 findings').toBeGreaterThan(0);
    const values = entities.map((e) => e.normalizedValue.toLowerCase());
    expect(values).toContain('ops@example.org');
    expect(values.some((v) => v.includes('example.org'))).toBe(true);
    // The ported extractor normalises a mention/hashtag without its sigil.
    expect(values).toContain('dcs_vortex');
    expect(values).toContain('anonymous');
    for (const e of entities) {
      expect(e.postIds).toContain('post-1');
      expect(e.sourceUsernames).toContain('exodusghost');
      expect(e.count).toBeGreaterThan(0);
    }
  });

  it('re-observing the same post does not double-count an entity', async () => {
    captureTimeline.mockImplementation((async (_w: unknown, _r: unknown, over: {
      savePosts: (c: string, p: unknown[]) => Promise<unknown>;
    }) => {
      await over.savePosts('c', [ARTIFACT]);
      return { blocked: false, added: 1, skipped: 0, posts: [ARTIFACT] };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);

    const mention = (await store.load()).entities.find((e) => e.type === 'mention' && e.normalizedValue.toLowerCase() === 'dcs_vortex')!;
    expect(mention.count).toBe(1);
    expect(mention.postIds).toEqual(['post-1']);
  });
});

describe('CHANGE INTEL receives profile snapshots and changes', () => {
  it('routes the capture snapshot into his document, not the old sidecar', async () => {
    captureTimeline.mockImplementation((async (_w: unknown, _r: unknown, over: {
      snapshotProfile: (c: string, i: Record<string, unknown>, o: { now: string }) => Promise<unknown>;
    }) => {
      await over.snapshotProfile('c', {
        profileId: 'ignored', sourceUsername: 'exodusghost', displayName: 'GhostExodus',
        bio: 'first bio', avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg', location: '', website: '',
      }, { now: '2026-09-06T12:00:00.000Z' });
      return { blocked: false, added: 0, skipped: 0, posts: [] };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);

    const snaps = (await store.load()).profileSnapshots as Array<Record<string, unknown>>;
    expect(snaps.length, 'nothing has ever written a profile snapshot into his document').toBe(1);
    expect(snaps[0].profileId).toBe(profileId);
    expect(snaps[0].bio).toBe('first bio');
    // The FIRST snapshot is a baseline — his rule: no event until something actually changes.
    expect((await store.load()).changeEvents).toHaveLength(0);
  });

  it('emits one profile_change when the metadata signature moves', async () => {
    const meta = { profileId: 'ignored', sourceUsername: 'exodusghost', displayName: 'GhostExodus', bio: 'first bio', avatar: '', location: '', website: '' };
    let bio = 'first bio';
    captureTimeline.mockImplementation((async (_w: unknown, _r: unknown, over: {
      snapshotProfile: (c: string, i: Record<string, unknown>, o: { now: string }) => Promise<unknown>;
    }) => {
      await over.snapshotProfile('c', { ...meta, bio }, { now: '2026-09-06T12:00:00.000Z' });
      return { blocked: false, added: 0, skipped: 0, posts: [] };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);
    bio = 'now studying networks';
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);

    const s = await store.load();
    expect(s.profileSnapshots).toHaveLength(2);
    const events = s.changeEvents.filter((e) => e.type === 'profile_change');
    expect(events).toHaveLength(1);
    expect(events[0].caseId).toBe(s.activeCaseId);
    expect(events[0].sourceUsername).toBe('exodusghost');
  });
});

describe('the follower network records its own history', () => {
  it('writes network delta events and a snapshot into his document', async () => {
    captureNetwork.mockImplementation((async (_req: unknown, over: {
      saveNetwork: (c: string, a: { accounts: Array<Record<string, unknown>> }) => Promise<number>;
      appendNetworkEvents: (c: string, evs: Array<Record<string, unknown>>) => Promise<void>;
      saveScanState: (c: string, st: Record<string, unknown>) => Promise<void>;
      readScanState: (c: string, t: string, k: string) => Promise<unknown>;
    }) => {
      expect(await over.readScanState('c', '@exodusghost', 'followers')).toBeNull();
      await over.saveNetwork('c', { accounts: [{ username: 'carol' }, { username: 'dave' }] });
      await over.appendNetworkEvents('c', [
        { kind: 'newly_observed', handle: '@carol', target: '@exodusghost', relationship: 'followers', observedAt: '2026-09-06T12:00:00.000Z', confidence: 'observed' },
      ]);
      await over.saveScanState('c', {
        target: '@exodusghost', relationship: 'followers',
        observedUsernames: ['@carol', '@dave'], observedCount: 2, passesCompleted: 9,
        capturedAt: '2026-09-06T12:00:00.000Z',
      });
      return { blocked: false, kind: 'followers', target: '@exodusghost', observed: 2, added: 2, completedPasses: 9, reachedEnd: true };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, profileId, 'follower');

    const s = await store.load();
    expect(s.networkEvents.length, 'network events were going to a sidecar his station never reads').toBe(1);
    expect(s.networkEvents[0].username).toBe('carol');
    expect(s.networkEvents[0].eventType).toBe('newly_observed');
    expect(s.networkEvents[0].profileId).toBe(profileId);
    expect(s.networkEvents[0].relationship).toBe('follower');
    expect((s.networkSnapshots as Array<Record<string, unknown>>).length).toBe(1);
  });

  it('carries the follower row display picture', async () => {
    captureNetwork.mockImplementation((async (_req: unknown, over: {
      saveNetwork: (c: string, a: { accounts: Array<Record<string, unknown>> }) => Promise<number>;
    }) => {
      await over.saveNetwork('c', {
        accounts: [{ username: 'carol', displayName: 'Carol', avatar: 'https://pbs.twimg.com/profile_images/9/c.jpg' }],
      });
      return { blocked: false, kind: 'followers', target: '@exodusghost', observed: 1, added: 1, completedPasses: 2, reachedEnd: true };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    await handlers.get(XLS_CHANNELS.extractRelationships)!({}, profileId, 'follower');

    const row = (await store.load()).relationships.find((r) => r.username === 'carol')!;
    expect(row.avatar, 'the blank circles in the follower network').toBe('https://pbs.twimg.com/profile_images/9/c.jpg');
  });
});

describe('IMAGES: OFF actually turns images off', () => {
  /** Drive HIS toggles through the real channels, then see what capture is actually told. */
  async function imagesEnabledDuringCapture(
    toggles: { campaign?: boolean; source?: 'on' | 'off' | 'inherit' },
  ): Promise<boolean> {
    let enabled: boolean | undefined;
    captureTimeline.mockImplementation((async (_w: unknown, _r: unknown, over: {
      imagesEnabledForSource: (c: string, k: string) => Promise<boolean>;
    }) => {
      enabled = await over.imagesEnabledForSource('c', 'exodusghost');
      return { blocked: false, added: 0, skipped: 0, posts: [] };
    }) as never);

    const { handlers, store } = harness();
    const profileId = await seedProfile(handlers, store);
    if (toggles.campaign !== undefined) {
      await handlers.get(XLS_CHANNELS.setCampaignImages)!({}, toggles.campaign);
    }
    if (toggles.source) {
      await handlers.get(XLS_CHANNELS.setProfileImageMode)!({}, profileId, toggles.source);
    }
    await handlers.get(XLS_CHANNELS.refreshProfile)!({}, profileId);
    return enabled!;
  }

  it('honours the campaign toggle from HIS document', async () => {
    // His IMAGES: ON/OFF writes only to his document; the capture path read an old sidecar that
    // defaults to images-on. So switching images OFF fetched media anyway — a data-minimisation
    // control that silently did nothing.
    expect(await imagesEnabledDuringCapture({ campaign: false })).toBe(false);
    expect(await imagesEnabledDuringCapture({ campaign: true })).toBe(true);
  });

  it('honours a per-source override on top of it (his effectiveImageCollection)', async () => {
    expect(await imagesEnabledDuringCapture({ campaign: false, source: 'on' })).toBe(true);
    expect(await imagesEnabledDuringCapture({ campaign: true, source: 'off' })).toBe(false);
    expect(await imagesEnabledDuringCapture({ campaign: true, source: 'inherit' })).toBe(true);
    expect(await imagesEnabledDuringCapture({ campaign: false, source: 'inherit' })).toBe(false);
  });
});
