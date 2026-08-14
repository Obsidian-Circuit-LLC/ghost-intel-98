/**
 * Task C1 — live follower/following network extraction (`captureNetwork`).
 *
 * The Enterprise `relationships:extract` (follower|following) capability was NOT present on the
 * hardened core: the old clearnet-only `captureFollowers`/`captureFollowing` were retired at Task
 * 16, and only the PURE normalizer (`normalizeNetwork`) + the persistence accumulator
 * (`store.networks.save`) survived — nothing actually drove a live scroll-capture. This suite
 * pins the rebuilt `captureNetwork` onto OUR hardened seams, mirroring `verifyPost`'s fail-closed
 * discipline (`x-listening-verify.test.ts`): validate the target BEFORE any window opens, open a
 * Tor-gated window (FAIL CLOSED — no clearnet fallback unless acked), gate the page (signed-in),
 * scroll-scrape the visible `UserCell` rows with the STATIC `USER_CELL_SCRIPT`, normalize +
 * persist, emit a run-log record, and always destroy the window in a `finally`.
 *
 * Every collaborator is an INJECTABLE dep with a production default — the same seam class the
 * v3.24.2 collect-path bug taught us to test directly. No real electron / BrowserWindow / network.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildNetworkUrl,
  captureNetwork,
  type XNetworkCaptureDeps,
} from '../src/main/x-listening/capture';
import { DEFAULT_COLLECTION_SETTINGS } from '../src/shared/x-listening-collection-settings';

/** A fake capture window that records destroy() — enough to prove the `finally` cleanup. */
function fakeWindow() {
  const w = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  return w as unknown as Electron.BrowserWindow & { destroyed: boolean };
}

/** A UserCell row as `USER_CELL_SCRIPT` returns it. */
function cell(username: string, displayName = username) {
  return {
    username,
    displayName,
    bio: '',
    url: `https://x.com/${username}`,
    avatar: '', // remote avatars are dropped by normalizeUserCell — none inlined here
  };
}

/** Base deps: an OPEN gate, a signed-in guard, a one-shot page of rows, a no-op scroll, and
 *  spy-able persistence. Individual tests override just the seam under test. */
function baseDeps(rows: ReturnType<typeof cell>[]): {
  deps: XNetworkCaptureDeps;
  win: ReturnType<typeof fakeWindow>;
  saved: ReturnType<typeof vi.fn>;
  runs: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  resolveGate: ReturnType<typeof vi.fn>;
  scroll: ReturnType<typeof vi.fn>;
} {
  const win = fakeWindow();
  const openWindow = vi.fn(async () => win);
  const resolveGate = vi.fn(async () => ({ blocked: false, proxy: { socks: 'socks5://127.0.0.1:9050' } }));
  const scroll = vi.fn(async () => undefined);
  const saved = vi.fn(async () => 1);
  const runs = vi.fn(async () => undefined);
  const deps: XNetworkCaptureDeps = {
    loadClearnetEnabled: async () => false,
    resolveGate,
    openWindow,
    runCapture: async () => rows,
    guard: async (_w, capture) => ({ blocked: false, result: await capture() }),
    scroll,
    assertSignedIn: async () => ({ blocked: false }),
    readNetwork: async () => [],
    saveNetwork: saved,
    recordRun: runs,
    now: () => '2026-08-12T00:00:00.000Z',
  };
  return { deps, win, saved, runs, openWindow, resolveGate, scroll };
}

describe('buildNetworkUrl — validate the target BEFORE any window opens', () => {
  it('builds the exact followers URL for a valid handle', () => {
    expect(buildNetworkUrl('alice', 'followers').toString()).toBe('https://x.com/alice/followers');
  });
  it('builds the exact following URL for a valid handle', () => {
    expect(buildNetworkUrl('@bob', 'following').toString()).toBe('https://x.com/bob/following');
  });
  it('rejects a malformed handle (path injection / non-username)', () => {
    expect(() => buildNetworkUrl('a/../b', 'followers')).toThrow();
    expect(() => buildNetworkUrl('this_is_way_too_long_to_be_real', 'followers')).toThrow();
    expect(() => buildNetworkUrl('', 'followers')).toThrow();
  });
});

