/**
 * F2 — per-campaign COLLECTION SETTINGS: clamp, per-campaign round-trip, and capture-path consult.
 *
 * Three concerns:
 *  1. `clampCollectionSettings` + `saveCollectionSettings` bound every renderer-supplied numeric to
 *     its Enterprise [min,max] MAIN-side (the renderer is never trusted with a raw number), and heal
 *     booleans / absent fields to their defaults.
 *  2. The record persists PER CAMPAIGN: saving one campaign's settings never bleeds into another;
 *     `getCollectionSettings` reads back exactly what THAT campaign saved (the "switching campaigns
 *     loads that campaign's settings" round-trip).
 *  3. A capture path actually CONSULTS the settings: `captureNetwork` reads the per-campaign
 *     `followerBasePasses`/`followingBasePasses` (via its injectable `loadCollectionSettings` seam)
 *     to bound its scroll loop — change the setting, and the loop runs that many passes.
 *
 * Pure/in-memory: an injected fs seam for persistence, injected capture seams for the network loop —
 * no electron, no secure-fs, no BrowserWindow, no network.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  DEFAULT_COLLECTION_SETTINGS,
  COLLECTION_SETTINGS_RANGES,
  clampCollectionSettings,
  collectGateFromSettings,
  type XCollectionSettings,
} from '../src/shared/x-listening-collection-settings';
import {
  getCollectionSettings,
  saveCollectionSettings,
  type XCollectionSettingsDeps,
} from '../src/main/x-listening/collection-settings';
import { captureNetwork, type XNetworkCaptureDeps } from '../src/main/x-listening/capture';

// ── in-memory per-campaign settings store ─────────────────────────────────────
function memSettingsDeps(): { deps: XCollectionSettingsDeps; files: Map<string, XCollectionSettings> } {
  const files = new Map<string, XCollectionSettings>();
  const deps: XCollectionSettingsDeps = {
    read: async (caseId) => (files.has(caseId) ? (files.get(caseId) as unknown as Record<string, unknown>) : null),
    write: async (caseId, settings) => {
      files.set(caseId, settings);
    },
  };
  return { deps, files };
}

describe('clampCollectionSettings — MAIN-side bounds every numeric, heals booleans', () => {
  it('clamps a value ABOVE max down to max and BELOW min up to min', () => {
    const c = clampCollectionSettings({
      sweepIntervalMinutes: 999999, // > 1440
      profileScrollPasses: 0, // 0 ⇒ default (5), within [1,20]
      followerBasePasses: -50, // < 1
      retentionLimit: 10, // < 1000
      maxNetworkDepth: 100000, // > 240
    });
    expect(c.sweepIntervalMinutes).toBe(COLLECTION_SETTINGS_RANGES.sweepIntervalMinutes.max); // 1440
    expect(c.profileScrollPasses).toBe(COLLECTION_SETTINGS_RANGES.profileScrollPasses.def); // 5
    expect(c.followerBasePasses).toBe(COLLECTION_SETTINGS_RANGES.followerBasePasses.min); // 1
    expect(c.retentionLimit).toBe(COLLECTION_SETTINGS_RANGES.retentionLimit.min); // 1000
    expect(c.maxNetworkDepth).toBe(COLLECTION_SETTINGS_RANGES.maxNetworkDepth.max); // 240
  });

  it('non-numeric / NaN heals to the default, and floats are floored then bounded', () => {
    const c = clampCollectionSettings({
      commentThreadsPerSource: 'not-a-number' as unknown as number,
      commentScrollPasses: 3.9, // floored to 3, within [1,12]
    });
    expect(c.commentThreadsPerSource).toBe(COLLECTION_SETTINGS_RANGES.commentThreadsPerSource.def); // 3
    expect(c.commentScrollPasses).toBe(3);
  });

  it('booleans heal to their Enterprise defaults when absent', () => {
    const c = clampCollectionSettings({});
    expect(c.collectReplies).toBe(true); // default-true
    expect(c.retrieveImages).toBe(true); // default-true
    expect(c.collectReposts).toBe(false);
    expect(c.collectComments).toBe(false);
    expect(c.automaticSweeps).toBe(false);
    expect(c.archiveEnabled).toBe(false);
  });

  it('an explicit false turns a default-true boolean off', () => {
    expect(clampCollectionSettings({ collectReplies: false }).collectReplies).toBe(false);
  });

  it('the exported defaults are a fully-clamped record', () => {
    expect(clampCollectionSettings(null)).toEqual(DEFAULT_COLLECTION_SETTINGS);
    expect(clampCollectionSettings(DEFAULT_COLLECTION_SETTINGS)).toEqual(DEFAULT_COLLECTION_SETTINGS);
  });

  it('collectGateFromSettings maps the RECORD TYPES onto the capture gate', () => {
    const gate = collectGateFromSettings(
      clampCollectionSettings({ collectReplies: true, collectReposts: true, collectComments: false }),
    );
    expect(gate).toEqual({ replies: true, reposts: true, comments: false });
  });
});

describe('saveCollectionSettings — clamps out-of-range numerics before persisting', () => {
  it('persists the CLAMPED record and returns it (renderer never widens a bound)', async () => {
    const { deps, files } = memSettingsDeps();
    const saved = await saveCollectionSettings(
      'camp-1',
      { sweepIntervalMinutes: 1, maxPostDepth: 9999, archiveFollowers: true },
      deps,
    );
    // 1 < min(5) ⇒ 5; 9999 > max(120) ⇒ 120; boolean carried through.
    expect(saved.sweepIntervalMinutes).toBe(5);
    expect(saved.maxPostDepth).toBe(120);
    expect(saved.archiveFollowers).toBe(true);
    // The ON-DISK record is the clamped one, not the raw submission.
    expect(files.get('camp-1')?.sweepIntervalMinutes).toBe(5);
    expect(files.get('camp-1')?.maxPostDepth).toBe(120);
  });
});

describe('per-campaign round-trip — switching campaigns loads that campaign settings', () => {
  it('each campaign reads back exactly its own saved settings, no cross-bleed', async () => {
    const { deps } = memSettingsDeps();
    await saveCollectionSettings('camp-a', { sweepIntervalMinutes: 45, collectReposts: true }, deps);
    await saveCollectionSettings('camp-b', { sweepIntervalMinutes: 720, collectReposts: false }, deps);

    const a = await getCollectionSettings('camp-a', deps);
    const b = await getCollectionSettings('camp-b', deps);
    expect(a.sweepIntervalMinutes).toBe(45);
    expect(a.collectReposts).toBe(true);
    expect(b.sweepIntervalMinutes).toBe(720);
    expect(b.collectReposts).toBe(false);

    // A campaign with nothing saved heals to defaults (never another campaign's values).
    const fresh = await getCollectionSettings('camp-c', deps);
    expect(fresh).toEqual(DEFAULT_COLLECTION_SETTINGS);
  });
});

// ── (3) a capture path consults the per-campaign settings ─────────────────────
function fakeWindow() {
  const w = { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; } };
  return w as unknown as Electron.BrowserWindow & { destroyed: boolean };
}
function cell(username: string) {
  return { username, displayName: username, bio: '', url: `https://x.com/${username}`, avatar: '' };
}

/** captureNetwork deps whose scrape yields a BRAND-NEW unique handle every pass, so the accumulator
 *  grows on every pass and stagnation never fires — the loop then runs exactly `passes` passes and
 *  `completedPasses` equals the setting the path consulted. */
