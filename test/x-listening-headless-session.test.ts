import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Headless capture — session.ts `connectXSession({ visible })`.
 *
 * GhostExodus's Enterprise app scraped in the BACKGROUND: "it shouldn't pop up the dedicated
 * Chromium browser when Capturing Timeline or adding entities". Our one-click capture opened a
 * VISIBLE window because `connectXSession` unconditionally called `win.show()`/`win.focus()`.
 *
 * The fix: `connectXSession` gains a `{ visible?: boolean }` option that DEFAULTS to visible
 * (the explicit "Open Session" sign-in action), but the capture paths (captureTimeline
 * ensure-window, sweeps) pass `{ visible: false }` so the capture window stays hidden.
 *
 * This mirrors `x-listening-tor.test.ts`'s mock harness, extended so `show`/`focus` calls are
 * RECORDED (that test built them as fresh `vi.fn()`s per window and never inspected them). The
 * Tor fail-closed posture is unchanged and still owned by `x-listening-tor.test.ts`.
 */

const rec = vi.hoisted(() => ({
  createCalls: [] as Array<Record<string, unknown>>,
  showCalls: 0,
  focusCalls: 0,
  bootstrapped: true,
  socksPort: 9050,
}));

vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async (opts: Record<string, unknown>) => {
    rec.createCalls.push(opts);
    return {
      isDestroyed: () => false,
      show: vi.fn(() => {
        rec.showCalls += 1;
      }),
      focus: vi.fn(() => {
        rec.focusCalls += 1;
      }),
      close: vi.fn(),
      webContents: {
        setWebRTCIPHandlingPolicy: vi.fn(),
      },
    };
  }),
}));

vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: vi.fn(() => ({
    isBootstrapped: () => rec.bootstrapped,
    socksPort: () => rec.socksPort,
  })),
}));

vi.mock('electron', () => ({
  session: {
    fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(async () => []) } })),
  },
}));

import { connectXSession, __resetXSessionsForTests } from '../src/main/x-listening/session';

const CASE_A = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  rec.createCalls = [];
  rec.showCalls = 0;
  rec.focusCalls = 0;
  rec.bootstrapped = true;
  rec.socksPort = 9050;
  __resetXSessionsForTests();
});

describe('connectXSession — headless capture option', () => {
  it('opens the capture window WITHOUT showing/focusing it when { visible: false }', async () => {
    const out = await connectXSession(CASE_A, false, { visible: false });
    expect(out).toMatchObject({ blocked: false });
    // The window WAS created (Tor-routed) …
    expect(rec.createCalls).toHaveLength(1);
    // … but never popped up.
    expect(rec.showCalls).toBe(0);
    expect(rec.focusCalls).toBe(0);
  });

  it('SHOWS and focuses the window by default (the visible "Open Session" sign-in action)', async () => {
    const out = await connectXSession(CASE_A, false);
    expect(out).toMatchObject({ blocked: false });
    expect(rec.createCalls).toHaveLength(1);
    expect(rec.showCalls).toBe(1);
    expect(rec.focusCalls).toBe(1);
  });

  it('SHOWS and focuses when { visible: true } is passed explicitly', async () => {
    await connectXSession(CASE_A, false, { visible: true });
    expect(rec.showCalls).toBe(1);
    expect(rec.focusCalls).toBe(1);
  });

  it('does NOT show/focus a REUSED live window when { visible: false }', async () => {
    // First open it hidden…
    await connectXSession(CASE_A, false, { visible: false });
    expect(rec.showCalls).toBe(0);
    // …a second hidden ensure-window must not pop the existing window either.
    const out = await connectXSession(CASE_A, false, { visible: false });
    expect(out).toMatchObject({ blocked: false });
    expect(rec.createCalls).toHaveLength(1); // reused, not re-created
    expect(rec.showCalls).toBe(0);
    expect(rec.focusCalls).toBe(0);
  });

  it('shows a reused live window when a later visible Open Session is invoked', async () => {
    await connectXSession(CASE_A, false, { visible: false });
    expect(rec.showCalls).toBe(0);
    await connectXSession(CASE_A, false); // visible default → bring the hidden window forward
    expect(rec.createCalls).toHaveLength(1); // still reused
    expect(rec.showCalls).toBe(1);
    expect(rec.focusCalls).toBe(1);
  });

  it('FAIL CLOSED is unchanged: { visible: false } never opens a window when Tor is down + clearnet off', async () => {
    rec.bootstrapped = false;
    const out = await connectXSession(CASE_A, false, { visible: false });
    expect(out).toMatchObject({ blocked: true });
    expect(rec.createCalls).toHaveLength(0);
    expect(rec.showCalls).toBe(0);
  });
});
