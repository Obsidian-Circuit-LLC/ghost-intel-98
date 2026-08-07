/**
 * X3 — capture orchestration seam (`captureVisibleTimeline`).
 *
 * The pure normalizer is covered in x-listening-extract.test.ts; this pins the
 * wiring that ties it to the live window, the challenge-refusal gate, media
 * resolution, and the encrypted store — the seam class the v3.24.2 collect-path
 * bug taught us to test directly:
 *
 *  - challenge/blocked page → NOTHING captured, NOTHING persisted;
 *  - remote media resolved to `data:`, an unresolved remote URL DROPPED (no beacon);
 *  - normalized items handed to `saveItems`, its `{added,skipped}` propagated;
 *  - `harvestedAt` comes from the INJECTED clock, never a raw Date read.
 *
 * electron is mocked only because ipc.ts imports `session` at module load; the
 * orchestration itself is exercised through injected deps (no network, no window).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) }
}));

import {
  captureVisibleTimeline,
  X_COLLECTOR_VERSION,
  type CaptureRequest,
  type TimelineCaptureDeps
} from '../src/main/x-listening/ipc';
import { X_POST_SCRIPT, type RawPost, type XHarvestedItem } from '../src/main/x-listening/extract';

const REQ: CaptureRequest = {
  caseId: 'case-a',
  jobId: 'job-1',
  channelId: 'target',
  channelLabel: '@target timeline'
};

const raw = (o: Partial<RawPost> = {}): RawPost => ({
  id: '100',
  username: 'target',
  url: 'https://x.com/target/status/100',
  text: 'body',
  createdAt: '2026-08-06T11:00:00.000Z',
  isReply: false,
  isRepost: false,
  socialContext: '',
  metricsRaw: { replies: '1', reposts: '0', likes: '1.2K', views: '3K' },
  media: ['https://pbs.twimg.com/media/a.jpg'],
  ...o
});

// A window stand-in — deps are injected, so no real BrowserWindow is touched.
const WIN = {} as unknown as Electron.BrowserWindow;

function deps(over: Partial<TimelineCaptureDeps> = {}): Partial<TimelineCaptureDeps> {
  return {
    // pass-through gate: signed-in, unchallenged
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    navigate: async () => {},
    // Stub the post-navigation settle to a no-op so tests never incur the real wait.
    settle: async () => {},
    runCapture: async () => [raw()],
    resolveMedia: async () => 'data:image/jpeg;base64,ZZZ',
    saveItems: async () => ({ added: 1, skipped: 0 }),
    now: () => '2026-08-06T12:00:00.000Z',
    ...over
  };
}

describe('captureVisibleTimeline', () => {
  it('navigates to the TARGET profile BEFORE scraping (core-feature: not x.com/home)', async () => {
    const order: string[] = [];
    const navigate = vi.fn(async (_w: unknown, url: string) => {
      order.push(`nav:${url}`);
    });
    const runCapture = vi.fn(async () => {
      order.push('scrape');
      return [raw()];
    });
    await captureVisibleTimeline(
      WIN,
      { ...REQ, channelId: 'alice', channelLabel: '@alice' },
      deps({ navigate, runCapture })
    );
    // navigated to alice's profile, and BEFORE the scrape ran
    expect(navigate).toHaveBeenCalledWith(WIN, 'https://x.com/alice');
    expect(order).toEqual(['nav:https://x.com/alice', 'scrape']);
  });

  it('SETTLES after navigate and BEFORE the scrape (async-SPA under-capture race)', async () => {
    // loadURL resolves on did-finish-load, before x.com's async XHR paints the tweet
    // DOM — so the static scrape must wait for the visible set to render. Order must be
    // navigate → settle → scrape; if settle ran after (or not at all) the scrape reads a
    // not-yet-populated page and under-captures.
    const order: string[] = [];
    const navigate = vi.fn(async () => {
      order.push('navigate');
    });
    const settle = vi.fn(async () => {
      order.push('settle');
    });
    const runCapture = vi.fn(async () => {
      order.push('scrape');
      return [raw()];
    });
    await captureVisibleTimeline(
      WIN,
      { ...REQ, channelId: 'alice', channelLabel: '@alice' },
      deps({ navigate, settle, runCapture })
    );
    expect(settle).toHaveBeenCalledWith(WIN);
    expect(order).toEqual(['navigate', 'settle', 'scrape']);
  });

  it('refuses a non-handle channelId ("home") — no navigation, no scrape', async () => {
    // guardXPermalink only checks scheme/host; "home" would navigate to the NON-profile
    // x.com/home surface. The strict handle guard must refuse it (blocked), matching the
    // network path — never navigate, never scrape.
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => [raw()]);
    const res = await captureVisibleTimeline(
      WIN,
      { ...REQ, channelId: 'home', channelLabel: 'home' },
      deps({ navigate, runCapture })
    );
    expect(res.blocked).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(runCapture).not.toHaveBeenCalled();
  });

  it('refuses an invalid/off-domain target handle — no navigation, no scrape', async () => {
    const navigate = vi.fn(async () => {});
    const runCapture = vi.fn(async () => [raw()]);
    const res = await captureVisibleTimeline(
      WIN,
      { ...REQ, channelId: '', channelLabel: '@' },
      deps({ navigate, runCapture })
    );
    expect(res.blocked).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(runCapture).not.toHaveBeenCalled();
  });

  it('runs the STATIC timeline payload (never an interpolated string)', async () => {
    const runCapture = vi.fn(async () => [raw()]);
    await captureVisibleTimeline(WIN, REQ, deps({ runCapture }));
    expect(runCapture).toHaveBeenCalledWith(WIN, X_POST_SCRIPT);
    expect(String(runCapture.mock.calls[0][1]).includes('${')).toBe(false);
  });

  it('normalizes + persists captured posts, propagating the store tally', async () => {
    const saveItems = vi.fn(async () => ({ added: 1, skipped: 0 }));
    const res = await captureVisibleTimeline(WIN, REQ, deps({ saveItems }));

    expect(res.blocked).toBe(false);
    expect(res.added).toBe(1);
    const [caseId, items] = saveItems.mock.calls[0] as [string, XHarvestedItem[]];
    expect(caseId).toBe('case-a');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.verified).toBe(false);
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.metrics.likes.approx).toBe(true);
    expect(item.harvestedAt).toBe('2026-08-06T12:00:00.000Z'); // injected clock
    expect(item.provenance.collectorVersion).toBe(X_COLLECTOR_VERSION);
  });

  it('resolves remote media to data: and DROPS anything unresolved (no beacon)', async () => {
    let saved: XHarvestedItem[] = [];
    // first post media resolves; second post media fails to resolve → dropped
    const runCapture = async () => [
      raw({ id: '1', url: 'https://x.com/target/status/1', media: ['https://pbs.twimg.com/media/a.jpg'] }),
      raw({ id: '2', url: 'https://x.com/target/status/2', media: ['https://pbs.twimg.com/media/b.jpg'] })
    ];
    const resolveMedia = vi.fn(async (_w: unknown, url: string) =>
      url.endsWith('a.jpg') ? 'data:image/jpeg;base64,AAA' : null
    );
    const saveItems = async (_c: string, items: XHarvestedItem[]) => {
      saved = items;
      return { added: items.length, skipped: 0 };
    };
    await captureVisibleTimeline(WIN, REQ, deps({ runCapture, resolveMedia, saveItems }));

    expect(saved[0].media).toEqual(['data:image/jpeg;base64,AAA']);
    expect(saved[1].media).toEqual([]); // unresolved remote URL dropped, not stored
    for (const it of saved) {
      expect(it.media.some((m) => m.startsWith('http'))).toBe(false);
    }
  });

  it('refuses on a challenge/blocked page — nothing captured or persisted', async () => {
    const runCapture = vi.fn(async () => [raw()]);
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const res = await captureVisibleTimeline(
      WIN,
      REQ,
      deps({
        guard: async () => ({ blocked: true, reason: 'verification challenge' }),
        runCapture,
        saveItems
      })
    );

    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('verification');
    expect(res.items).toEqual([]);
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
  });
});
