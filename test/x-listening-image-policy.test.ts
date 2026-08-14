/**
 * F1 — per-profile image-collection policy (on / off / inherit).
 *
 * Rebuild of Enterprise `effectiveImageCollection` (`electron/main.cjs:369` — a per-profile
 * `imageMode` override layered on the campaign-wide image toggle) onto OUR hardened seams:
 *  - the pure resolver `effectiveImageCollection(mode, campaignRetrieveImages)` (shared),
 *  - the per-campaign secure-fs policy map (`x-image-policy.json`) read/written MAIN-side,
 *  - and the enforcement point in `captureTimeline`: when the effective policy is OFF for the
 *    source being captured, NO post media is fetched/cached (`resolveMedia` never runs), so no
 *    `pbs.twimg.com` request is issued at all; the host-anchored fetch discipline is unchanged
 *    for the ON case.
 *
 * Pure/in-memory: an injected fs seam for the policy map + an injected retrieve-images loader for
 * the campaign fallback + injected capture seams — no electron, no secure-fs, no BrowserWindow,
 * no network.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  effectiveImageCollection,
  normalizeImageMode,
  IMAGE_MODES,
  DEFAULT_IMAGE_MODE,
  type XImageMode,
} from '../src/shared/x-listening-image-policy';
import {
  getProfileImageMode,
  setProfileImageMode,
  getImagePolicy,
  resolveEffectiveImageCollection,
  type XImagePolicyDeps,
} from '../src/main/x-listening/image-policy';
import {
  captureTimeline,
  type XTimelineCaptureRequest,
  type XCaptureDeps,
} from '../src/main/x-listening/capture';
import type { RawPost } from '../src/main/x-listening/extract';
import { DEFAULT_COLLECTION_SETTINGS } from '@shared/x-listening-collection-settings';

// ── pure resolver ─────────────────────────────────────────────────────────────
describe('effectiveImageCollection — per-profile override OR campaign toggle', () => {
  it("'on' collects regardless of the campaign toggle", () => {
    expect(effectiveImageCollection('on', false)).toBe(true);
    expect(effectiveImageCollection('on', true)).toBe(true);
  });
  it("'off' never collects, regardless of the campaign toggle", () => {
    expect(effectiveImageCollection('off', true)).toBe(false);
    expect(effectiveImageCollection('off', false)).toBe(false);
  });
  it("'inherit' follows the campaign retrieveImages toggle", () => {
    expect(effectiveImageCollection('inherit', true)).toBe(true);
    expect(effectiveImageCollection('inherit', false)).toBe(false);
  });
  it('normalizeImageMode heals any junk to the default (inherit)', () => {
    expect(normalizeImageMode('on')).toBe('on');
    expect(normalizeImageMode('off')).toBe('off');
    expect(normalizeImageMode('inherit')).toBe('inherit');
    expect(normalizeImageMode('ON')).toBe(DEFAULT_IMAGE_MODE);
    expect(normalizeImageMode('nonsense')).toBe(DEFAULT_IMAGE_MODE);
    expect(normalizeImageMode(undefined)).toBe(DEFAULT_IMAGE_MODE);
    expect(normalizeImageMode(42)).toBe(DEFAULT_IMAGE_MODE);
    expect(IMAGE_MODES).toEqual(['on', 'off', 'inherit']);
  });
});

// ── main-side per-campaign persistence ──────────────────────────────────────────
function memPolicyDeps(retrieveImages = true): {
  deps: XImagePolicyDeps;
  files: Map<string, Record<string, XImageMode>>;
} {
  const files = new Map<string, Record<string, XImageMode>>();
  const deps: XImagePolicyDeps = {
    read: async (caseId) => (files.has(caseId) ? { ...(files.get(caseId) as Record<string, unknown>) } : null),
    write: async (caseId, map) => {
      files.set(caseId, { ...(map as Record<string, XImageMode>) });
    },
    loadRetrieveImages: async () => retrieveImages,
  };
  return { deps, files };
}

describe('per-profile image mode — persisted per-campaign, keyed by canonical source', () => {
  it('an unset profile reads back the default (inherit)', async () => {
    const { deps } = memPolicyDeps();
    expect(await getProfileImageMode('camp-1', 'alice', deps)).toBe('inherit');
  });

  it('setProfileImageMode persists the mode and returns the effective decision', async () => {
    const { deps, files } = memPolicyDeps(true); // campaign retrieveImages ON
    const rec = await setProfileImageMode('camp-1', '@Alice', 'off', deps);
    expect(rec.imageMode).toBe('off');
    expect(rec.sourceKey).toBe('alice'); // canonicalized (@-insensitive, lowercased)
    expect(rec.effective).toBe(false); // off wins over the campaign toggle
    // Round-trips under the canonical key regardless of the casing/@ used to set it.
    expect(await getProfileImageMode('camp-1', 'alice', deps)).toBe('off');
    expect(files.get('camp-1')?.alice).toBe('off');
  });

  it('an invalid mode is rejected MAIN-side (never trusts the renderer)', async () => {
    const { deps } = memPolicyDeps();
    await expect(setProfileImageMode('camp-1', 'alice', 'bogus' as unknown as XImageMode, deps)).rejects.toThrow();
  });

  it('policy is per-campaign — no cross-bleed between campaigns', async () => {
    const { deps } = memPolicyDeps();
    await setProfileImageMode('camp-a', 'alice', 'off', deps);
    await setProfileImageMode('camp-b', 'alice', 'on', deps);
    expect(await getProfileImageMode('camp-a', 'alice', deps)).toBe('off');
    expect(await getProfileImageMode('camp-b', 'alice', deps)).toBe('on');
    expect(await getProfileImageMode('camp-c', 'alice', deps)).toBe('inherit');
  });

  it('getImagePolicy returns the map + campaign retrieveImages so the renderer can show effective', async () => {
    const { deps } = memPolicyDeps(false); // campaign retrieveImages OFF
    await setProfileImageMode('camp-1', 'alice', 'on', deps);
    await setProfileImageMode('camp-1', 'bob', 'inherit', deps);
    const pol = await getImagePolicy('camp-1', deps);
    expect(pol.retrieveImages).toBe(false);
    expect(pol.modes.alice).toBe('on');
    // inherit entries need not be persisted, but if present must be a valid mode
    expect(['on', 'off', 'inherit']).toContain(pol.modes.bob ?? 'inherit');
  });
});

describe('resolveEffectiveImageCollection — the capture-path consult', () => {
  it("'off' profile ⇒ false even when the campaign toggle is ON", async () => {
    const { deps } = memPolicyDeps(true);
    await setProfileImageMode('camp-1', 'alice', 'off', deps);
    expect(await resolveEffectiveImageCollection('camp-1', 'alice', deps)).toBe(false);
  });
  it("'inherit' (or unset) profile ⇒ follows the campaign toggle", async () => {
    const on = memPolicyDeps(true);
    const off = memPolicyDeps(false);
    expect(await resolveEffectiveImageCollection('camp-1', 'unset', on.deps)).toBe(true);
    expect(await resolveEffectiveImageCollection('camp-1', 'unset', off.deps)).toBe(false);
  });
  it("'on' profile ⇒ true even when the campaign toggle is OFF", async () => {
    const { deps } = memPolicyDeps(false);
    await setProfileImageMode('camp-1', 'alice', 'on', deps);
    expect(await resolveEffectiveImageCollection('camp-1', 'alice', deps)).toBe(true);
  });
});

// ── enforcement in the media pipeline (captureTimeline) ─────────────────────────
const WIN = { webContents: { executeJavaScript: vi.fn() } } as unknown as Electron.BrowserWindow;

const rawPost = (o: Partial<RawPost> = {}): RawPost => ({
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

function captureDeps(over: Partial<XCaptureDeps> = {}): Partial<XCaptureDeps> {
  return {
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    runCapture: async () => [rawPost()],
    savePosts: async () => ({ added: 1, skipped: 0 }),
    saveItems: async () => ({ added: 1, skipped: 0 }),
    recordRun: async () => {},
    // FA1: pin to ONE scroll pass with a no-op scroll/delay so this image-policy test binds the
    // capture loop deterministically (and instantly) instead of falling through to the production
    // settings read + real inter-pass timers.
    loadCollectionSettings: () => ({ ...DEFAULT_COLLECTION_SETTINGS, profileScrollPasses: 1, delayPerPassMs: 0 }),
    scroll: async () => {},
    delay: async () => {},
    now: () => '2026-08-13T12:00:00.000Z',
    ...over,
  };
}

describe('captureTimeline enforces the effective image policy', () => {
  it("policy OFF ⇒ resolveMedia is NEVER called and the post carries no media refs", async () => {
    const resolveMedia = vi.fn(async () => 'x-media/deadbeef');
    const res = await captureTimeline(
      WIN,
      REQ,
      captureDeps({ resolveMedia, imagesEnabledForSource: async () => false }),
    );
    expect(res.blocked).toBe(false);
    expect(resolveMedia).not.toHaveBeenCalled(); // no pbs.twimg fetch issued at all
    expect(res.posts[0]?.mediaRefs).toBeUndefined();
  });

  it("policy ON ⇒ resolveMedia runs (host-anchored) and the LOCAL ref is folded on", async () => {
    const resolveMedia = vi.fn(async (_w: unknown, url: string, caseId: string) => {
      expect(caseId).toBe('case-a');
      expect(url).toBe('https://pbs.twimg.com/media/a.jpg');
      return 'x-media/' + 'a'.repeat(64);
    });
    const res = await captureTimeline(
      WIN,
      REQ,
      captureDeps({ resolveMedia, imagesEnabledForSource: async () => true }),
    );
    expect(resolveMedia).toHaveBeenCalledTimes(1);
    expect(res.posts[0]?.mediaRefs).toEqual(['x-media/' + 'a'.repeat(64)]);
  });

  it('the source key handed to the policy resolver is the canonical @-insensitive handle', async () => {
    const imagesEnabledForSource = vi.fn(async () => true);
    await captureTimeline(
      WIN,
      { ...REQ, targetUsername: '@Target' },
      captureDeps({ imagesEnabledForSource, resolveMedia: async () => null }),
    );
    expect(imagesEnabledForSource).toHaveBeenCalledWith('case-a', 'target');
  });
});
