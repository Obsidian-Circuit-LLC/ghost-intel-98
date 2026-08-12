/**
 * X Listening Station — avatar-repair-on-startup (Task H1).
 *
 * Enterprise's `scheduleAvatarRepair`/`repairExistingProfileAvatars` (`electron/main.cjs:1517`)
 * re-fetched missing profile avatars on launch. Rebuilt onto the hardened seams as a BOUNDED,
 * Tor-gated, idempotent startup pass:
 *   - candidates = the active campaign's profiles/network accounts that carry a known remote
 *     avatar URL but have NO cached local copy yet;
 *   - each re-fetch routes the host-anchored media pipeline (`cacheRemoteMedia`) inside a
 *     Tor-gated capture window — FAIL CLOSED: Tor down (and no acked clearnet) opens NO window
 *     and re-fetches nothing;
 *   - bounded by a per-run cap (no unbounded loop);
 *   - idempotent: a handle already in the per-campaign avatar cache is skipped, so a second pass
 *     with nothing new to do opens no window.
 *
 * These tests drive the orchestration entirely through injected deps (no electron/network/secure-fs).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  repairAvatars,
  DEFAULT_AVATAR_REPAIR_CAP,
  MAX_AVATAR_REPAIR_CAP,
  type XAvatarRepairDeps,
  type XAvatarCacheMap,
} from '../src/main/x-listening/avatar-repair';

const CASE = '22222222-2222-4222-8222-222222222222';

const AVATAR = (h: string) => `https://pbs.twimg.com/profile_images/1/${h}.jpg`;

/** A fake capture window — records destroy so a test can assert cleanup. */
function fakeWindow() {
  return { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; } };
}

/** Build a full injected dep set with sane, side-effect-free defaults; a test overrides only what
 *  it exercises. The gate defaults to Tor-ready (a proxy) so the happy paths open a window. */
function makeDeps(over: Partial<XAvatarRepairDeps> = {}): {
  deps: XAvatarRepairDeps;
  openWindow: ReturnType<typeof vi.fn>;
  cache: ReturnType<typeof vi.fn>;
  writeCache: ReturnType<typeof vi.fn>;
  written: { map: XAvatarCacheMap | null };
} {
  const written: { map: XAvatarCacheMap | null } = { map: null };
  const openWindow = vi.fn(async () => fakeWindow() as unknown as Electron.BrowserWindow);
  const cache = vi.fn(async (_win: unknown, url: string) => ({
    ref: `x-media/${'a'.repeat(64)}`,
    sha256: 'a'.repeat(64),
    _url: url,
  }));
  const writeCache = vi.fn(async (_caseId: string, map: XAvatarCacheMap) => { written.map = map; });
  const deps: XAvatarRepairDeps = {
    loadClearnetEnabled: async () => false,
    resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9999' } }),
    openWindow: openWindow as unknown as XAvatarRepairDeps['openWindow'],
    cache: cache as unknown as XAvatarRepairDeps['cache'],
    listCandidates: async () => [{ handle: 'alice', sourceUrl: AVATAR('alice') }],
    readCache: async () => null,
    writeCache,
    now: () => '2026-08-13T00:00:00.000Z',
    cap: DEFAULT_AVATAR_REPAIR_CAP,
    ...over,
  };
  return { deps, openWindow, cache, writeCache, written };
}

