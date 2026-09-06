// @vitest-environment node
/**
 * The sweep must let the profile page render before it reads the header — that header is where the
 * display picture comes from.
 *
 * THE BUG THIS EXISTS TO CATCH (GhostExodus: "it's reverted back to extracting no profile/display
 * photos", after confirming the same feature working one release earlier).
 *
 * Nothing in the release between those two reports touches picture collection. What changes between
 * runs is TIMING, and timing here is unguarded:
 *
 *   - HIS `scrapeProfile` does `loadURL` → `sleep(3500)` → `assertSignedInPage` →
 *     `readProfileMetadata` (main.cjs). The settle is the first thing after navigation.
 *   - Ours calls `deps.readProfileMeta(win)` as the FIRST statement inside the guard, with no
 *     settle at all. On a slow render it reads a page whose header has not painted, so
 *     `avatar` comes back empty and the profile record is stored without a picture.
 *
 * The manual path hid this: `navigateXToProfile` polls until `articles > 0` before handing the
 * window over, so a manual refresh waits and a sweep does not — which is exactly why the same
 * feature looks fixed one day and broken the next, with no code change in between. The timeline
 * loop's own comment already names the asymmetry: "the sweep/archive path has no article>0
 * pre-wait that navigateXToProfile gives the manual path".
 */
import { describe, expect, it } from 'vitest';
import { captureTimeline, TIMELINE_SETTLE_MS, type XCaptureDeps } from '../src/main/x-listening/capture';
import { DEFAULT_COLLECTION_SETTINGS } from '../src/main/x-listening/collection-settings';

const WIN = {} as unknown as Electron.BrowserWindow;
const REQ = {
  caseId: '11111111-2222-4333-8444-555555555555',
  channelId: 'target', channelLabel: 'target', targetUsername: 'target',
} as never;

/** A profile page whose header paints only after it has had time to render. */
function harness() {
  const state = { elapsed: 0, headerReadAt: -1 };
  const over: Partial<XCaptureDeps> = {
    runCapture: async () => [],
    guard: async (_w, capture) => ({ blocked: false, result: await capture() }),
    savePosts: async () => ({ added: 0, skipped: 0 }),
    saveItems: async () => ({ added: 0, skipped: 0 }),
    resolveMedia: async () => null,
    imagesEnabledForSource: async () => true,
    recordRun: async () => {},
    loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 1, delayPerPassMs: 0 }),
    scroll: async () => {},
    assertSignedIn: async () => ({ blocked: false }),
    delay: async (ms: number) => { state.elapsed += ms; },
    now: () => '2026-09-06T12:00:00.000Z',
    readProfileMeta: async () => {
      state.headerReadAt = state.elapsed;
      // An unpainted header yields nothing — which is how a source loses its picture.
      if (state.elapsed < TIMELINE_SETTLE_MS) return null;
      return { displayName: 'Target', bio: '', location: '', website: '', avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg' };
    },
    snapshotProfile: async () => ({ changed: false }) as never,
  };
  return { over, state };
}

describe('captureTimeline settles before reading the profile header', () => {
  it('does not read the header until the page has had time to paint', async () => {
    const { over, state } = harness();
    await captureTimeline(WIN, REQ, over as never);

    expect(state.headerReadAt, 'the header must not be read in the same tick as navigation').toBeGreaterThanOrEqual(
      TIMELINE_SETTLE_MS,
    );
  });

  it('so the display picture is actually observed', async () => {
    const { over, state } = harness();
    let captured: { avatar?: string } | null = null;
    await captureTimeline(WIN, REQ, {
      ...over,
      snapshotProfile: (async (_c: string, input: { avatar?: string }) => {
        captured = input;
        return { changed: false };
      }) as never,
    } as never);

    expect(state.headerReadAt).toBeGreaterThanOrEqual(TIMELINE_SETTLE_MS);
    expect(captured, 'a header read too early yields no snapshot at all').not.toBeNull();
    expect(captured!.avatar, 'this is the display picture').toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
  });
});
