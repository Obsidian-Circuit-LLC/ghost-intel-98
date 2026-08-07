import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records, per test, everything the hardened capture-window factory does to the
// mocked Electron primitives: the webPreferences it hands BrowserWindow, the
// open-handler return, the registered will-navigate guard, the partition
// session's setProxy call, and the global call ORDER (so the test can prove
// setProxy is awaited BEFORE loadURL).
const rec = vi.hoisted(() => ({
  webPreferences: null as Record<string, unknown> | null,
  openHandler: null as ((d: { url: string }) => { action: string }) | null,
  willNavigate: null as ((e: { preventDefault: () => void }, url: string) => void) | null,
  willRedirect: null as ((e: { preventDefault: () => void }, url: string) => void) | null,
  didStartNav: null as ((...a: unknown[]) => void) | null,
  setProxyArgs: null as Record<string, unknown> | null,
  webrtcPolicy: null as string | null,
  executeArgs: null as unknown[] | null,
  order: [] as string[]
}));

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents: {
      setWindowOpenHandler: (fn: (d: { url: string }) => { action: string }) => void;
      on: (event: string, fn: (...a: unknown[]) => void) => void;
      setWebRTCIPHandlingPolicy: (policy: string) => void;
      executeJavaScript: (js: string, userGesture?: boolean) => Promise<unknown>;
      loadURL: (u: string) => Promise<void>;
    };
    constructor(opts: { webPreferences?: Record<string, unknown> }) {
      rec.webPreferences = opts.webPreferences ?? null;
      this.webContents = {
        setWindowOpenHandler: (fn) => {
          rec.openHandler = fn;
        },
        on: (event, fn) => {
          if (event === 'will-navigate') {
            rec.willNavigate = fn as (e: { preventDefault: () => void }, url: string) => void;
          }
          if (event === 'will-redirect') {
            rec.willRedirect = fn as (e: { preventDefault: () => void }, url: string) => void;
          }
          if (event === 'did-start-navigation') {
            rec.didStartNav = fn as (...a: unknown[]) => void;
          }
        },
        setWebRTCIPHandlingPolicy: (policy: string) => {
          rec.webrtcPolicy = policy;
          rec.order.push('setWebRTC');
        },
        executeJavaScript: (js: string, userGesture?: boolean) => {
          rec.executeArgs = [js, userGesture];
          return Promise.resolve('EXEC_RESULT');
        },
        loadURL: (_u: string) => {
          rec.order.push('loadURL');
          return Promise.resolve();
        }
      };
    }
    loadURL(_u: string): Promise<void> {
      rec.order.push('loadURL');
      return Promise.resolve();
    }
  }
  const fakeSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setProxy: vi.fn((args: Record<string, unknown>) => {
      rec.setProxyArgs = args;
      rec.order.push('setProxy');
      return Promise.resolve();
    })
  };
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: vi.fn(() => fakeSession) }
  };
});

import {
  createCaptureWindow,
  runCapture,
  assertTrustedSender
} from '../src/main/capture/capture-window';

beforeEach(() => {
  rec.webPreferences = null;
  rec.openHandler = null;
  rec.willNavigate = null;
  rec.willRedirect = null;
  rec.didStartNav = null;
  rec.setProxyArgs = null;
  rec.webrtcPolicy = null;
  rec.executeArgs = null;
  rec.order = [];
});

