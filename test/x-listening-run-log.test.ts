/**
 * A3 — collection run log.
 *
 * Covers the Enterprise `startCollectionRun`/`finishCollectionRun` per-operation run record
 * (`main.cjs:420-457`) rebuilt onto OUR seams: the encrypted `runLog` secure-fs sidecar
 * (store.ts), the pure `buildRunRecord`/`recordCollectionRun` orchestration (run-log.ts), and
 * the emission from `captureTimeline` (capture.ts) / the archive path. Every store op runs
 * through the pure `makeXStore` factory over an in-memory fs seam — no electron/vault.
 *
 * The two acceptance tests (design A3):
 *  1. a capture operation appends a run-log record with the correct observed/added/duplicates;
 *  2. `listRunLog` returns newest-first AND is capped at `X_MAX_RUN_LOG`.
 */
import { describe, it, expect } from 'vitest';

import {
  makeXStore,
  type XStore,
  type XStoreDeps,
  type XRunLogRecord,
  X_MAX_RUN_LOG,
} from '../src/main/x-listening/store';
import { buildRunRecord, recordCollectionRun } from '../src/main/x-listening/run-log';
import {
  captureTimeline,
  type XTimelineCaptureRequest,
  type XCaptureDeps,
} from '../src/main/x-listening/capture';
import type { RawPost } from '../src/main/x-listening/extract';

// ---- in-memory fs seam (mirrors x-listening-changes.test.ts's memStore) ----

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

const CASE = 'case-a3';

const WIN = { webContents: { executeJavaScript: () => Promise.resolve(null) } } as unknown as Electron.BrowserWindow;

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

const REQ: XTimelineCaptureRequest = {
  caseId: CASE,
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target timeline',
  targetUsername: 'target',
};

/** Capture deps wired to an in-memory store's run log — a capture's emitted record actually lands
 *  in `store.runLog`, so we assert the persisted list end-to-end (not just the built record). */
function deps(store: XStore, over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    runCapture: async () => [raw()],
    savePosts: async () => ({ added: 1, skipped: 0 }),
    saveItems: async () => ({ added: 1, skipped: 0 }),
    resolveMedia: async () => null,
    recordRun: async (caseId, record) => {
      await recordCollectionRun(caseId, record, store);
    },
    now: () => '2026-08-11T12:00:00.000Z',
    ...over,
  };
}

describe('A3 — captureTimeline emits a collection-run record', () => {
  it('appends a `posts` run record with observed/added/duplicates from the capture result', async () => {
    const store = memStore();
    await captureTimeline(WIN, REQ, deps(store));

    const log = await store.listRunLog(CASE);
    expect(log).toHaveLength(1);
    const rec = log[0]!;
    expect(rec.operation).toBe('posts');
    expect(rec.profileId).toBe('target');
    expect(rec.username).toBe('target');
    expect(rec.observed).toBe(1);
    expect(rec.added).toBe(1);
    expect(rec.duplicates).toBe(0);
    expect(rec.status).toBe('complete');
    expect(rec.reachedEnd).toBe(true);
    expect(rec.requestedPasses).toBe(1);
    expect(rec.completedPasses).toBe(1);
    expect(rec.startedAt).toBe('2026-08-11T12:00:00.000Z');
    expect(rec.endedAt).toBe('2026-08-11T12:00:00.000Z');
  });

  it('derives duplicates = observed - added when a re-capture hits a stored id', async () => {
    const store = memStore();
    // Two raws observed, only one newly added → one duplicate.
    await captureTimeline(
      WIN,
      REQ,
      deps(store, {
        runCapture: async () => [raw({ id: '100' }), raw({ id: '101', url: 'https://x.com/target/status/101' })],
        savePosts: async () => ({ added: 1, skipped: 1 }),
      }),
    );
    const rec = (await store.listRunLog(CASE))[0]!;
    expect(rec.observed).toBe(2);
    expect(rec.added).toBe(1);
    expect(rec.duplicates).toBe(1);
  });

  it('emits an `error` run record (observed/added 0) when the challenge/lock gate blocks', async () => {
    const store = memStore();
    await captureTimeline(
      WIN,
      REQ,
      deps(store, {
        guard: async () => ({ blocked: true, reason: 'A challenge interstitial is blocking capture.' }),
      }),
    );
    const rec = (await store.listRunLog(CASE))[0]!;
    expect(rec.status).toBe('error');
    expect(rec.observed).toBe(0);
    expect(rec.added).toBe(0);
    expect(rec.duplicates).toBe(0);
    expect(rec.reachedEnd).toBe(false);
    expect(rec.completedPasses).toBe(0);
    expect(rec.stopReason).toBe('A challenge interstitial is blocking capture.');
  });

  it('stamps the operation an archive step passes through (archive_posts)', async () => {
    const store = memStore();
    await captureTimeline(WIN, { ...REQ, operation: 'archive_posts' }, deps(store));
    const rec = (await store.listRunLog(CASE))[0]!;
    expect(rec.operation).toBe('archive_posts');
  });

  it('a run-log write failure never breaks the capture (telemetry, not evidence)', async () => {
    const store = memStore();
    const res = await captureTimeline(
      WIN,
      REQ,
      deps(store, {
        recordRun: async () => {
          throw new Error('run-log sidecar unavailable');
        },
      }),
    );
    // The capture still succeeds and returns its posts despite the run-log write throwing.
    expect(res.blocked).toBe(false);
    expect(res.added).toBe(1);
    expect(res.posts).toHaveLength(1);
  });
});

