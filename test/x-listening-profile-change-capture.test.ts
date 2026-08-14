/**
 * FB2 (audit HIGH #7) — profile-change tracking wired into the capture path.
 *
 * `snapshotProfile` (changes.ts) was fully implemented but called from NOWHERE, and `displayName`
 * had been dropped from the metadata signature, so an account RENAME produced no event. This pins:
 *
 *  1. capturing a profile whose bio changed over two captures emits exactly ONE `profile_change`;
 *  2. a DISPLAY-NAME change (the rename the dropped field lost) emits exactly ONE `profile_change`;
 *  3. the FIRST capture is a baseline — no event;
 *  4. `profileMetadataSignature` is deterministic AND folds in `displayName`.
 *
 * The capture is driven through the real `captureTimeline` on injected seams (guard, persistence,
 * scroll/delay, clock, the profile-meta scrape, and the `snapshotProfile` store seam bound to an
 * in-memory `makeXStore`) — no electron, no network.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  captureTimeline,
  type XTimelineCaptureRequest,
  type XCaptureDeps,
} from '../src/main/x-listening/capture';
import { snapshotProfile } from '../src/main/x-listening/changes';
import { profileMetadataSignature } from '../src/main/x-listening/evidence';
import {
  makeXStore,
  type XStore,
  type XStoreDeps,
} from '../src/main/x-listening/store';
import type { RawPost, RawProfileMeta } from '../src/main/x-listening/extract';
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/x-listening-collection-settings';

const WIN = { webContents: { executeJavaScript: vi.fn() } } as unknown as Electron.BrowserWindow;

function memStore(): XStore {
  const files = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  const deps: XStoreDeps = {
    readFile: async (p) => {
      if (!files.has(p)) throw enoent(p);
      return Buffer.from(files.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    itemsPath: (id) => `x/${id}/x-items.json`,
    notesPath: (id) => `x/${id}/x-notes.json`,
    networksPath: (id) => `x/${id}/x-networks.json`,
    archiveStatePath: (id) => `x/${id}/x-archive-state.json`,
    postsPath: (id) => `x/${id}/x-posts.json`,
    presetsPath: (id) => `x/${id}/x-presets.json`,
    entitiesCachePath: (id) => `x/${id}/x-entities-cache.json`,
    changeEventsPath: (id) => `x/${id}/x-change-events.json`,
    profileSnapshotsPath: (id) => `x/${id}/x-profile-snapshots.json`,
    runLogPath: (id) => `x/${id}/x-run-log.json`,
  };
  return makeXStore(deps);
}

const CASE = 'case-fb2';

const REQ: XTimelineCaptureRequest = {
  caseId: CASE,
  jobId: 'job-1',
  channelId: 'prof-1',
  channelLabel: '@target timeline',
  targetUsername: 'target',
};

const raw = (o: Partial<RawPost> = {}): RawPost => ({
  id: '100',
  username: 'target',
  url: 'https://x.com/target/status/100',
  text: 'body text',
  createdAt: '2026-08-06T11:00:00.000Z',
  isReply: false,
  isRepost: false,
  socialContext: '',
  metricsRaw: { replies: '1', reposts: '0', likes: '1.2K', views: '3K' },
  media: [],
  ...o,
});

const meta = (o: Partial<RawProfileMeta> = {}): RawProfileMeta => ({
  displayName: 'Target Person',
  bio: 'analyst of things',
  location: 'Berlin',
  website: 'https://example.org',
  avatar: 'https://pbs.twimg.com/profile_images/1/abc.jpg',
  ...o,
});

/** Injected deps: signed-in guard, no-op persistence/scroll/delay, deterministic clock, one visible
 *  post, and the `snapshotProfile` seam bound to a shared in-memory store so emitted events land. */
function deps(store: XStore, profileMeta: RawProfileMeta | null, over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    runCapture: async () => [raw()],
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    savePosts: async (_c, posts) => ({ added: posts.length, skipped: 0 }),
    saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
    resolveMedia: async () => null,
    imagesEnabledForSource: async () => false,
    recordRun: async () => {},
    loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 1, delayPerPassMs: 0 }),
    scroll: async () => {},
    assertSignedIn: async () => ({ blocked: false }),
    delay: async () => {},
    now: () => '2026-08-11T12:00:00.000Z',
    readProfileMeta: async () => profileMeta,
    snapshotProfile: (caseId, input, opts) => snapshotProfile(caseId, input, opts, store),
    ...over,
  };
}

describe('FB2 — profile-change tracking wired into captureTimeline', () => {
  it('the FIRST capture is a baseline — a snapshot is stored but NO profile_change event', async () => {
    const store = memStore();
    await captureTimeline(WIN, REQ, deps(store, meta()));

    expect(await store.profileSnapshots.read(CASE)).toHaveLength(1);
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
  });

  it('a changed BIO across two captures emits exactly one profile_change', async () => {
    const store = memStore();
    await captureTimeline(WIN, REQ, deps(store, meta({ bio: 'analyst of things' })));
    await captureTimeline(WIN, REQ, deps(store, meta({ bio: 'now studying networks' })));

    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('profile_change');
    expect(events[0]!.profileId).toBe('prof-1');
    // baseline + changed = two snapshots.
    expect(await store.profileSnapshots.read(CASE)).toHaveLength(2);
  });

  it('a DISPLAY-NAME change (rename) emits exactly one profile_change — the case the dropped field lost', async () => {
    const store = memStore();
    await captureTimeline(WIN, REQ, deps(store, meta({ displayName: 'Target Person' })));
    await captureTimeline(WIN, REQ, deps(store, meta({ displayName: 'Renamed Person' })));

    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('profile_change');
  });

  it('an UNCHANGED re-capture emits nothing and adds no snapshot', async () => {
    const store = memStore();
    await captureTimeline(WIN, REQ, deps(store, meta()));
    await captureTimeline(WIN, REQ, deps(store, meta()));

    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
    expect(await store.profileSnapshots.read(CASE)).toHaveLength(1);
  });

  it('an all-empty profile-header read (no header on the page) records NO baseline snapshot', async () => {
    const store = memStore();
    await captureTimeline(
      WIN,
      REQ,
      deps(store, { displayName: '', bio: '', location: '', website: '', avatar: '' }),
    );
    expect(await store.profileSnapshots.read(CASE)).toHaveLength(0);
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
  });
});

describe('FB2 — profileMetadataSignature folds in displayName (deterministic)', () => {
  it('is stable across runs and sensitive to a displayName change', () => {
    const base = { displayName: 'Alice', bio: 'b', avatar: 'a', location: 'l', website: 'w' };
    const a = profileMetadataSignature(base);
    const b = profileMetadataSignature({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // A rename alone (only displayName differs) perturbs the signature — the dropped-field fix.
    const renamed = profileMetadataSignature({ ...base, displayName: 'Bob' });
    expect(renamed).not.toBe(a);
  });
});
