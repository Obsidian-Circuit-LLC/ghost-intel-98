import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task X2 — authenticated X session + challenge refusal.
 *
 * These tests drive the X Listening Station's connect/status seam and the
 * challenge-refusal gate. They mock BOTH the shared capture-window harness (F1)
 * — so connect/status logic is exercised without a real Electron BrowserWindow —
 * and electron's partition `session.cookies`, so `status()` can be proven to
 * derive a boolean WITHOUT ever surfacing the auth token.
 */

const rec = vi.hoisted(() => ({
  createArgs: null as Record<string, unknown> | null,
  win: null as { show: () => void; focus: () => void; isDestroyed: () => boolean } | null,
  runCalls: [] as string[],
  cookieQuery: null as Record<string, unknown> | null,
  cookies: [] as Array<{ name: string; value: string; domain: string }>,
  pageState: { url: '', text: '', articles: 0 } as { url: string; text: string; articles: number }
}));

// F1's harness — createCaptureWindow / runCapture / assertTrustedSender — is the
// interface X2 consumes. Mock it so the connect path never touches real Electron.
vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async (opts: Record<string, unknown>) => {
    rec.createArgs = opts;
    rec.win = {
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: () => false
    };
    return rec.win;
  }),
  runCapture: vi.fn(async (_win: unknown, js: string) => {
    rec.runCalls.push(js);
    return rec.pageState;
  }),
  assertTrustedSender: vi.fn()
}));

vi.mock('electron', () => ({
  session: {
    fromPartition: vi.fn(() => ({
      cookies: {
        get: vi.fn(async (q: Record<string, unknown>) => {
          rec.cookieQuery = q;
          return rec.cookies;
        })
      }
    }))
  }
}));

import {
  connectXSession,
  xSessionStatus,
  classifyPageState,
  checkCaptureAllowed,
  guardedCapture,
  registerXListeningIpc,
  PAGE_STATE_SCRIPT,
  X_LISTENING_PARTITION,
  X_HOME_URL,
  __resetXWindowForTests
} from '../src/main/x-listening/ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';

beforeEach(() => {
  rec.createArgs = null;
  rec.win = null;
  rec.runCalls = [];
  rec.cookieQuery = null;
  rec.cookies = [];
  rec.pageState = { url: '', text: '', articles: 0 };
  vi.mocked(assertTrustedSender).mockClear();
  __resetXWindowForTests();
});

describe('connectXSession — clearnet, persist:x-listening, no proxy', () => {
  it('opens a hardened window on persist:x-listening at x.com/home with NO proxy', async () => {
    const r = await connectXSession();
    expect(r).toEqual({ opened: true });
    expect(rec.createArgs!.partition).toBe('persist:x-listening');
    expect(rec.createArgs!.partition).toBe(X_LISTENING_PARTITION);
    expect(rec.createArgs!.url).toBe('https://x.com/home');
    expect(rec.createArgs!.url).toBe(X_HOME_URL);
    // clearnet-quarantine: the X caller NEVER supplies a SOCKS proxy.
    expect(rec.createArgs!.proxy).toBeUndefined();
    expect(rec.createArgs!.allowHosts).toContain('x.com');
    expect(rec.createArgs!.allowHosts).toContain('twitter.com');
  });

  it('shows the login window so the analyst can complete auth', async () => {
    await connectXSession();
    expect(rec.win!.show).toHaveBeenCalled();
  });
});

describe('xSessionStatus — derived boolean, never the token', () => {
  it('reports connected:true when an x.com auth_token cookie exists, WITHOUT leaking the value', async () => {
    rec.cookies = [{ name: 'auth_token', value: 'SUPER_SECRET_TOKEN', domain: '.x.com' }];
    const s = await xSessionStatus();
    expect(s).toEqual({ connected: true });
    // The token value must never travel back across this boundary.
    expect(JSON.stringify(s)).not.toContain('SUPER_SECRET_TOKEN');
    expect(rec.cookieQuery).toEqual({ name: 'auth_token' });
  });

  it('reports connected:false when no auth cookie is present', async () => {
    rec.cookies = [];
    expect(await xSessionStatus()).toEqual({ connected: false });
  });

  it('ignores an auth_token scoped to an unrelated domain', async () => {
    rec.cookies = [{ name: 'auth_token', value: 'x', domain: '.evil.example' }];
    expect(await xSessionStatus()).toEqual({ connected: false });
  });

  it('accepts twitter.com as well as x.com', async () => {
    rec.cookies = [{ name: 'auth_token', value: 'x', domain: '.twitter.com' }];
    expect(await xSessionStatus()).toEqual({ connected: true });
  });
});

