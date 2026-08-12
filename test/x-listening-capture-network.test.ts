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
