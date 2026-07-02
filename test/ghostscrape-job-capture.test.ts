/**
 * GhostScrape (v3.27.0 W3) — runScrapeJob capture-failure orchestration.
 *
 * The pure isCaptureFailure() truth table is covered by ghostscrape-capture-surface.test.ts, but
 * nothing asserted that runScrapeJob actually THROWS GhostScrapeCaptureFailedError on a silent
 * capture failure (vs. resolving with a genuine result). A regression that dropped the honesty
 * check — reporting an expired-session empty as a silent success — would have stayed green.
 *
 * This drives runScrapeJob end-to-end with the browser/capture/parse collaborators mocked, using
 * a `type:'bio'` config (no scroll loop) and `delayMs:0` (delays resolve synchronously):
 *
 *   A. capture never delivered a matched response + no profile parsed -> REJECTS with
 *      GhostScrapeCaptureFailedError.
 *   B. capture attached + saw a matched response + a profile parsed -> RESOLVES (no throw).
 *
 * Both cases assert win.dispose() ran (the `finally` teardown that clears the session credentials).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScrapedProfile } from '../src/main/x/ghostscrape/types';

// Shared, hoisted mock state so the vi.mock factories (hoisted above the imports) can reach it.
const h = vi.hoisted(() => ({
  // raw has one element so runScrapeJob's profile loop iterates and calls the mocked parseProfile.
  capture: {
    raw: [{}] as unknown[],
    attached: false,
    sawMatchedResponse: false,
    detach: vi.fn(),
  },
  disposeSpy: vi.fn().mockResolvedValue(undefined),
  profileResult: { value: undefined as ScrapedProfile | undefined },
}));

vi.mock('../src/main/x/ghostscrape/browser', () => ({
  openScrapeWindow: vi.fn(async () => ({
    navigate: async (): Promise<void> => {},
    scrollToBottom: async (): Promise<void> => {},
    clickLatest: async (): Promise<void> => {},
    webContents: {},
    dispose: h.disposeSpy,
  })),
}));

vi.mock('../src/main/x/ghostscrape/capture', () => ({
  attachGraphqlCapture: vi.fn(() => h.capture),
}));

vi.mock('../src/main/x/ghostscrape/parse', () => ({
  parseTimeline: vi.fn(() => []),
  applyFilters: vi.fn((arr: unknown[]) => arr),
  parseProfile: vi.fn(() => h.profileResult.value),
}));

import { runScrapeJob } from '../src/main/x/ghostscrape/job';
import { GhostScrapeCaptureFailedError } from '../src/main/x/ghostscrape/errors';
import type { GhostScrapeConfig } from '../src/main/x/ghostscrape/types';

const cfg: GhostScrapeConfig = {
  accountId: 'acct1',
  username: 'someone',
  type: 'bio',
  scrolls: 0,
  max: 0,
  delayMs: 0,
};

const deps = {
  // A token for BOTH auth_token and ct0 so the creds gate passes and we reach the capture branch.
  getSecret: vi.fn(async (_key: string): Promise<string | null> => 'token'),
  onProgress: vi.fn(),
};

const fakeProfile: ScrapedProfile = {
  handle: 'someone',
  displayName: 'Some One',
  bio: 'bio text',
  followers: 10,
  following: 5,
  joined: '2020-01-01',
};

describe('runScrapeJob — honest capture-failure orchestration', () => {
  beforeEach(() => {
    h.capture.attached = false;
    h.capture.sawMatchedResponse = false;
    h.capture.detach.mockClear();
    h.disposeSpy.mockClear();
    h.profileResult.value = undefined;
    deps.getSecret.mockClear();
    deps.onProgress.mockClear();
  });

  it('A. throws GhostScrapeCaptureFailedError on a silent capture failure (no matched response, no result)', async () => {
    h.capture.attached = false;
    h.capture.sawMatchedResponse = false;
    h.profileResult.value = undefined;

    await expect(
      runScrapeJob('job-A', cfg, deps, new AbortController().signal),
    ).rejects.toBeInstanceOf(GhostScrapeCaptureFailedError);

    // finally still ran: window disposed (session credentials cleared).
    expect(h.disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('B. resolves when the capture attached, saw a matched response, and a profile was parsed', async () => {
    h.capture.attached = true;
    h.capture.sawMatchedResponse = true;
    h.profileResult.value = fakeProfile;

    const result = await runScrapeJob('job-B', cfg, deps, new AbortController().signal);

    expect(result.profile).toEqual(fakeProfile);
    expect(result.partial).toBe(false);
    expect(h.disposeSpy).toHaveBeenCalledTimes(1);
  });
});