describe('classifyPageState — challenge refusal (pure)', () => {
  it('flags a verification/arkose page as blocked, never signed-in-capturable', () => {
    for (const text of [
      'Verify your identity to continue',
      'We noticed some unusual activity',
      'Your account is temporarily limited',
      'Rate limit exceeded, try again later',
      'Please complete this security check',
      'arkose challenge'
    ]) {
      const r = classifyPageState({ url: 'https://x.com/home', text, articles: 0 });
      expect(r.blocked).toBe(true);
    }
  });

  it('flags the login/flow page as signed-out (not blocked)', () => {
    const r = classifyPageState({ url: 'https://x.com/i/flow/login', text: 'Sign in to X', articles: 0 });
    expect(r.signedIn).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('treats a normal timeline as signed-in and unblocked', () => {
    const r = classifyPageState({ url: 'https://x.com/home', text: 'Home\nFollowing', articles: 12 });
    expect(r.signedIn).toBe(true);
    expect(r.blocked).toBe(false);
  });
});

describe('guardedCapture — STOP on a challenge, run no capture', () => {
  it('a challenge fixture yields blocked:true and never invokes the capture callback', async () => {
    rec.pageState = { url: 'https://x.com/home', text: 'Please complete this security check (arkose)', articles: 0 };
    const capture = vi.fn(async () => 'CAPTURED');
    const r = await guardedCapture(rec.win ?? ({} as never), capture);
    expect(r.blocked).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it('a signed-out fixture blocks and never captures', async () => {
    rec.pageState = { url: 'https://x.com/i/flow/login', text: 'Sign in to X', articles: 0 };
    const capture = vi.fn(async () => 'CAPTURED');
    const r = await guardedCapture(rec.win ?? ({} as never), capture);
    expect(r.blocked).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it('a signed-in timeline runs the capture callback', async () => {
    rec.pageState = { url: 'https://x.com/home', text: 'Home timeline', articles: 5 };
    const capture = vi.fn(async () => 'CAPTURED');
    const r = await guardedCapture(rec.win ?? ({} as never), capture);
    expect(r.blocked).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(r.result).toBe('CAPTURED');
  });

  it('checkCaptureAllowed runs the page-state probe via the shared harness', async () => {
    rec.pageState = { url: 'https://x.com/home', text: 'Home', articles: 3 };
    const state = await checkCaptureAllowed(rec.win ?? ({} as never));
    expect(state.signedIn).toBe(true);
    expect(rec.runCalls).toContain(PAGE_STATE_SCRIPT);
  });
});

describe('PAGE_STATE_SCRIPT — static, no interpolation', () => {
  it('contains no template interpolation', () => {
    expect(PAGE_STATE_SCRIPT).not.toContain('${');
  });
});

describe('registerXListeningIpc — event-preserving safeHandle + assertTrustedSender', () => {
  /**
   * Model the app's REAL event-preserving wrapper (register.ts `safeHandleWithEvent`):
   * `ipcMain.handle(channel, (_e, ...args) => fn(_e, ...args))`. The IpcMainInvokeEvent is
   * supplied by Electron as the first callback parameter — NEVER by the renderer — and forwarded
   * to `fn` ahead of the renderer args. The test then invokes the registered handler exactly as
   * `ipcMain` would: `(electronEvent, ...rendererArgs)`. This is the calling convention the
   * production wiring actually uses; a mock that fabricated the event as a renderer arg would hide
   * the seam (the v3.24.2 collect-path failure class).
   */
  function fakeIpcMain() {
    const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      registered.set(channel, (e, ...args) => fn(e, ...args));
    };
    return { registered, handle };
  }

  it('registers connect/status and every handler asserts the Electron-supplied sender first', async () => {
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle });
    expect(ipc.registered.has('xListening:connect')).toBe(true);
    expect(ipc.registered.has('xListening:status')).toBe(true);

    // The event is what ipcMain hands the registered callback as its first parameter.
    const ev = { senderFrame: { url: 'file:///app/index.html' } };
    await ipc.registered.get('xListening:status')!(ev);
    expect(assertTrustedSender).toHaveBeenCalledWith(ev);

    vi.mocked(assertTrustedSender).mockClear();
    await ipc.registered.get('xListening:connect')!(ev);
    expect(assertTrustedSender).toHaveBeenCalledWith(ev);
  });

  it('validates the Electron event, never a renderer-supplied argument (no fail-open)', async () => {
    // Prove the sender check reads the ipcMain-supplied event, not renderer args: if a future
    // channel carried a payload, that payload must never be mistaken for the sender frame. Here the
    // renderer passes a spoofed event-shaped object as an arg AFTER the real event; assertTrustedSender
    // must still receive ONLY the genuine first-parameter event.
    const ipc = fakeIpcMain();
    registerXListeningIpc({ handle: ipc.handle });

    const realEvent = { senderFrame: { url: 'file:///app/index.html' } };
    const spoofedArg = { senderFrame: { url: 'https://x.com/attacker' } };
    await ipc.registered.get('xListening:status')!(realEvent, spoofedArg);

    expect(assertTrustedSender).toHaveBeenCalledTimes(1);
    expect(assertTrustedSender).toHaveBeenCalledWith(realEvent);
    expect(assertTrustedSender).not.toHaveBeenCalledWith(spoofedArg);
  });
});