describe('x-listening avatar-repair (H1)', () => {
  it('queues a profile with a MISSING cached avatar for re-fetch on the pass', async () => {
    const { deps, openWindow, cache, written } = makeDeps();
    const res = await repairAvatars(CASE, deps);

    expect(res.blocked).toBe(false);
    expect(res.repaired).toBe(1);
    expect(res.skipped).toBe(0);
    expect(openWindow).toHaveBeenCalledTimes(1);
    // The window is opened over the resolved Tor proxy (fail-closed posture, not clearnet).
    expect(openWindow.mock.calls[0][1]).toEqual({ socks: '127.0.0.1:9999' });
    // The host-anchored media pipeline is called with the candidate's avatar URL + the caseId.
    expect(cache).toHaveBeenCalledTimes(1);
    expect(cache.mock.calls[0][1]).toBe(AVATAR('alice'));
    expect(cache.mock.calls[0][2]).toBe(CASE);
    // The freshly-cached ref is persisted into the per-campaign avatar cache, keyed by canonical handle.
    expect(written.map?.alice?.ref).toBe(`x-media/${'a'.repeat(64)}`);
    expect(written.map?.alice?.sourceUrl).toBe(AVATAR('alice'));
    expect(written.map?.alice?.cachedAt).toBe('2026-08-13T00:00:00.000Z');
  });

  it('SKIPS a profile that already has a cached avatar (idempotent — opens no window)', async () => {
    const { deps, openWindow, cache, writeCache } = makeDeps({
      // alice already cached in a prior pass.
      readCache: async () => ({ alice: { ref: `x-media/${'b'.repeat(64)}`, sha256: 'b'.repeat(64), sourceUrl: AVATAR('alice'), cachedAt: '2026-08-01T00:00:00.000Z' } }),
    });
    const res = await repairAvatars(CASE, deps);

    expect(res.repaired).toBe(0);
    expect(res.skipped).toBe(1);
    expect(openWindow).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('is BOUNDED — re-fetches at most `cap` avatars per run', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ handle: `user${i}`, sourceUrl: AVATAR(`user${i}`) }));
    const { deps, openWindow, cache } = makeDeps({ listCandidates: async () => many, cap: 2 });
    const res = await repairAvatars(CASE, deps);

    expect(res.cap).toBe(2);
    expect(res.repaired).toBe(2);
    expect(cache).toHaveBeenCalledTimes(2);
    // One shared window for the whole bounded batch — not one per avatar.
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  it('FAILS CLOSED when Tor is unavailable — opens no window, re-fetches nothing', async () => {
    const { deps, openWindow, cache, writeCache } = makeDeps({
      resolveGate: () => ({ blocked: true, reason: 'Tor is not ready — X capture is blocked.' }),
    });
    const res = await repairAvatars(CASE, deps);

    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/Tor is not ready/);
    expect(res.repaired).toBe(0);
    expect(openWindow).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('does not re-fetch a candidate whose only URL is OFF the media allowlist (no window for junk)', async () => {
    const { deps, openWindow, cache } = makeDeps({
      listCandidates: async () => [
        { handle: 'evil', sourceUrl: 'https://evil.example/profile_images/1/evil.jpg?y=pbs.twimg.com' },
        { handle: 'nothttp', sourceUrl: 'data:image/png;base64,AAAA' },
      ],
    });
    const res = await repairAvatars(CASE, deps);

    expect(res.repaired).toBe(0);
    // Both candidates are non-repairable (off-allowlist host / non-http scheme) → nothing opens.
    expect(openWindow).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
  });

  it('counts a fetch failure without aborting the batch, and still persists the successes', async () => {
    const many = [
      { handle: 'good', sourceUrl: AVATAR('good') },
      { handle: 'bad', sourceUrl: AVATAR('bad') },
    ];
    const cache = vi.fn(async (_win: unknown, url: string) =>
      url.includes('bad') ? null : { ref: `x-media/${'c'.repeat(64)}`, sha256: 'c'.repeat(64) },
    );
    const { deps, writeCache, written } = makeDeps({
      listCandidates: async () => many,
      cache: cache as unknown as XAvatarRepairDeps['cache'],
    });
    const res = await repairAvatars(CASE, deps);

    expect(res.repaired).toBe(1);
    expect(res.failures).toBe(1);
    expect(writeCache).toHaveBeenCalledTimes(1);
    expect(written.map?.good?.ref).toBe(`x-media/${'c'.repeat(64)}`);
    expect(written.map?.bad).toBeUndefined();
  });

  it('re-clamps an absurd/renderer-supplied cap main-side (never an unbounded loop)', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ handle: `u${i}`, sourceUrl: AVATAR(`u${i}`) }));
    const { deps, cache } = makeDeps({ listCandidates: async () => many, cap: Number.MAX_SAFE_INTEGER });
    const res = await repairAvatars(CASE, deps);

    // Cap is clamped to the hard maximum; still bounded by the (smaller) candidate count here.
    expect(res.repaired).toBe(10);
    expect(cache).toHaveBeenCalledTimes(10);
    expect(res.cap).toBe(MAX_AVATAR_REPAIR_CAP);
  });
});
