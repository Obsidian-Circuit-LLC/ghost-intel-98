/**
 * X Listening Station Enterprise port — Task 4: timeline capture → HarvestedItem +
 * XPostArtifact.
 *
 * Supersedes the prior Plan-A `test/x-listening-capture.test.ts` (which pinned the OLD
 * clearnet-only `ipc.ts` `captureVisibleTimeline` seam — that module is superseded per-task
 * across this port, per `session.ts`'s own migration note, and is fully retired at Task 16).
 * This file pins the NEW `src/main/x-listening/capture.ts` orchestration:
 *
 *  1. `X_PAGE_STATE_SCRIPT` (extract.ts) is a STATIC probe (adapted from Enterprise
 *     `assertSignedInPage`'s in-page read) — no `${…}` interpolation.
 *  2. `classifyXPageState` (extract.ts, pure) refuses a challenge/rate-limit interstitial
 *     or a signed-out page — capture STOPS, never solves.
 *  3. `captureTimeline` (capture.ts) ties the STATIC `X_POST_SCRIPT` scrape to the
 *     challenge gate, the collect-toggle gate (`selectTimelineCaptures`), and BOTH
 *     persistence sidecars: the plain `HarvestedItem` store (`saveItems`) and the richer
 *     `XPostArtifact` sidecar (`store.posts.save`) — metrics AND metricsRaw kept, kind,
 *     parentPostId, evidenceHash (Task 2 fold-in).
 *  4. `toPostArtifact` (capture.ts, pure) maps one normalized item → an `XPostArtifact`
 *     with a deterministic `evidenceHash`.
 *
 * capture.ts/extract.ts are quarantine-clean (no electron value import — `win` is an
 * injected structural type; the store persistence deps are lazy dynamic imports), so this
 * file needs NO `vi.mock('electron', …)`.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  X_POST_SCRIPT,
  X_PAGE_STATE_SCRIPT,
  classifyXPageState,
  type RawPost,
  type XPageState,
} from '../src/main/x-listening/extract';
import {
  captureTimeline,
  toPostArtifact,
  X_COLLECTOR_VERSION,
  DEFAULT_COLLECT,
  type XTimelineCaptureRequest,
  type XCaptureDeps,
} from '../src/main/x-listening/capture';
import { postEvidenceHash } from '../src/main/x-listening/evidence';

function scriptSourceBody(relPath: string, name: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`'));
  if (!m) throw new Error(`static script ${name} not found in ${relPath}`);
  return m[1];
}

const WIN = { webContents: { executeJavaScript: vi.fn() } } as unknown as Electron.BrowserWindow;

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
  media: ['https://pbs.twimg.com/media/a.jpg'],
  ...o,
});

const REQ: XTimelineCaptureRequest = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target timeline',
  targetUsername: 'target',
};

function deps(over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    runCapture: async () => [raw()],
    savePosts: async () => ({ added: 1, skipped: 0 }),
    saveItems: async () => ({ added: 1, skipped: 0 }),
    recordRun: async () => {},
    now: () => '2026-08-11T12:00:00.000Z',
    ...over,
  };
}

// ---- 1. X_PAGE_STATE_SCRIPT: static, no interpolation ---------------------

describe('X_PAGE_STATE_SCRIPT: static, no interpolation', () => {
  it('is a non-empty string with no ${ interpolation in its source', () => {
    expect(typeof X_PAGE_STATE_SCRIPT).toBe('string');
    expect(X_PAGE_STATE_SCRIPT.length).toBeGreaterThan(0);
    const body = scriptSourceBody('src/main/x-listening/extract.ts', 'X_PAGE_STATE_SCRIPT');
    expect(body).not.toContain('${');
    expect(body).toContain('articles');
  });
});

// ---- 2. classifyXPageState (pure challenge/lock gate) ----------------------

describe('classifyXPageState', () => {
  const page = (o: Partial<XPageState> = {}): XPageState => ({
    url: 'https://x.com/target',
    text: 'some ordinary timeline text',
    articles: 3,
    ...o,
  });

  it('signed-in, unchallenged page → not blocked', () => {
    expect(classifyXPageState(page())).toEqual({ signedIn: true, blocked: false });
  });

  it('a verification/rate-limit challenge → blocked, never attempts to solve', () => {
    const res = classifyXPageState(page({ text: 'We need to verify your identity before continuing.' }));
    expect(res.blocked).toBe(true);
    expect(res.signedIn).toBe(true);
    expect(res.reason).toMatch(/challenge|limit/i);
  });

  it('the login flow URL → signed out, not itself "blocked" (caller gates on !signedIn)', () => {
    const res = classifyXPageState(page({ url: 'https://x.com/i/flow/login', text: 'Sign in to X' }));
    expect(res.signedIn).toBe(false);
  });
});

// ---- 3. toPostArtifact: normalized item → richer evidence-hashed artifact --

describe('toPostArtifact', () => {
  it('folds metrics (value) AND metricsRaw (verbatim string) into the artifact', async () => {
    const res = await captureTimeline(WIN, REQ, deps());
    expect(res.blocked).toBe(false);
    const post = res.posts[0]!;
    expect(post.metrics).toEqual({ replies: 1, reposts: 0, likes: 1200, views: 3000 });
    expect(post.metricsRaw).toEqual({ replies: '1', reposts: '0', likes: '1.2K', views: '3K' });
  });

  it('sets a deterministic evidenceHash equal to postEvidenceHash(post)', async () => {
    const res = await captureTimeline(WIN, REQ, deps());
    const post = res.posts[0]!;
    expect(post.evidenceHash).toBe(postEvidenceHash(post));
    expect(post.evidenceHash).toHaveLength(64);
  });

  it('a changed metric changes the evidence hash (honesty: counts cannot be edited post-collection undetected)', async () => {
    const a = await captureTimeline(WIN, REQ, deps());
    const b = await captureTimeline(
      WIN,
      REQ,
      deps({ runCapture: async () => [raw({ metricsRaw: { replies: '9', reposts: '0', likes: '1.2K', views: '3K' } })] }),
    );
    expect(a.posts[0]!.evidenceHash).not.toBe(b.posts[0]!.evidenceHash);
  });

  it('kind:"post" carries parentPostId: null (no fabricated lineage)', async () => {
    const res = await captureTimeline(WIN, REQ, deps());
    expect(res.posts[0]!.kind).toBe('post');
    expect(res.posts[0]!.parentPostId).toBeNull();
  });

  it('a reply (collect.replies on) is tagged kind:"reply"', async () => {
    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: { replies: true, reposts: false, comments: false } },
      deps({ runCapture: async () => [raw({ isReply: true })] }),
    );
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0]!.kind).toBe('reply');
  });

  it('a repost (a DIFFERENT author, collect.reposts on) is tagged kind:"repost", author recorded honestly', async () => {
    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: { replies: false, reposts: true, comments: false } },
      deps({ runCapture: async () => [raw({ username: 'someoneElse', isRepost: true })] }),
    );
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0]!.kind).toBe('repost');
    expect(res.posts[0]!.authorHandle).toBe('@someoneElse');
  });

  it('the DEFAULT_COLLECT gate (all off) captures the target\'s own top-level posts only', async () => {
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [
          raw({ id: '1', isReply: false, isRepost: false }),
          raw({ id: '2', isReply: true }),
          raw({ id: '3', username: 'someoneElse', isRepost: true }),
        ],
      }),
    );
    expect(DEFAULT_COLLECT).toEqual({ replies: false, reposts: false, comments: false });
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0]!.messageId).toBe('1');
  });
});

// ---- 4. captureTimeline: challenge gate + dual persistence + provenance ---

describe('captureTimeline', () => {
  it('a challenge/blocked page → NOTHING captured, NOTHING persisted', async () => {
    const runCapture = vi.fn(async () => [raw()]);
    const savePosts = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        guard: async () => ({ blocked: true, reason: 'X presented a verification challenge.' }),
        runCapture,
        savePosts,
        saveItems,
      }),
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('X presented a verification challenge.');
    expect(res.posts).toEqual([]);
    expect(runCapture).not.toHaveBeenCalled();
    expect(savePosts).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
  });

  it('persists to BOTH sidecars: the plain HarvestedItem store AND the richer XPostArtifact store', async () => {
    const savePosts = vi.fn(async (_caseId: string, posts: unknown[]) => ({ added: posts.length, skipped: 0 }));
    const saveItems = vi.fn(async (_caseId: string, items: unknown[]) => ({ added: items.length, skipped: 0 }));
    const res = await captureTimeline(WIN, REQ, deps({ savePosts, saveItems }));
    expect(savePosts).toHaveBeenCalledTimes(1);
    expect(saveItems).toHaveBeenCalledTimes(1);
    expect(savePosts.mock.calls[0]![0]).toBe('case-a');
    expect(saveItems.mock.calls[0]![0]).toBe('case-a');
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it('re-capturing the SAME visible post dedupes (store-level dedup by id) — save reports skipped, not a duplicate row', async () => {
    let stored: Array<{ id: string }> = [];
    const savePosts = vi.fn(async (_c: string, posts: Array<{ id: string }>) => {
      let added = 0;
      let skipped = 0;
      for (const p of posts) {
        if (stored.some((s) => s.id === p.id)) skipped++;
        else {
          stored.push(p);
          added++;
        }
      }
      return { added, skipped };
    });
    const first = await captureTimeline(WIN, REQ, deps({ savePosts }));
    const second = await captureTimeline(WIN, REQ, deps({ savePosts }));
    expect(first.added).toBe(1);
    expect(first.skipped).toBe(0);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it('stamps harvestedAt from the INJECTED clock and provenance from the collector version', async () => {
    const res = await captureTimeline(WIN, REQ, deps());
    expect(res.posts[0]!.harvestedAt).toBe('2026-08-11T12:00:00.000Z');
    expect(res.posts[0]!.provenance).toEqual({
      collectorVersion: X_COLLECTOR_VERSION,
      jobId: 'job-1',
      caseId: 'case-a',
    });
  });

  it('runs the STATIC X_POST_SCRIPT (no other payload) against the capture window', async () => {
    const runCapture = vi.fn(async (_win: unknown, js: string) => {
      expect(js).toBe(X_POST_SCRIPT);
      return [raw()];
    });
    await captureTimeline(WIN, REQ, deps({ runCapture }));
    expect(runCapture).toHaveBeenCalledTimes(1);
  });

  it('an ill-typed/empty capture result never throws — treated as zero posts', async () => {
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => undefined,
        savePosts: async (_c, posts) => ({ added: posts.length, skipped: 0 }),
        saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.posts).toEqual([]);
    expect(res.added).toBe(0);
  });
});

// ---- 5. Task 15(c): post-media resolved via resolveMedia -> mediaRefs -----

describe('captureTimeline: post-media resolution (Task 15 gap closure)', () => {
  it('resolves each raw.media URL via resolveMedia and folds the LOCAL refs onto the artifact', async () => {
    const resolveMedia = vi.fn(async (_win: unknown, url: string, caseId: string) =>
      `x-media/${caseId}-${url.split('/').pop()}`,
    );
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [raw({ media: ['https://pbs.twimg.com/media/a.jpg', 'https://pbs.twimg.com/media/b.jpg'] })],
        resolveMedia,
      }),
    );
    expect(resolveMedia).toHaveBeenCalledWith(WIN, 'https://pbs.twimg.com/media/a.jpg', 'case-a');
    expect(resolveMedia).toHaveBeenCalledWith(WIN, 'https://pbs.twimg.com/media/b.jpg', 'case-a');
    expect(res.posts[0]!.mediaRefs).toEqual(['x-media/case-a-a.jpg', 'x-media/case-a-b.jpg']);
    // never a remote http(s) URL on the stored artifact
    expect(res.posts[0]!.mediaRefs!.every((r) => !r.startsWith('http'))).toBe(true);
  });

  it('a failed media resolution (null) is dropped, never leaves a remote URL or a hole', async () => {
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [raw({ media: ['https://pbs.twimg.com/media/a.jpg'] })],
        resolveMedia: async () => null,
      }),
    );
    expect(res.posts[0]!.mediaRefs).toBeUndefined();
  });

  it('no media on the raw post -> mediaRefs stays undefined (never an empty array on the wire)', async () => {
    const res = await captureTimeline(WIN, REQ, deps({ runCapture: async () => [raw({ media: [] })] }));
    expect(res.posts[0]!.mediaRefs).toBeUndefined();
  });

  it('an already-local data: media entry is passed through without calling resolveMedia', async () => {
    const resolveMedia = vi.fn();
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [raw({ media: ['data:image/png;base64,AAAA'] })],
        resolveMedia,
      }),
    );
    expect(resolveMedia).not.toHaveBeenCalled();
    expect(res.posts[0]!.mediaRefs).toEqual(['data:image/png;base64,AAAA']);
  });

  it('mediaRefs are folded into the evidence hash — a changed set of refs changes evidenceHash', async () => {
    const a = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [raw({ media: ['https://pbs.twimg.com/media/a.jpg'] })],
        resolveMedia: async () => 'x-media/hash-a',
      }),
    );
    const b = await captureTimeline(
      WIN,
      REQ,
      deps({
        runCapture: async () => [raw({ media: ['https://pbs.twimg.com/media/a.jpg'] })],
        resolveMedia: async () => 'x-media/hash-b',
      }),
    );
    expect(a.posts[0]!.evidenceHash).not.toBe(b.posts[0]!.evidenceHash);
  });

  it('the DEFAULT resolveMedia (no override) routes through media.ts cacheRemoteMedia, scoped to req.caseId', async () => {
    vi.resetModules();
    vi.doMock('../src/main/x-listening/media', () => ({
      cacheRemoteMedia: vi.fn(async (_win: unknown, url: string, caseId: string) => ({
        ref: `x-media/${caseId}:${url}`,
        sha256: 'deadbeef',
      })),
    }));
    const { captureTimeline: captureTimelineFresh } = await import('../src/main/x-listening/capture');
    const res = await captureTimelineFresh(
      WIN,
      REQ,
      // Deliberately omit resolveMedia — exercise the production default.
      {
        guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
        runCapture: async () => [raw({ media: ['https://pbs.twimg.com/media/a.jpg'] })],
        savePosts: async () => ({ added: 1, skipped: 0 }),
        saveItems: async () => ({ added: 1, skipped: 0 }),
        now: () => '2026-08-11T12:00:00.000Z',
      },
    );
    expect(res.posts[0]!.mediaRefs).toEqual(['x-media/case-a:https://pbs.twimg.com/media/a.jpg']);
    vi.doUnmock('../src/main/x-listening/media');
    vi.resetModules();
  });
});
