import { describe, it, expect, vi } from 'vitest';

/**
 * One-click-capture fix: `navigateXToProfile` drives the case's capture window to a target profile
 * and waits (bounded) for the X SPA to render posts before the scrape. Validates the handle before
 * building the URL, waits through a still-rendering page, and fails SOFT on a render timeout so the
 * caller reports 0 honestly rather than the old hard "X is not connected" error.
 *
 * navigateXToProfile takes injectable seams (resolveWindow/loadUrl/runScript/delay), so no real
 * electron window is needed — but importing session.ts pulls its top-level electron imports, hence
 * the mocks below.
 */
vi.mock('../src/main/capture/capture-window', () => ({ createCaptureWindow: vi.fn() }));
vi.mock('../src/main/bgconn/tor-singleton', () => ({ getBgTor: vi.fn(() => null) }));
vi.mock('electron', () => ({ session: { fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(async () => []) } })) } }));

import { navigateXToProfile } from '../src/main/x-listening/session';

const WIN = {} as never; // opaque — loadUrl/runScript are injected

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

// caseId must pass ensureUuid — use a real UUID.
const CASE = '11111111-1111-4111-8111-111111111111';

describe('navigateXToProfile — one-click capture navigate + readiness poll', () => {
  it('strips @, validates, and loads exactly https://x.com/<handle>', async () => {
    const d = deps();
    const r = await navigateXToProfile(CASE, '@ExodusGhost', d);
    expect(d.loadUrl).toHaveBeenCalledWith(WIN, 'https://x.com/ExodusGhost');
    expect(r).toEqual({ ready: true, blocked: false });
  });

  it('rejects an invalid username (e.g. a raw URL) BEFORE loading anything', async () => {
    const d = deps();
    await expect(navigateXToProfile(CASE, 'https://x.com/evil?x=1', d)).rejects.toThrow(/not a valid X username/);
    expect(d.loadUrl).not.toHaveBeenCalled();
  });

  it('waits through a still-rendering page (articles 0 → N) then reports ready', async () => {
    let n = 0;
    const runScript = vi.fn(async () => ({ url: 'https://x.com/u', text: '', articles: n++ >= 2 ? 4 : 0 }));
    const r = await navigateXToProfile(CASE, 'u', deps({ runScript }));
    expect(r).toEqual({ ready: true, blocked: false });
    expect(runScript).toHaveBeenCalledTimes(3); // 0, 0, 4
  });

  it('returns blocked (not ready) on a signed-out / login page — captures nothing', async () => {
    const runScript = vi.fn(async () => ({ url: 'https://x.com/i/flow/login', text: 'Sign in to X', articles: 0 }));
    const r = await navigateXToProfile(CASE, 'u', deps({ runScript }));
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/signed in/i);
  });

  it('render timeout is SOFT — {ready:false, blocked:false} so the caller still captures + reports 0', async () => {
    const runScript = vi.fn(async () => ({ url: 'https://x.com/u', text: '', articles: 0 }));
    const r = await navigateXToProfile(CASE, 'u', deps({ runScript, maxAttempts: 3 }));
    expect(r).toEqual({ ready: false, blocked: false });
    expect(runScript).toHaveBeenCalledTimes(3);
  });

  it('throws when no capture window resolves (the caller opens one first)', async () => {
    await expect(navigateXToProfile(CASE, 'u', deps({ resolveWindow: () => undefined }))).rejects.toThrow(/No capture window/);
  });
});
