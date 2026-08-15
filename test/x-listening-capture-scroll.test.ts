/**
 * FA1 — the scroll-and-accumulate timeline capture (master-regression fix).
 *
 * Pins the restored Enterprise `scrapeProfile` behaviour (`electron/main.cjs:1665-1695`) rebuilt into
 * `captureTimeline` (capture.ts) on the hardened seams:
 *
 *  1. the capture runs `X_POST_SCRIPT` ONCE PER PASS, `profileScrollPasses` passes, reading the
 *     visible items each pass and ACCUMULATING them by Enterprise's `${id}:${repost|tweet}` key — so a
 *     campaign that scrolls 3 passes collects the union of all three viewports, not the first one;
 *  2. between passes (never after the last) it scrolls to the bottom + awaits `delayPerPassMs`;
 *  3. it stops early after 5 consecutive no-growth passes (a stable end);
 *  4. the run-log record reports the REAL requested/completed passes + reachedEnd (no longer the old
 *     hardcoded 1/1/true);
 *  5. an explicit `req.passes` override (the FA2 archive-depth seam) beats the persisted setting;
 *  6. the whole loop stays inside the signed-in guard — a challenge fails closed, capturing nothing.
 *
 * All seams are injected (settings, scroll, delay, guard, persistence, clock) — no electron, no
 * network, no real timers.
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

/** Baseline injected deps: signed-in guard, no-op persistence/scroll/delay, deterministic clock, and
 *  a settings loader the individual tests override with the pass budget under test. */
function deps(over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    savePosts: async (_c, posts) => ({ added: posts.length, skipped: 0 }),
    saveItems: async (_c, items) => ({ added: items.length, skipped: 0 }),
    resolveMedia: async () => null,
    recordRun: async () => {},
    loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 1, delayPerPassMs: 0 }),
    scroll: async () => {},
    // FA1 finding 1: the mid-scroll signed-in re-assertion. Baseline stays signed-in; the challenge
    // test overrides this to flip to blocked on a chosen pass.
    assertSignedIn: async () => ({ blocked: false }),
    delay: async () => {},
    now: () => '2026-08-11T12:00:00.000Z',
    ...over,
  };
}

