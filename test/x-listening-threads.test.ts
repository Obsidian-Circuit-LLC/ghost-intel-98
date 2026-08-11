/**
 * X4 — Replies / reposts / third-party comments (kinds + collect gate, pure pieces).
 *
 * Ported from the quarantine `scrapeProfile` / `scrapeCommentsForPosts` logic
 * (`electron/main.cjs:504-574`, `:472-500`):
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
 * The orchestration seams that used to honour these toggles end-to-end against a live
 * capture window (`captureVisibleTimeline`/`captureThreadComments`, `ipc.ts`) were the
 * clearnet-only legacy surface retired wholesale at Task 16 — the equivalent end-to-end
 * collect-toggle coverage for the Tor-safe `captureTimeline` surface now lives in
 * `test/x-listening-capture.test.ts` (Task 4). This file imports extract.ts WITHOUT
 * mocking electron — proving the kind/gate logic stays quarantine-clean (no
 * electron/main-process edge).
 */
import { describe, it, expect } from 'vitest';

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
