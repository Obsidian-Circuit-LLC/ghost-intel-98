/**
 * X4 — Replies / reposts / third-party comments (kinds + collect gate).
 *
 * Ported from the quarantine `scrapeProfile` / `scrapeCommentsForPosts` logic
 * (`electron/main.cjs:504-574`, `:472-500`), split into PURE pieces plus the
 * orchestration seam so both the honesty stamps AND the collect-toggle gate are
 * tested without electron or the network:
 *
 *  1. `normalizeReply` / `normalizeRepost` / `normalizeComment` map a captured-DOM
 *     item → an `XHarvestedItem` tagged by `kind`, carrying the SAME honesty
 *     guarantees X3 established (verbatim text, `verified:false`,
 *     `captureProvenance:'visible-capture'`, `data:`-only media). A comment also
 *     records the target root post it was seen under (`parentId`) — honest lineage,
 *     never a fabricated "in reply to".
 *
 *  2. `selectTimelineCaptures` is the profile-timeline gate: a target's own top-level
 *     post is ALWAYS captured; a target reply only when `collect.replies`; a
 *     someone-else repost only when `collect.reposts`; a non-target, non-repost item
 *     is skipped (it is not the target's speech).
 *
 *  3. `selectThreadComments` is the third-party-comment gate: empty unless
 *     `collect.comments`; excludes the root post itself and the target's own replies
 *     (those are the target's speech, captured on the timeline — not "comments").
 *
 *  4. The orchestration seams (`captureVisibleTimeline`, `captureThreadComments`)
 *     honour the toggles end-to-end: a kind whose toggle is OFF is neither
 *     normalized nor persisted (the v3.24.2 collect-path seam class).
 *
 * The pure block imports extract.ts WITHOUT mocking electron — proving the
 * kind/gate logic stays quarantine-clean (no electron/main-process edge).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  normalizeReply,
  normalizeRepost,
  normalizeComment,
  selectTimelineCaptures,
  selectThreadComments,
  type RawPost,
  type NormalizeContext,
  type XCollectSettings,
} from '../src/main/x-listening/extract';

const CTX: NormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'x-listening/1.0.0',
  harvestedAt: '2026-08-06T12:00:00.000Z',
  channelId: 'target',
  channelLabel: '@target timeline',
};

const ALL_OFF: XCollectSettings = { replies: false, reposts: false, comments: false };

const raw = (o: Partial<RawPost> = {}): RawPost => ({
  id: '100',
  username: 'target',
  url: 'https://x.com/target/status/100',
  text: 'body <b>x</b> & more',
  createdAt: '2026-08-06T11:00:00.000Z',
  isReply: false,
  isRepost: false,
  socialContext: '',
  metricsRaw: { replies: '1', reposts: '0', likes: '1.2K', views: '3K' },
  media: ['data:image/png;base64,AAAA'],
  ...o,
});

// ---- 1. kind-tagged normalizers (honesty preserved) --------------------

describe('kind-tagged normalizers', () => {
  it('normalizeReply tags kind:"reply" and keeps the X3 honesty stamps', () => {
    const item = normalizeReply(raw({ isReply: true }), CTX);
    expect(item.kind).toBe('reply');
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.platform).toBe('x');
    // text is preserved verbatim; escaping is a render concern (X3 invariant)
    expect(item.text).toBe('body <b>x</b> & more');
    // rounded metric honesty carries over
    expect(item.metrics.likes.approx).toBe(true);
    // data:-only media
    expect(item.media.every((m) => m.startsWith('data:'))).toBe(true);
  });

  it('normalizeRepost tags kind:"repost" and records the ORIGINAL author (honest)', () => {
    const item = normalizeRepost(
      raw({ username: 'someone_else', url: 'https://x.com/someone_else/status/555', id: '555' }),
      CTX,
    );
    expect(item.kind).toBe('repost');
    expect(item.authorHandle).toBe('@someone_else'); // the account that actually wrote it
    expect(item.authorId).toBe('someone_else');
    // still filed under the observed target's channel
    expect(item.channelId).toBe('target');
    expect(item.verified).toBe(false);
  });

  it('normalizeComment tags kind:"comment" and links the target root post via parentId', () => {
    const item = normalizeComment(
      raw({ username: 'third_party', id: '999', url: 'https://x.com/third_party/status/999' }),
      CTX,
      '100',
    );
    expect(item.kind).toBe('comment');
    expect(item.parentId).toBe('100');
    expect(item.authorHandle).toBe('@third_party');
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.verified).toBe(false);
    // no remote media ever stored
    expect(item.media.some((m) => m.startsWith('http'))).toBe(false);
  });

  it('a non-comment item carries no parentId', () => {
    expect(normalizeReply(raw({ isReply: true }), CTX).parentId).toBeUndefined();
    expect(normalizeRepost(raw({ username: 'x' }), CTX).parentId).toBeUndefined();
  });
});

// ---- 2. timeline gate (replies / reposts / posts) ----------------------

describe('selectTimelineCaptures: collect gate on the profile timeline', () => {
  it('a target top-level post is ALWAYS captured, regardless of toggles', () => {
    const sel = selectTimelineCaptures([raw()], 'target', ALL_OFF);
    expect(sel.map((s) => s.kind)).toEqual(['post']);
  });

  it('a target reply is captured ONLY when collect.replies is on', () => {
    const reply = raw({ id: '200', isReply: true, url: 'https://x.com/target/status/200' });
    expect(selectTimelineCaptures([reply], 'target', ALL_OFF)).toEqual([]);
    const on = selectTimelineCaptures([reply], 'target', { ...ALL_OFF, replies: true });
    expect(on.map((s) => s.kind)).toEqual(['reply']);
  });

  it('a someone-else repost is captured ONLY when collect.reposts is on', () => {
    const repost = raw({
      id: '300',
      username: 'other',
      url: 'https://x.com/other/status/300',
      isRepost: true,
      socialContext: 'target reposted',
    });
    expect(selectTimelineCaptures([repost], 'target', ALL_OFF)).toEqual([]);
    const on = selectTimelineCaptures([repost], 'target', { ...ALL_OFF, reposts: true });
    expect(on.map((s) => s.kind)).toEqual(['repost']);
  });

  it('a non-target, non-repost item is never captured (not the target\'s speech)', () => {
    const stray = raw({ id: '400', username: 'stranger', url: 'https://x.com/stranger/status/400' });
    expect(selectTimelineCaptures([stray], 'target', { replies: true, reposts: true, comments: true })).toEqual([]);
  });

  it('handle comparison ignores a leading @ and case', () => {
    const post = raw({ username: 'Target' });
    expect(selectTimelineCaptures([post], '@target', ALL_OFF).map((s) => s.kind)).toEqual(['post']);
  });

  it('mixes kinds under a fully-on config in one pass', () => {
    const items = [
      raw({ id: '1', username: 'target', url: 'https://x.com/target/status/1' }),
      raw({ id: '2', username: 'target', isReply: true, url: 'https://x.com/target/status/2' }),
      raw({ id: '3', username: 'other', isRepost: true, socialContext: 'target reposted', url: 'https://x.com/other/status/3' }),
      raw({ id: '4', username: 'stranger', url: 'https://x.com/stranger/status/4' }),
    ];
    const sel = selectTimelineCaptures(items, 'target', { replies: true, reposts: true, comments: true });
    expect(sel.map((s) => s.kind)).toEqual(['post', 'reply', 'repost']);
  });
});

// ---- 3. third-party comment gate ---------------------------------------

describe('selectThreadComments: third-party comment gate', () => {
  const rootId = '100';
  const thread = [
    raw({ id: '100', username: 'target', url: 'https://x.com/target/status/100' }), // the root post
    raw({ id: '100', username: 'target', url: 'https://x.com/target/status/100' }), // duplicate of root
    raw({ id: '101', username: 'target', isReply: true, url: 'https://x.com/target/status/101' }), // target's own reply
    raw({ id: '102', username: 'stranger', isReply: true, url: 'https://x.com/stranger/status/102' }), // third-party comment
    raw({ id: '103', username: 'Another', isReply: true, url: 'https://x.com/Another/status/103' }), // third-party comment
  ];

  it('returns nothing when collect.comments is off', () => {
    expect(selectThreadComments(thread, 'target', rootId, ALL_OFF)).toEqual([]);
  });

  it('captures ONLY third-party replies — excludes the root post and the target\'s own replies', () => {
    const comments = selectThreadComments(thread, 'target', rootId, { ...ALL_OFF, comments: true });
    expect(comments.map((c) => c.id)).toEqual(['102', '103']);
    // none of them is the target's own speech
    expect(comments.some((c) => c.username.toLowerCase() === 'target')).toBe(false);
  });
});

// ---- 4. orchestration seams honour the toggles end-to-end --------------

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));

describe('captureVisibleTimeline: collect toggles gate the live path', () => {
  it('a reply is neither normalized nor persisted when collect.replies is off', async () => {
    const { captureVisibleTimeline } = await import('../src/main/x-listening/ipc');
    const saveItems = vi.fn(async (_c: string, items: unknown[]) => ({ added: items.length, skipped: 0 }));
    const res = await captureVisibleTimeline(
      { } as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        collect: { replies: false, reposts: false, comments: false },
      },
      {
        guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
        runCapture: async () => [raw({ id: '9', isReply: true, url: 'https://x.com/target/status/9' })],
        resolveMedia: async () => 'data:image/jpeg;base64,ZZZ',
        saveItems,
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(res.items).toEqual([]);
    expect(saveItems).toHaveBeenCalledWith('case-a', []);
  });

  it('captures a reply as kind:"reply" when collect.replies is on', async () => {
    const { captureVisibleTimeline } = await import('../src/main/x-listening/ipc');
    const res = await captureVisibleTimeline(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        collect: { replies: true, reposts: false, comments: false },
      },
      {
        guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
        runCapture: async () => [raw({ id: '9', isReply: true, url: 'https://x.com/target/status/9' })],
        resolveMedia: async () => 'data:image/jpeg;base64,ZZZ',
        saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(res.items.map((i) => i.kind)).toEqual(['reply']);
  });
});

describe('captureThreadComments: comment gate end-to-end', () => {
  it('captures nothing (and never navigates or runs the payload) when collect.comments is off', async () => {
    const { captureThreadComments } = await import('../src/main/x-listening/ipc');
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => []);
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const res = await captureThreadComments(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        rootPostId: '100',
        rootPostUrl: 'https://x.com/target/status/100',
        collect: { replies: false, reposts: false, comments: false },
      },
      { navigate, runCapture, saveItems },
    );
    expect(res.added).toBe(0);
    expect(res.items).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
  });

  it('navigates the thread and persists ONLY third-party comments when collect.comments is on', async () => {
    const { captureThreadComments } = await import('../src/main/x-listening/ipc');
    const navigate = vi.fn(async () => {});
    let saved: { kind: string; parentId?: string }[] = [];
    const res = await captureThreadComments(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        rootPostId: '100',
        rootPostUrl: 'https://x.com/target/status/100',
        collect: { replies: false, reposts: false, comments: true },
      },
      {
        navigate,
        guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
        runCapture: async () => [
          raw({ id: '100', username: 'target', url: 'https://x.com/target/status/100' }),
          raw({ id: '101', username: 'target', isReply: true, url: 'https://x.com/target/status/101' }),
          raw({ id: '102', username: 'stranger', isReply: true, url: 'https://x.com/stranger/status/102' }),
        ],
        resolveMedia: async () => 'data:image/jpeg;base64,ZZZ',
        saveItems: async (_c, items) => {
          saved = items.map((i) => ({ kind: i.kind, parentId: i.parentId }));
          return { added: items.length, skipped: 0 };
        },
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([{ kind: 'comment', parentId: '100' }]);
    expect(res.added).toBe(1);
  });

  it('navigates the thread BEFORE the challenge-refusal guard probes it', async () => {
    // Regression: the guard must probe the LOADED thread page, not the pre-nav
    // page. Navigating into a thread is exactly when X throws a challenge; the
    // probe has to see it. We record call order — navigate must precede guard.
    const { captureThreadComments } = await import('../src/main/x-listening/ipc');
    const order: string[] = [];
    const navigate = vi.fn(async () => {
      order.push('navigate');
    });
    const guard = vi.fn(async (_win: unknown, capture: () => Promise<unknown>) => {
      order.push('guard');
      return { blocked: false, result: await capture() };
    });
    await captureThreadComments(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        rootPostId: '100',
        rootPostUrl: 'https://x.com/target/status/100',
        collect: { replies: false, reposts: false, comments: true },
      },
      {
        navigate,
        guard: guard as never,
        runCapture: async () => [],
        resolveMedia: async () => 'data:image/jpeg;base64,ZZZ',
        saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    expect(order).toEqual(['navigate', 'guard']);
  });

  it('STOPS on a challenge presented by the LOADED thread page — no capture, no persist', async () => {
    // With navigation moved ahead of the guard, a rate-limit / verification
    // interstitial thrown by the thread navigation is seen by the probe: the
    // guard returns blocked and the payload never runs. Honesty invariant intact.
    const { captureThreadComments } = await import('../src/main/x-listening/ipc');
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => []);
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const res = await captureThreadComments(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        rootPostId: '100',
        rootPostUrl: 'https://x.com/target/status/100',
        collect: { replies: false, reposts: false, comments: true },
      },
      {
        navigate,
        // The guard probes the loaded thread page and finds a challenge.
        guard: async () => ({
          blocked: true,
          reason: 'X presented a verification challenge or temporary limit.',
        }),
        runCapture,
        saveItems,
        now: () => '2026-08-06T12:00:00.000Z',
      },
    );
    // Navigation happened (it precedes the guard), but the challenge stopped
    // everything downstream: no payload run, nothing persisted, blocked reported.
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(res.blocked).toBe(true);
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
  });

  it('refuses to navigate an off-domain root URL (scheme/host guard)', async () => {
    const { captureThreadComments } = await import('../src/main/x-listening/ipc');
    const navigate = vi.fn(async () => {});
    const res = await captureThreadComments(
      {} as unknown as Electron.BrowserWindow,
      {
        caseId: 'case-a',
        jobId: 'job-1',
        channelId: 'target',
        channelLabel: '@target',
        rootPostId: '100',
        rootPostUrl: 'https://evil.example/target/status/100',
        collect: { replies: false, reposts: false, comments: true },
      },
      { navigate, guard: async (_win, capture) => ({ blocked: false, result: await capture() }) },
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(res.blocked).toBe(true);
  });
});
