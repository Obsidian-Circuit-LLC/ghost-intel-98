/**
 * E1 — Tor-gated "open in X" affordances (foundational; C2b + D1 consume it).
 *
 * Rebuilds the Enterprise `feed:open-thread`/`feed:open-profile`/`identity:open-profile`/
 * `relationships:open-profile` surface (`main.cjs` `openPostThread`/`openProfileFeed`/
 * `openRelationshipProfile`) as ONE hardened, injectable-seam helper `openInX(kind, ref)`:
 *  - the URL is VALIDATED + CONSTRUCTED (`buildXOpenUrl`) BEFORE any window opens — a
 *    malformed username/post URL throws, opening NOTHING;
 *  - 'thread' reuses the Phase-1 `assertValidPostUrl` scheme/host/path guards (X apex/www only,
 *    `/status/<digits>`, forced https); 'profile'/'identity' enforce `^[A-Za-z0-9_]{1,15}$` and
 *    build `https://x.com/<user>` exactly (no path injection);
 *  - the window is Tor-gated via `resolveXTorGate` (FAIL CLOSED — no clearnet fallback unless the
 *    acked clearnet toggle is on), mirroring `verifyPost`.
 *
 * The gate/window are injected deps — no electron, no network.
 */
import { describe, it, expect, vi } from 'vitest';

import { openInX, buildXOpenUrl, type XOpenInXDeps } from '../src/main/x-listening/capture';

function fakeWin() {
  return {
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false,
  } as unknown as Electron.BrowserWindow;
}

function deps(over: Partial<XOpenInXDeps> = {}): Partial<XOpenInXDeps> {
  return {
    loadClearnetEnabled: async () => false,
    resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9050' } }),
    openWindow: async () => fakeWin(),
    ...over,
  };
}

// ---- 1. buildXOpenUrl (pure URL validation + construction) ------------------

describe('E1 — buildXOpenUrl', () => {
  it('builds the exact bare profile URL from a valid handle (with/without @)', () => {
    expect(buildXOpenUrl('profile', 'GhostExodus').toString()).toBe('https://x.com/GhostExodus');
    expect(buildXOpenUrl('profile', '@GhostExodus').toString()).toBe('https://x.com/GhostExodus');
    expect(buildXOpenUrl('identity', 'target_01').toString()).toBe('https://x.com/target_01');
  });

  it('accepts a valid thread URL and forces https (reuses assertValidPostUrl)', () => {
    expect(buildXOpenUrl('thread', 'http://x.com/target/status/100').toString()).toBe(
      'https://x.com/target/status/100',
    );
    expect(buildXOpenUrl('thread', 'https://twitter.com/target/status/100').toString()).toBe(
      'https://twitter.com/target/status/100',
    );
  });

  it('rejects a malformed username, constructing NO URL', () => {
    for (const bad of ['', 'has space', 'a'.repeat(16), 'bad/slash', 'evil@x', 'a.b', '../x']) {
      expect(() => buildXOpenUrl('profile', bad), bad).toThrow(/valid X username/i);
      expect(() => buildXOpenUrl('identity', bad), bad).toThrow(/valid X username/i);
    }
  });

  it('rejects an off-host or non-/status/ thread URL, and a non-URL ref', () => {
    expect(() => buildXOpenUrl('thread', 'https://evil.example.com/target/status/100')).toThrow(
      /non-X/i,
    );
    expect(() => buildXOpenUrl('thread', 'https://x.com/target')).toThrow(/valid X status/i);
    expect(() => buildXOpenUrl('thread', 'not a url')).toThrow(/valid X status/i);
    expect(() => buildXOpenUrl('thread', '')).toThrow(/valid X status/i);
  });
});

// ---- 2. openInX opens a window at the exact expected URL -------------------

describe('E1 — openInX opens a window at the exact expected URL', () => {
  it('profile → https://x.com/<user>', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    const res = await openInX('profile', 'GhostExodus', deps({ openWindow }));
    expect(res).toEqual({ opened: true, url: 'https://x.com/GhostExodus' });
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith('https://x.com/GhostExodus', { socks: '127.0.0.1:9050' });
  });

  it('identity → https://x.com/<user>', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    const res = await openInX('identity', 'analyst9', deps({ openWindow }));
    expect(res.url).toBe('https://x.com/analyst9');
    expect(openWindow).toHaveBeenCalledWith('https://x.com/analyst9', { socks: '127.0.0.1:9050' });
  });

  it('thread → the validated https status URL', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    const res = await openInX('thread', 'https://x.com/target/status/100', deps({ openWindow }));
    expect(res.url).toBe('https://x.com/target/status/100');
    expect(openWindow).toHaveBeenCalledWith('https://x.com/target/status/100', {
      socks: '127.0.0.1:9050',
    });
  });

  it('shows/focuses the opened window (a visible affordance, not a hidden verify window)', async () => {
    const win = fakeWin();
    const res = await openInX('profile', 'target', deps({ openWindow: async () => win }));
    expect(res.opened).toBe(true);
    expect((win as unknown as { show: ReturnType<typeof vi.fn> }).show).toHaveBeenCalled();
  });
});

// ---- 3. a malformed ref throws and opens NO window ------------------------

describe('E1 — openInX rejects a malformed ref, opening NO window', () => {
  it('a malformed username throws before any gate/window work', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    const resolveGate = vi.fn(() => ({ blocked: false as const, proxy: { socks: '127.0.0.1:9050' } }));
    await expect(openInX('profile', 'bad name', deps({ openWindow, resolveGate }))).rejects.toThrow(
      /valid X username/i,
    );
    expect(openWindow).not.toHaveBeenCalled();
    expect(resolveGate).not.toHaveBeenCalled();
  });

  it('a malformed (off-host) thread URL throws and opens no window', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await expect(
      openInX('thread', 'https://evil.example.com/a/status/1', deps({ openWindow })),
    ).rejects.toThrow(/non-X/i);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('a thread ref without a /status/<id> path throws and opens no window', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await expect(openInX('thread', 'https://x.com/target', deps({ openWindow }))).rejects.toThrow(
      /valid X status/i,
    );
    expect(openWindow).not.toHaveBeenCalled();
  });
});

// ---- 4. fails closed when Tor is unavailable + clearnet not acked ----------

describe('E1 — openInX fails closed (no clearnet fallback)', () => {
  it('throws and opens NO window when the Tor gate is blocked and clearnet not acked', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await expect(
      openInX(
        'profile',
        'target',
        deps({
          loadClearnetEnabled: async () => false,
          resolveGate: () => ({
            blocked: true,
            reason: 'Tor is not ready — X capture is blocked (no clearnet fallback).',
          }),
          openWindow,
        }),
      ),
    ).rejects.toThrow(/Tor is not ready|blocked/i);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens over the resolved SOCKS proxy in Tor mode (proxy threaded to openWindow)', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await openInX(
      'identity',
      'target',
      deps({ resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9150' } }), openWindow }),
    );
    expect(openWindow).toHaveBeenCalledWith('https://x.com/target', { socks: '127.0.0.1:9150' });
  });

  it('opens with NO proxy when clearnet is acked (operator opted in)', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await openInX(
      'profile',
      'target',
      deps({ loadClearnetEnabled: async () => true, resolveGate: () => ({ blocked: false }), openWindow }),
    );
    expect(openWindow).toHaveBeenCalledWith('https://x.com/target', undefined);
  });
});
