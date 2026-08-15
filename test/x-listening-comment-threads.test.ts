/**
 * FA3 — comment-thread scraping (audit HIGH #3).
 *
 * Pins the restored Enterprise `scrapeCommentsForPosts` behaviour (`electron/main.cjs:1603-1632`)
 * rebuilt into `captureTimeline` (capture.ts) on the hardened seams:
 *
 *  1. when the campaign's collect gate has COMMENTS on, after the timeline pass the SAME hidden,
 *     Tor-gated window is navigated to each captured ROOT post's thread (up to
 *     `commentThreadsPerSource`), scrolled `commentScrollPasses` passes, and the THIRD-PARTY replies
 *     are recorded as `kind:'comment'` linked to the root via `parentPostId` (the bare root status id);
 *  2. the root post itself and the target's OWN replies under it are excluded (they are captured on the
 *     timeline, not as "comments");
 *  3. with COMMENTS off nothing is navigated and no comment is produced (the previous dead-toggle state);
 *  4. every thread URL is host-anchored + validated (`assertValidPostUrl`) BEFORE navigation — an
 *     off-host captured permalink is canonicalized to `https://x.com/<user>/status/<id>` and an
 *     unparseable status id is SKIPPED, never loaded.
 *
 * All seams are injected (settings, navigate, scroll, delay, guard, persistence, clock) — no electron,
 * no network, no real timers.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  captureTimeline,
  type XTimelineCaptureRequest,
  type XCaptureDeps,
} from '../src/main/x-listening/capture';
import type { RawPost } from '../src/main/x-listening/extract';
import type { XRunLogRecord } from '../src/main/x-listening/store';
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/x-listening-collection-settings';

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
  media: [],
  ...o,
});

const REQ: XTimelineCaptureRequest = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target timeline',
  targetUsername: 'target',
};

const COMMENTS_ON = { replies: false, reposts: false, comments: true };
const COMMENTS_OFF = { replies: false, reposts: false, comments: false };

/** Baseline injected deps: signed-in guard, no-op persistence/scroll/delay/navigate, deterministic
 *  clock, and a low-depth settings loader (1 profile pass, 1 comment pass) each test can override. */
function deps(over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    savePosts: async (_c, posts) => ({ added: posts.length, skipped: 0 }),
    saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
    resolveMedia: async () => null,
    recordRun: async () => {},
    loadCollectionSettings: () => ({
      ...DEFAULT_COLLECTION_SETTINGS,
      profileScrollPasses: 1,
      delayPerPassMs: 0,
      commentThreadsPerSource: 3,
      commentScrollPasses: 1,
    }),
    scroll: async () => {},
    navigate: async () => {},
    assertSignedIn: async () => ({ blocked: false }),
    delay: async () => {},
    now: () => '2026-08-14T12:00:00.000Z',
    ...over,
  };
}