describe('createCaptureWindow — hardening', () => {
  it('sets the full webPreferences lockdown', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com']
    });
    expect(rec.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true
    });
  });

  it('denies every window-open request', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com']
    });
    expect(rec.openHandler).toBeTypeOf('function');
    expect(rec.openHandler!({ url: 'https://x.com/anything' })).toEqual({ action: 'deny' });
    expect(rec.openHandler!({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
  });

  it('prevents navigation to a host outside allowHosts, permits one inside', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com', 'twitter.com']
    });
    expect(rec.willNavigate).toBeTypeOf('function');

    const blocked = { preventDefault: vi.fn() };
    rec.willNavigate!(blocked, 'https://evil.example/phish');
    expect(blocked.preventDefault).toHaveBeenCalled();

    const allowed = { preventDefault: vi.fn() };
    rec.willNavigate!(allowed, 'https://x.com/some/status/1');
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    // subdomain of an allowed host is permitted
    const sub = { preventDefault: vi.fn() };
    rec.willNavigate!(sub, 'https://mobile.twitter.com/home');
    expect(sub.preventDefault).not.toHaveBeenCalled();
  });

  it('guards will-redirect with the same scheme/host check (server 3xx / meta-refresh)', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com', 'twitter.com']
    });
    expect(rec.willRedirect).toBeTypeOf('function');

    // off-host redirect is blocked
    const offHost = { preventDefault: vi.fn() };
    rec.willRedirect!(offHost, 'https://evil.example/track');
    expect(offHost.preventDefault).toHaveBeenCalled();

    // non-http(s) scheme redirect is blocked
    const badScheme = { preventDefault: vi.fn() };
    rec.willRedirect!(badScheme, 'data:text/html,<script>1</script>');
    expect(badScheme.preventDefault).toHaveBeenCalled();

    // an in-allowlist redirect is permitted
    const allowed = { preventDefault: vi.fn() };
    rec.willRedirect!(allowed, 'https://x.com/i/redirect');
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });

  it('applies the proxy to the partition session and awaits setProxy BEFORE loadURL', async () => {
    await createCaptureWindow({
      partition: 'persist:tg',
      url: 'https://web.telegram.org/',
      allowHosts: ['web.telegram.org'],
      proxy: { socks: '127.0.0.1:9050' }
    });
    expect(rec.setProxyArgs).toBeTruthy();
    expect(String(rec.setProxyArgs!.proxyRules)).toContain('127.0.0.1:9050');
    expect(rec.setProxyArgs!.proxyBypassRules).toBe('');
    expect(rec.order).toEqual(['setProxy', 'loadURL']);
  });

  it('does NOT call setProxy when no proxy is given (clearnet path)', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com']
    });
    expect(rec.setProxyArgs).toBeNull();
    expect(rec.order).toEqual(['loadURL']);
  });

  it('sets the WebRTC IP-handling policy BEFORE loadURL when one is given (anonymity)', async () => {
    // The Telegram surface must lock WebRTC before the guest navigates, or a
    // STUN/TURN path can leak the real IP around the SOCKS proxy during the very
    // first load. Because the factory awaits loadURL, a caller that set the policy
    // AFTER createCaptureWindow returned would apply it post-navigation — too late.
    await createCaptureWindow({
      partition: 'persist:tg',
      url: 'https://web.telegram.org/k/',
      allowHosts: ['web.telegram.org'],
      proxy: { socks: '127.0.0.1:9050' },
      webRTCIPHandlingPolicy: 'disable_non_proxied_udp'
    });
    expect(rec.webrtcPolicy).toBe('disable_non_proxied_udp');
    // Ordering, the load-bearing assertion: proxy first, WebRTC lock next, THEN load.
    expect(rec.order).toEqual(['setProxy', 'setWebRTC', 'loadURL']);
    expect(rec.order.indexOf('setWebRTC')).toBeLessThan(rec.order.indexOf('loadURL'));
  });

  it('re-asserts the WebRTC policy on later same-webContents navigations', async () => {
    await createCaptureWindow({
      partition: 'persist:tg',
      url: 'https://web.telegram.org/k/',
      allowHosts: ['web.telegram.org'],
      webRTCIPHandlingPolicy: 'disable_non_proxied_udp'
    });
    expect(rec.didStartNav).toBeTypeOf('function');
    // A later in-place navigation (e.g. analyst opens a t.me profile) must not
    // silently drop the lock — the factory re-applies it.
    rec.webrtcPolicy = null;
    rec.didStartNav!();
    expect(rec.webrtcPolicy).toBe('disable_non_proxied_udp');
  });

  it('does NOT touch WebRTC policy when none is given (X clearnet path unaffected)', async () => {
    await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com']
    });
    expect(rec.webrtcPolicy).toBeNull();
    expect(rec.didStartNav).toBeNull();
    expect(rec.order).toEqual(['loadURL']);
  });
});

describe('runCapture', () => {
  it('runs the static JS with userGesture=true and returns the result', async () => {
    const win = await createCaptureWindow({
      partition: 'persist:x-listening',
      url: 'https://x.com/home',
      allowHosts: ['x.com']
    });
    const out = await runCapture(win, 'document.title');
    expect(rec.executeArgs).toEqual(['document.title', true]);
    expect(out).toBe('EXEC_RESULT');
  });
});

describe('assertTrustedSender', () => {
  const mkEvent = (url: string) =>
    ({ senderFrame: { url } }) as unknown as Electron.IpcMainInvokeEvent;

  it("throws for a scraped remote frame (https://x.com/...)", () => {
    expect(() => assertTrustedSender(mkEvent('https://x.com/evil'))).toThrow();
  });

  it("passes for the app's own file:// renderer frame", () => {
    expect(() =>
      assertTrustedSender(mkEvent('file:///opt/ghost-intel/resources/app.asar/renderer/index.html'))
    ).not.toThrow();
  });

  it('throws when senderFrame is missing entirely', () => {
    expect(() => assertTrustedSender({} as Electron.IpcMainInvokeEvent)).toThrow();
  });
});