describe('captureNetwork — happy path', () => {
  it('opens the followers URL, scrapes + normalizes + persists the accounts', async () => {
    const { deps, saved, openWindow, win } = baseDeps([cell('carol'), cell('dave')]);
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(res.blocked).toBe(false);
    expect(res.kind).toBe('followers');
    expect(res.target).toBe('@alice');
    expect(res.observed).toBe(2);
    expect(res.added).toBe(2);
    // The window was pointed at the exact followers URL.
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow.mock.calls[0][0]).toBe('https://x.com/alice/followers');
    // Persisted a well-formed artifact.
    expect(saved).toHaveBeenCalledTimes(1);
    const artifact = saved.mock.calls[0][1];
    expect(artifact.target).toBe('@alice');
    expect(artifact.kind).toBe('followers');
    expect(artifact.accounts.map((a: { handle: string }) => a.handle).sort()).toEqual([
      '@carol',
      '@dave',
    ]);
    // Window cleaned up.
    expect(win.destroyed).toBe(true);
  });

  it('drives the following URL for kind=following', async () => {
    const { deps, openWindow, saved } = baseDeps([cell('carol')]);
    await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'following' },
      deps,
    );
    expect(openWindow.mock.calls[0][0]).toBe('https://x.com/alice/following');
    expect(saved.mock.calls[0][1].kind).toBe('following');
  });

  it('reports added relative to already-persisted accounts (accumulator honesty)', async () => {
    const { deps } = baseDeps([cell('carol'), cell('dave')]);
    deps.readNetwork = async () => [{ handle: '@carol' }] as never;
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(res.observed).toBe(2);
    expect(res.added).toBe(1); // only @dave is new
  });

  it('emits a completed run-log record (operation = kind)', async () => {
    const { deps, runs } = baseDeps([cell('carol')]);
    await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(runs).toHaveBeenCalledTimes(1);
    const rec = runs.mock.calls[0][1];
    expect(rec.operation).toBe('followers');
    expect(rec.username).toBe('alice');
    expect(rec.status).toBe('complete');
    expect(rec.observed).toBe(1);
  });
});

describe('captureNetwork — mid-scroll challenge (FA-A review: no truncated list logged as complete)', () => {
  it('DISCARDS the partial list and records an ERROR run when a challenge surfaces mid-scroll', async () => {
    const { deps, saved, runs } = baseDeps([]);
    // One NEW cell per pass so the loop never stagnates; block the signed-in re-check after the
    // first scroll — the raised 240-pass ceiling must not keep scrolling a flagged page.
    let pass = 0;
    deps.runCapture = async () => [cell(`u${pass++}`)];
    deps.assertSignedIn = async () => ({ blocked: true, reason: 'rate limit interstitial' });
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 20 },
      deps,
    );
    expect(res.blocked).toBe(true);
    // The truncated follower list is DISCARDED — nothing persisted.
    expect(saved).not.toHaveBeenCalled();
    // An honest ERROR run is recorded — never 'complete'.
    const rec = runs.mock.calls.at(-1)![1];
    expect(rec.status).toBe('error');
    expect(rec.stopReason).toMatch(/rate limit|challenge/i);
  });
});