describe('FA3 — comment-thread scraping', () => {
  it('COMMENTS on → navigates each root post thread and records THIRD-PARTY replies as kind:comment + parentPostId', async () => {
    const timeline = [raw({ id: '100', url: 'https://x.com/target/status/100' })];
    const thread100 = [
      raw({ id: '100', url: 'https://x.com/target/status/100' }), // the root itself → excluded
      raw({ id: '200', username: 'other', url: 'https://x.com/other/status/200', text: 'a third-party reply' }),
      raw({ id: '201', username: 'target', url: 'https://x.com/target/status/201', text: "target's own reply" }), // excluded
    ];
    let currentUrl = '';
    const navigate = vi.fn(async (_w: Electron.BrowserWindow, url: string) => {
      currentUrl = url;
    });
    const runCapture = vi.fn(async () => (currentUrl.includes('/status/100') ? thread100 : timeline));
    let record: XRunLogRecord | undefined;

    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: COMMENTS_ON },
      deps({ runCapture, navigate, recordRun: async (_c, r) => { record = r; } }),
    );

    // Navigated exactly once, to the root post's validated thread URL.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(WIN, 'https://x.com/target/status/100');

    const posts = res.posts.filter((p) => p.kind === 'post');
    const comments = res.posts.filter((p) => p.kind === 'comment');
    expect(posts).toHaveLength(1);
    expect(comments).toHaveLength(1);
    // Only the third party's reply survives — the root post and the target's own reply are excluded.
    expect(comments[0].authorHandle).toBe('@other');
    expect(comments[0].text).toBe('a third-party reply');
    // Linked to the root by its BARE status id.
    expect(comments[0].parentPostId).toBe('100');
    // A root post never carries lineage.
    expect(posts[0].parentPostId).toBeNull();

    // The comment is persisted ALONGSIDE the timeline post (same upsert) — observed/added count both.
    expect(res.posts).toHaveLength(2);
    expect(res.added).toBe(2);
    expect(record?.observed).toBe(2);
  });

  it('COMMENTS off → the thread is NEVER navigated and no comment is produced (dead-toggle state gone)', async () => {
    const timeline = [raw({ id: '100', url: 'https://x.com/target/status/100' })];
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => timeline);

    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: COMMENTS_OFF },
      deps({ runCapture, navigate }),
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(res.posts.filter((p) => p.kind === 'comment')).toHaveLength(0);
    expect(res.posts.every((p) => p.kind === 'post')).toBe(true);
  });

  it('validates the thread URL before navigation — an OFF-HOST captured permalink is canonicalized to x.com, never loaded raw', async () => {
    // The root post was captured with an off-host permalink (which `guardXPermalink` blanks). The
    // comment path must reach `deps.navigate` with the SAFE canonical `https://x.com/<user>/status/<id>`
    // fallback (host-anchored + `/status/<digits>`), never the off-host string.
    const timeline = [raw({ id: '100', username: 'target', url: 'https://evil.example.com/target/status/100' })];
    const thread100 = [
      raw({ id: '200', username: 'other', url: 'https://x.com/other/status/200', text: 'reply after redirect' }),
    ];
    let currentUrl = '';
    const navigate = vi.fn(async (_w: Electron.BrowserWindow, url: string) => {
      currentUrl = url;
    });
    const runCapture = vi.fn(async () => (currentUrl.includes('/status/100') ? thread100 : timeline));

    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: COMMENTS_ON },
      deps({ runCapture, navigate }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    // Host-anchored canonical URL, never the off-host raw.
    expect(navigate.mock.calls[0][1]).toBe('https://x.com/target/status/100');
    expect(navigate.mock.calls[0][1]).not.toContain('evil.example.com');
    // The flow continued against the safe URL and captured the third-party reply.
    expect(res.posts.filter((p) => p.kind === 'comment').map((c) => c.authorHandle)).toEqual(['@other']);
  });

  it('a root post with an UNPARSEABLE status id is skipped — never navigated to (validated OUT)', async () => {
    // A defensive case: a captured post whose id is not a numeric status id yields no valid `/status/<digits>`
    // thread URL, so `assertValidPostUrl` throws and the thread is skipped BEFORE any navigation.
    const timeline = [raw({ id: 'not-a-number', username: 'target', url: 'https://evil.example.com/x' })];
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => timeline);

    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: COMMENTS_ON },
      deps({ runCapture, navigate }),
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(res.posts.filter((p) => p.kind === 'comment')).toHaveLength(0);
  });

  it('a challenge on the thread page STOPS the comment phase (fail closed) — the timeline post is still kept', async () => {
    const timeline = [raw({ id: '100', url: 'https://x.com/target/status/100' })];
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => timeline);
    // Signed-in through the whole timeline loop, then the thread page presents a challenge.
    let calls = 0;
    const assertSignedIn = vi.fn(async () => {
      calls += 1;
      // The timeline loop calls assertSignedIn once (after its single scroll); the thread check is next.
      return calls >= 2 ? { blocked: true, reason: 'X presented a verification challenge.' } : { blocked: false };
    });

    const res = await captureTimeline(
      WIN,
      { ...REQ, collect: COMMENTS_ON },
      deps({ runCapture, navigate, assertSignedIn }),
    );

    // Navigation to the thread happened, but the blocked re-assertion stopped scraping it.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(res.posts.filter((p) => p.kind === 'comment')).toHaveLength(0);
    // The timeline capture itself is unaffected — the root post is still returned/persisted.
    expect(res.blocked).toBe(false);
    expect(res.posts.filter((p) => p.kind === 'post')).toHaveLength(1);
  });
});