function growingNetworkDeps(settings: XCollectionSettings): XNetworkCaptureDeps {
  let call = 0;
  return {
    loadClearnetEnabled: async () => false,
    resolveGate: async () => ({ blocked: false, proxy: { socks: 'socks5://127.0.0.1:9050' } }),
    openWindow: async () => fakeWindow(),
    runCapture: async () => [cell(`user${call++}`)], // a new handle each pass ⇒ never stagnant
    guard: async (_w, capture) => ({ blocked: false, result: await capture() }),
    scroll: async () => undefined,
    assertSignedIn: async () => ({ blocked: false }),
    readNetwork: async () => [],
    saveNetwork: async () => 1,
    recordRun: async () => undefined,
    now: () => '2026-08-13T00:00:00.000Z',
    loadCollectionSettings: async () => settings,
  };
}

describe('captureNetwork consults per-campaign follower/following base passes (F2 wiring)', () => {
  it('bounds the follower scroll loop to followerBasePasses from the campaign settings', async () => {
    const settings = clampCollectionSettings({ followerBasePasses: 4, followingBasePasses: 2 });
    const res = await captureNetwork(
      { caseId: 'camp-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      growingNetworkDeps(settings),
    );
    expect(res.blocked).toBe(false);
    expect(res.completedPasses).toBe(4); // read straight from followerBasePasses
  });

  it('bounds the following scroll loop to followingBasePasses from the campaign settings', async () => {
    const settings = clampCollectionSettings({ followerBasePasses: 4, followingBasePasses: 2 });
    const res = await captureNetwork(
      { caseId: 'camp-1', channelId: 'alice', targetUsername: 'alice', kind: 'following' },
      growingNetworkDeps(settings),
    );
    expect(res.completedPasses).toBe(2); // read straight from followingBasePasses
  });

  it('an explicit req.passes still overrides the campaign default', async () => {
    const settings = clampCollectionSettings({ followerBasePasses: 4 });
    const res = await captureNetwork(
      { caseId: 'camp-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 6 },
      growingNetworkDeps(settings),
    );
    expect(res.completedPasses).toBe(6);
  });
});
