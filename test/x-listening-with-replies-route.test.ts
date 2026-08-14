import { describe, it, expect, vi } from 'vitest';

/**
 * Audit HIGH #4 — /with_replies route (FA2 behavioral-fidelity).
 *
 * His `scrapeProfile` loads `https://x.com/<user>/with_replies` when `collectReplies` is on
 * (main.cjs:1647-1648) — the tab that surfaces the target's OWN replies — and the bare profile
 * otherwise. Ours always loaded the bare profile, crippling reply capture even with the toggle on.
 *
 * This exercises BOTH capture entry points on our hardened core:
 *  - `captureProfileTimeline` — the self-opening Tor-gated sweep/archive primitive.
 *  - `navigateXToProfile` — the manual one-click "Capture Timeline" navigator.
 *
 * The handle stays validated (`^[A-Za-z0-9_]{1,15}$`) + host-anchored; `/with_replies` is a fixed
 * literal appended AFTER validation (no injection).
 */

// session.ts pulls electron/tor at import — stub them (mirrors x-listening-navigate.test.ts).
vi.mock('../src/main/capture/capture-window', () => ({ createCaptureWindow: vi.fn() }));
vi.mock('../src/main/bgconn/tor-singleton', () => ({ getBgTor: vi.fn(() => null) }));
vi.mock('electron', () => ({ session: { fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(async () => []) } })) } }));

import { captureProfileTimeline } from '../src/main/x-listening/capture';
import { navigateXToProfile } from '../src/main/x-listening/session';

const CASE = '11111111-1111-4111-8111-111111111111';

function fakeWin() {
  return {
    webContents: { setWebRTCIPHandlingPolicy() {} },
    isDestroyed: () => false,
    destroy() {},
  } as never;
}

// -------- captureProfileTimeline (sweep + archive path) ----------------------

describe('captureProfileTimeline — /with_replies route follows collect.replies', () => {
  function run(collect: { replies: boolean; reposts: boolean; comments: boolean } | undefined, targetUsername = 'GhostExodus') {
    const openWindow = vi.fn(async () => fakeWin());
    const capture = vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, posts: [] }));
    return {
      openWindow,
      promise: captureProfileTimeline(
        { caseId: CASE, channelId: 'g', channelLabel: '@g', targetUsername, collect },
        {
          loadClearnetEnabled: async () => false,
          resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9050' } }),
          openWindow: openWindow as never,
          capture: capture as never,
        },
      ),
    };
  }

  it('collect.replies ON → opens https://x.com/<user>/with_replies', async () => {
    const { openWindow, promise } = run({ replies: true, reposts: false, comments: false });
    await promise;
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow.mock.calls[0][0]).toBe('https://x.com/GhostExodus/with_replies');
  });

  it('collect.replies OFF → opens the bare profile https://x.com/<user>', async () => {
    const { openWindow, promise } = run({ replies: false, reposts: true, comments: true });
    await promise;
    expect(openWindow.mock.calls[0][0]).toBe('https://x.com/GhostExodus');
  });

  it('collect absent → bare profile (default all-off)', async () => {
    const { openWindow, promise } = run(undefined);
    await promise;
    expect(openWindow.mock.calls[0][0]).toBe('https://x.com/GhostExodus');
  });

  it('an invalid handle is rejected BEFORE any window opens — even with replies on', async () => {
    const openWindow = vi.fn(async () => fakeWin());
    await expect(
      captureProfileTimeline(
        { caseId: CASE, channelId: 'g', channelLabel: '@g', targetUsername: 'bad name/../evil', collect: { replies: true, reposts: false, comments: false } },
        {
          loadClearnetEnabled: async () => false,
          resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9050' } }),
          openWindow: openWindow as never,
          capture: vi.fn() as never,
        },
      ),
    ).rejects.toThrow(/valid X username/i);
    expect(openWindow).not.toHaveBeenCalled();
  });
});

// -------- navigateXToProfile (manual one-click capture path) ------------------

describe('navigateXToProfile — /with_replies route follows the collectReplies option', () => {
  const WIN = {} as never;
  function deps(overrides: Record<string, unknown> = {}) {
    return {
      resolveWindow: () => WIN,
      loadUrl: vi.fn(async () => {}),
      runScript: vi.fn(async () => ({ url: 'https://x.com/u', text: '', articles: 3 })),
      delay: vi.fn(async () => {}),
      maxAttempts: 5,
      intervalMs: 1,
      ...overrides,
    };
  }

  it('collectReplies ON → loads https://x.com/<handle>/with_replies', async () => {
    const d = deps();
    await navigateXToProfile(CASE, '@ExodusGhost', d, { collectReplies: true });
    expect(d.loadUrl).toHaveBeenCalledWith(WIN, 'https://x.com/ExodusGhost/with_replies');
  });

  it('collectReplies OFF (or absent) → loads the bare profile', async () => {
    const d = deps();
    await navigateXToProfile(CASE, 'ExodusGhost', d, { collectReplies: false });
    expect(d.loadUrl).toHaveBeenCalledWith(WIN, 'https://x.com/ExodusGhost');
    const d2 = deps();
    await navigateXToProfile(CASE, 'ExodusGhost', d2);
    expect(d2.loadUrl).toHaveBeenCalledWith(WIN, 'https://x.com/ExodusGhost');
  });

  it('an invalid handle is rejected BEFORE loading — even with replies on', async () => {
    const d = deps();
    await expect(
      navigateXToProfile(CASE, 'https://x.com/evil?x=1', d, { collectReplies: true }),
    ).rejects.toThrow(/not a valid X username/);
    expect(d.loadUrl).not.toHaveBeenCalled();
  });
});