describe('FA1 — scroll-and-accumulate timeline capture', () => {
  it('scrollPasses=3 runs X_POST_SCRIPT passes+1 (4) times and ACCUMULATES the union of all passes', async () => {
    // Each pass reveals a DIFFERENT post (as a real scroll would lazy-load new items). The captured
    // set must be the UNION across passes, not just the first viewport. FA1 finding 2: Enterprise
    // `scrapeProfile` loops `index=0..passes` ⇒ passes+1 reads / passes scrolls, so profileScrollPasses=3
    // is FOUR reads (the 4th sees an empty page here) and THREE scrolls.
    const pages = [
      [raw({ id: '100', url: 'https://x.com/target/status/100' })],
      [raw({ id: '101', url: 'https://x.com/target/status/101' })],
      [raw({ id: '102', url: 'https://x.com/target/status/102' })],
    ];
    const runCapture = vi.fn(async () => pages.shift() ?? []);
    const scroll = vi.fn(async () => {});
    const delay = vi.fn(async () => {});

    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 3, delayPerPassMs: 0 }),
        runCapture,
        scroll,
        delay,
      }),
    );

    expect(runCapture).toHaveBeenCalledTimes(4);
    expect(res.posts.map((p) => p.messageId).sort()).toEqual(['100', '101', '102']);
    // scroll + delay run BETWEEN passes only — passes+1 (4) reads ⇒ 3 gaps, never after the final read.
    expect(scroll).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(3);
  });

  it('accumulates by the ${id}:${repost|tweet} key — re-seeing the same post across passes dedupes to one', async () => {
    const runCapture = vi.fn(async () => [raw({ id: '100' }), raw({ id: '101', url: 'https://x.com/target/status/101' })]);
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 3, delayPerPassMs: 0 }),
        runCapture,
      }),
    );
    // Same two posts visible on every one of the passes+1 (4) reads → union is still exactly two.
    expect(runCapture).toHaveBeenCalledTimes(4);
    expect(res.posts.map((p) => p.messageId).sort()).toEqual(['100', '101']);
  });

  it('feeds delayPerPassMs from the campaign settings into the inter-pass delay', async () => {
    const delay = vi.fn(async () => {});
    await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 2, delayPerPassMs: 1500 }),
        runCapture: async () => [raw({ id: `${Math.random()}` })],
        delay,
      }),
    );
    // profileScrollPasses=2 ⇒ passes+1 (3) reads ⇒ 2 inter-pass gaps (FA1 finding 2).
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1500);
  });

  it('stops early after 5 consecutive stagnant passes even with a large budget', async () => {
    // The same single post is visible on every pass → no growth after pass 1. With a budget of 20 the
    // loop must stop once 5 consecutive passes add nothing: reads at passes 0..5 (6 reads), then breaks.
    const runCapture = vi.fn(async () => [raw({ id: '100' })]);
    const scroll = vi.fn(async () => {});
    let record: XRunLogRecord | undefined;

    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 20, delayPerPassMs: 0 }),
        runCapture,
        scroll,
        recordRun: async (_c, r) => {
          record = r;
        },
      }),
    );

    expect(runCapture).toHaveBeenCalledTimes(6); // pass 0 grows, passes 1..5 stagnant → stop
    expect(res.posts).toHaveLength(1);
    expect(record?.requestedPasses).toBe(20);
    expect(record?.completedPasses).toBe(6);
    expect(record?.reachedEnd).toBe(true);
    expect(record?.stopReason).toBe('stable_end');
  });

  it('run-log records the REAL requested/completed passes + reachedEnd on a full multi-pass run', async () => {
    // Distinct posts every pass ⇒ no stagnation ⇒ the loop runs the full budget and reachedEnd is
    // false (the pass ceiling was hit while content was still arriving — honestly "there may be more").
    let n = 200;
    const runCapture = vi.fn(async () => [raw({ id: `${n++}` })]);
    let record: XRunLogRecord | undefined;

    await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 4, delayPerPassMs: 0 }),
        runCapture,
        recordRun: async (_c, r) => {
          record = r;
        },
      }),
    );

    // FA1 finding 2: profileScrollPasses=4 ⇒ passes+1 (5) reads; completedPasses honors the +1.
    expect(runCapture).toHaveBeenCalledTimes(5);
    expect(record?.operation).toBe('posts');
    expect(record?.requestedPasses).toBe(4);
    expect(record?.completedPasses).toBe(5);
    expect(record?.observed).toBe(5);
    expect(record?.reachedEnd).toBe(false);
    expect(record?.stopReason).toBe('pass_limit');
  });

  it('an explicit req.passes override beats the persisted profileScrollPasses (FA2 archive-depth seam)', async () => {
    const runCapture = vi.fn(async () => [raw({ id: `${Math.random()}` })]);
    await captureTimeline(
      WIN,
      { ...REQ, passes: 2 },
      deps({
        // Campaign says 10 passes, but the caller (archive cycle) overrides to 2.
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 10, delayPerPassMs: 0 }),
        runCapture,
      }),
    );
    // req.passes=2 overrides the persisted 10 ⇒ passes+1 (3) reads (FA1 finding 2).
    expect(runCapture).toHaveBeenCalledTimes(3);
  });

  it('the scroll-and-accumulate loop stays INSIDE the guard — a challenge captures & scrolls NOTHING', async () => {
    const runCapture = vi.fn(async () => [raw()]);
    const scroll = vi.fn(async () => {});
    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        guard: async () => ({ blocked: true, reason: 'X presented a verification challenge.' }),
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 5, delayPerPassMs: 0 }),
        runCapture,
        scroll,
      }),
    );
    expect(res.blocked).toBe(true);
    expect(runCapture).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a blocked capture logs the REAL requested passes with completedPasses:0', async () => {
    let record: XRunLogRecord | undefined;
    await captureTimeline(
      WIN,
      REQ,
      deps({
        guard: async () => ({ blocked: true, reason: 'blocked' }),
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 7, delayPerPassMs: 0 }),
        recordRun: async (_c, r) => {
          record = r;
        },
      }),
    );
    expect(record?.status).toBe('error');
    expect(record?.requestedPasses).toBe(7);
    expect(record?.completedPasses).toBe(0);
    expect(record?.reachedEnd).toBe(false);
  });

  it('a challenge surfacing MID-SCROLL stops the loop and logs an ERROR run, not a clean stable end', async () => {
    // FA1 finding 1: the up-front guard passes (initial page is signed in), but the session drops / a
    // verification challenge appears after pass 3's scroll. Enterprise `scrapeProfile` re-checks
    // `assertSignedInPage` after every scroll (`main.cjs:1690`); ours must too — stop scraping the
    // flagged page and record the sweep HONESTLY as an error, never as complete/stable_end. Distinct
    // posts each read so, absent the challenge, the loop would run the full 10-pass budget.
    let n = 500;
    const runCapture = vi.fn(async () => [raw({ id: `${n++}` })]);
    const scroll = vi.fn(async () => {});
    // assertSignedIn is called after each scroll+delay. Block on the 3rd mid-scroll check.
    let assertCalls = 0;
    const assertSignedIn = vi.fn(async () => {
      assertCalls += 1;
      return assertCalls >= 3
        ? { blocked: true, reason: 'X presented a verification challenge.' }
        : { blocked: false };
    });
    let record: XRunLogRecord | undefined;

    const res = await captureTimeline(
      WIN,
      REQ,
      deps({
        loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 10, delayPerPassMs: 0 }),
        runCapture,
        scroll,
        assertSignedIn,
        savePosts: vi.fn(async () => ({ added: 0, skipped: 0 })),
        saveItems: vi.fn(async () => ({ added: 0, skipped: 0 })),
        recordRun: async (_c, r) => {
          record = r;
        },
      }),
    );

    // The capture is surfaced as blocked and NOTHING is persisted (partial discarded).
    expect(res.blocked).toBe(true);
    expect(res.posts).toEqual([]);
    expect(res.added).toBe(0);
    // reads: passes 0,1,2 (3 reads); each is followed by a scroll then a mid-scroll assert, and the
    // 3rd assert (after pass 2's scroll) blocks — so pass 3's read never happens.
    expect(runCapture).toHaveBeenCalledTimes(3);
    // The loop did NOT keep scrolling the flagged page for the remaining budget (would be 10 scrolls).
    expect(scroll).toHaveBeenCalledTimes(3);
    // The run is logged as an ERROR with the challenge stop reason — NOT complete/stable_end.
    expect(record?.status).toBe('error');
    expect(record?.stopReason).toBe('challenge');
    expect(record?.reachedEnd).toBe(false);
    expect(record?.observed).toBe(0);
    expect(record?.added).toBe(0);
    expect(record?.requestedPasses).toBe(10);
    expect(record?.completedPasses).toBe(3);
  });
});
