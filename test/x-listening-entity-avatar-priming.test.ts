/**
 * X Listening Station — priming ENTITY avatars by visiting their profiles (operator decision,
 * 2026-08-19).
 *
 * FIELD REPORT (GhostExodus, v3.72.2): "Still not extracting display pics." The ENTITY INDEX showed
 * monograms for every mentioned account. Cause: avatars are only ever cached from profile headers we
 * actually CAPTURED (the campaign's target sources), so an account that was merely *mentioned* has no
 * snapshot and therefore no avatar URL to fetch — it can only ever render an initial.
 *
 * The operator chose to prime those avatars by visiting the mentioned profiles. That is real added
 * egress, so this pass is bounded, Tor-gated + fail-closed, idempotent against the existing cache
 * ledger, and remembers MISSES so a profile with no readable avatar is not re-visited every sweep.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  primeEntityAvatars,
  DEFAULT_AVATAR_REPAIR_CAP,
  type XEntityAvatarPrimeDeps,
} from '../src/main/x-listening/avatar-repair';

const CASE = '33333333-3333-4333-8333-333333333333';
const AVATAR = (h: string) => `https://pbs.twimg.com/profile_images/1/${h}.jpg`;

function fakeWindow() {
  return { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; } };
}

function makeDeps(over: Partial<XEntityAvatarPrimeDeps> = {}) {
  const visited: string[] = [];
  const openWindow = vi.fn(async () => fakeWindow() as unknown as Electron.BrowserWindow);
  const written: { map: Record<string, unknown> | null; misses: Record<string, string> | null } = { map: null, misses: null };
  const deps: XEntityAvatarPrimeDeps = {
    loadClearnetEnabled: async () => false,
    resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9999' } }),
    openWindow: openWindow as unknown as XEntityAvatarPrimeDeps['openWindow'],
    listEntityHandles: async () => ['NicoleEggert', 'DarknetDiaries'],
    discoverAvatarUrl: async (_win, handle) => {
      visited.push(handle);
      return AVATAR(handle);
    },
    cache: (async (_win: unknown, url: string) => ({ ref: `x-media/${'a'.repeat(64)}`, sha256: 'a'.repeat(64), _url: url })) as unknown as XEntityAvatarPrimeDeps['cache'],
    readCache: async () => null,
    writeCache: async (_caseId, map) => { written.map = map as unknown as Record<string, unknown>; },
    readMisses: async () => ({}),
    writeMisses: async (_caseId, misses) => { written.misses = misses; },
    now: () => '2026-08-19T00:00:00.000Z',
    cap: DEFAULT_AVATAR_REPAIR_CAP,
    ...over,
  };
  return { deps, openWindow, visited, written };
}

describe('primeEntityAvatars', () => {
  it('visits a mentioned profile and caches the avatar it finds', async () => {
    const { deps, visited, written } = makeDeps();
    const res = await primeEntityAvatars(CASE, deps);
    expect(visited).toEqual(['NicoleEggert', 'DarknetDiaries']);
    expect(res.cached).toBe(2);
    expect(Object.keys(written.map ?? {}).sort()).toEqual(['darknetdiaries', 'nicoleeggert']);
  });

  it('SKIPS a handle that already has a cached avatar (idempotent, no re-visit)', async () => {
    const { deps, visited } = makeDeps({
      readCache: async () => ({ nicoleeggert: { ref: `x-media/${'b'.repeat(64)}`, sha256: 'b'.repeat(64), sourceUrl: AVATAR('x'), cachedAt: 'x' } }),
    });
    const res = await primeEntityAvatars(CASE, deps);
    expect(visited).toEqual(['DarknetDiaries']);
    expect(res.skipped).toBe(1);
  });

  it('FAILS CLOSED — a blocked Tor gate opens no window and visits nothing', async () => {
    const { deps, openWindow, visited } = makeDeps({
      resolveGate: () => ({ blocked: true, reason: 'tor-unavailable' } as never),
    });
    const res = await primeEntityAvatars(CASE, deps);
    expect(openWindow).not.toHaveBeenCalled();
    expect(visited).toEqual([]);
    expect(res.blocked).toBe(true);
  });

  it('is BOUNDED by the per-run cap', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `user${i}`);
    const { deps, visited } = makeDeps({ listEntityHandles: async () => many, cap: 5 });
    await primeEntityAvatars(CASE, deps);
    expect(visited).toHaveLength(5);
  });

  it('records a MISS so a profile with no readable avatar is not re-visited every sweep', async () => {
    const { deps, written } = makeDeps({
      listEntityHandles: async () => ['ghosty'],
      discoverAvatarUrl: async () => '',
    });
    const res = await primeEntityAvatars(CASE, deps);
    expect(res.cached).toBe(0);
    expect(written.misses).toHaveProperty('ghosty');
  });

  it('does not re-visit a handle missed recently', async () => {
    const { deps, visited } = makeDeps({
      listEntityHandles: async () => ['ghosty'],
      readMisses: async () => ({ ghosty: '2026-08-18T23:00:00.000Z' }),
    });
    await primeEntityAvatars(CASE, deps);
    expect(visited).toEqual([]);
  });

  it('DOES re-visit a handle whose miss has aged out', async () => {
    const { deps, visited } = makeDeps({
      listEntityHandles: async () => ['ghosty'],
      readMisses: async () => ({ ghosty: '2026-07-01T00:00:00.000Z' }),
    });
    await primeEntityAvatars(CASE, deps);
    expect(visited).toEqual(['ghosty']);
  });

  it('never visits a bogus handle (no fabricated navigation)', async () => {
    const { deps, visited } = makeDeps({
      listEntityHandles: async () => ['not a handle', 'waytoolongforahandle123', 'ok_1'],
    });
    await primeEntityAvatars(CASE, deps);
    expect(visited).toEqual(['ok_1']);
  });

  it('always destroys the shared window, even when a visit throws', async () => {
    const win = fakeWindow();
    const { deps } = makeDeps({
      openWindow: (async () => win as unknown as Electron.BrowserWindow) as unknown as XEntityAvatarPrimeDeps['openWindow'],
      discoverAvatarUrl: async () => { throw new Error('nav failed'); },
    });
    await primeEntityAvatars(CASE, deps);
    expect(win.destroyed).toBe(true);
  });
});