describe('A3 — listRunLog: newest-first + capped', () => {
  it('returns records newest-first', async () => {
    const store = memStore();
    for (let i = 0; i < 3; i++) {
      await recordCollectionRun(
        CASE,
        buildRunRecord({
          profileId: 'target',
          username: 'target',
          operation: 'posts',
          observed: i,
          added: i,
          startedAt: `2026-08-11T12:0${i}:00.000Z`,
          endedAt: `2026-08-11T12:0${i}:00.000Z`,
        }),
        store,
      );
    }
    const log = await store.listRunLog(CASE);
    expect(log.map((r) => r.startedAt)).toEqual([
      '2026-08-11T12:02:00.000Z',
      '2026-08-11T12:01:00.000Z',
      '2026-08-11T12:00:00.000Z',
    ]);
  });

  it(`caps the persisted list to the newest ${X_MAX_RUN_LOG}`, async () => {
    const store = memStore();
    const total = X_MAX_RUN_LOG + 5;
    for (let i = 0; i < total; i++) {
      await recordCollectionRun(
        CASE,
        buildRunRecord({
          profileId: 'target',
          username: 'target',
          operation: 'posts',
          observed: 1,
          added: 1,
          // zero-padded so string sort == numeric order for the newest-first assertion.
          startedAt: `run-${String(i).padStart(4, '0')}`,
          endedAt: `run-${String(i).padStart(4, '0')}`,
        }),
        store,
      );
    }
    const log = await store.listRunLog(CASE);
    expect(log).toHaveLength(X_MAX_RUN_LOG);
    // Newest-first: the very last appended record is first; the oldest retained is total-MAX.
    expect(log[0]!.startedAt).toBe(`run-${String(total - 1).padStart(4, '0')}`);
    expect(log[log.length - 1]!.startedAt).toBe(`run-${String(total - X_MAX_RUN_LOG).padStart(4, '0')}`);
  });
});

describe('A3 — buildRunRecord: normalization', () => {
  it('clamps negative counts and derives duplicates = max(0, observed - added)', () => {
    const rec = buildRunRecord({
      profileId: 'p',
      username: 'u',
      operation: 'followers',
      observed: 5,
      added: 8, // added > observed (shouldn't happen) → duplicates clamps to 0
      startedAt: 'a',
      endedAt: 'b',
    });
    expect(rec.duplicates).toBe(0);
    expect(rec.observed).toBe(5);
    expect(rec.added).toBe(8);
  });
});