describe('captureNetwork — fail closed (Tor gate blocked)', () => {
  it('opens NO window and persists NOTHING when the gate is blocked', async () => {
    const { deps, openWindow, saved } = baseDeps([cell('carol')]);
    deps.resolveGate = vi.fn(async () => ({ blocked: true, reason: 'Tor is not available.' })) as never;
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('Tor is not available.');
    expect(openWindow).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('opens NO window for a malformed target (validate-before-open)', async () => {
    const { deps, openWindow, resolveGate } = baseDeps([cell('carol')]);
    await expect(
      captureNetwork(
        { caseId: 'case-1', channelId: 'x', targetUsername: 'a/../b', kind: 'followers' },
        deps,
      ),
    ).rejects.toThrow();
    expect(resolveGate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('captureNetwork — page guard blocked (signed out)', () => {
  it('captures nothing, destroys the window, and returns blocked', async () => {
    const { deps, saved, win } = baseDeps([cell('carol')]);
    deps.guard = async () => ({ blocked: true, reason: 'The saved X session is no longer signed in.' });
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('signed in');
    expect(saved).not.toHaveBeenCalled();
    // A window WAS opened (page guard runs inside it) and it must be cleaned up.
    expect(win.destroyed).toBe(true);
  });
});

describe('captureNetwork — scroll loop', () => {
  it('accumulates across scroll passes and stops on stagnation', async () => {
    const { deps, scroll, saved } = baseDeps([]);
    // Pass 1 → carol, pass 2 → carol+dave, pass 3+ → no new (stagnant).
    const pages = [[cell('carol')], [cell('carol'), cell('dave')], [cell('carol'), cell('dave')]];
    let call = 0;
    deps.runCapture = async () => pages[Math.min(call++, pages.length - 1)];
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 30 },
      deps,
    );
    expect(res.observed).toBe(2);
    // Stopped well before the 30-pass ceiling once accounts stopped growing.
    expect(scroll.mock.calls.length).toBeLessThan(10);
    expect(saved.mock.calls[0][1].accounts).toHaveLength(2);
  });
});

// ---- FA5: configurable stagnation limit + 240-pass ceiling (audit medium) --------------------
//
// His `scrapeRelationshipRows` (main.cjs:2354-2358) clamps the network scroll budget to [1,240] and
// derives the early-stop stagnation limit from `settings.networkStagnationLimit` clamped [4,20]
// (default 7). Ours previously hard-capped the ceiling at 60 and used a FIXED stagnation of 3 — so a
// large follower list stopped ~2x too shallow and bailed after only 3 no-growth passes. These pin the
// raised ceiling and the settings-driven, clamped stagnation limit onto OUR injectable seams.

/** A never-stagnating page source: pass N returns N+1 cumulative unique cells, so `seen` grows every
 *  pass and the loop only ever stops at the pass ceiling. */
function growingRows(): () => Promise<ReturnType<typeof cell>[]> {
  let call = 0;
  return async () => {
    const n = (call += 1);
    return Array.from({ length: n }, (_, k) => cell(`u${k}`));
  };
}

describe('captureNetwork — configurable stagnation limit (settings-driven)', () => {
  // pages: grow for two passes (a, then a+b), then a constant [a,b] forever ⇒ stagnation begins pass 3.
  function twoGrowThenStagnant(): () => Promise<ReturnType<typeof cell>[]> {
    const pages = [[cell('a')], [cell('a'), cell('b')], [cell('a'), cell('b')]];
    let call = 0;
    return async () => pages[Math.min(call++, pages.length - 1)];
  }

  it('honors networkStagnationLimit=5 from campaign settings (breaks on the 5th stagnant pass)', async () => {
    const { deps, scroll } = baseDeps([]);
    deps.loadCollectionSettings = async () => ({ ...DEFAULT_COLLECTION_SETTINGS, networkStagnationLimit: 5 });
    deps.runCapture = twoGrowThenStagnant();
    const res = await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 100 },
      deps,
    );
    expect(res.observed).toBe(2);
    // 2 growth scrolls + 4 stagnant scrolls, then the 5th stagnant pass breaks before scrolling.
    expect(scroll).toHaveBeenCalledTimes(6);
    expect(res.reachedEnd).toBe(true);
  });

  it('a lower networkStagnationLimit=4 stops one pass sooner', async () => {
    const { deps, scroll } = baseDeps([]);
    deps.loadCollectionSettings = async () => ({ ...DEFAULT_COLLECTION_SETTINGS, networkStagnationLimit: 4 });
    deps.runCapture = twoGrowThenStagnant();
    await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 100 },
      deps,
    );
    expect(scroll).toHaveBeenCalledTimes(5);
  });

  it('re-clamps a below-band configured limit up to 4 MAIN-side (defence in depth)', async () => {
    const { deps, scroll } = baseDeps([]);
    // A raw 1 (below His [4,20] band) must NOT stop after a single stagnant pass — it clamps to 4.
    deps.loadCollectionSettings = async () => ({ ...DEFAULT_COLLECTION_SETTINGS, networkStagnationLimit: 1 });
    deps.runCapture = twoGrowThenStagnant();
    await captureNetwork(
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 100 },
      deps,
    );
    // Behaves as limit 4 (5 scrolls), not limit 1 (which would be 2 scrolls).
    expect(scroll).toHaveBeenCalledTimes(5);
  });
});

describe('captureNetwork — raised 240-pass ceiling', () => {
  it('scrolls up to 240 passes (His ceiling), not the old 60 cap', async () => {
    const { deps, scroll } = baseDeps([]);
    deps.loadCollectionSettings = async () => ({ ...DEFAULT_COLLECTION_SETTINGS, networkStagnationLimit: 20 });
    deps.runCapture = growingRows();
    const res = await captureNetwork(
      // A request above the ceiling clamps to 240 (never 300, never the old 60).
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers', passes: 300 },
      deps,
    );
    expect(res.completedPasses).toBe(240);
    // 240 reads ⇒ 239 scrolls (never scroll past the final pass).
    expect(scroll).toHaveBeenCalledTimes(239);
    expect(res.observed).toBe(240);
  });

  it('an ordinary capture still uses the base pass budget (8), not the raised ceiling', async () => {
    const { deps, scroll } = baseDeps([]);
    deps.loadCollectionSettings = async () => ({
      ...DEFAULT_COLLECTION_SETTINGS,
      followerBasePasses: 8,
      networkStagnationLimit: 20,
    });
    deps.runCapture = growingRows();
    const res = await captureNetwork(
      // No explicit passes ⇒ defaults to the per-direction base budget (8), unchanged by the raise.
      { caseId: 'case-1', channelId: 'alice', targetUsername: 'alice', kind: 'followers' },
      deps,
    );
    expect(res.completedPasses).toBe(8);
    expect(scroll).toHaveBeenCalledTimes(7);
  });
});
