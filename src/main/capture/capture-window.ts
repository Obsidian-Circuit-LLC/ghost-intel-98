/**
 * Hardened capture-window harness (Plan A, Task F1).
 *
 * The shared factory behind the X Listening Station (and, in Plan B, Telegram
 * Hunter): a single main-process `BrowserWindow`, one per named session
 * partition, locked down to the minimum surface a visible-DOM scrape needs.
 *
 * CLEARNET-QUARANTINE NOTE: this module opens ONLY the window's own intrinsic
 * HTTPS egress to whatever `url`/`allowHosts` the caller supplies. It imports
 * NOTHING from `src/main/bgconn/*`, Tor, socks, `socmint`, or `telegram` — the
 * import-graph sentinel depends on that staying true. The optional `proxy` is a
 * generic SOCKS relay Plan B (Telegram over Tor) wires in from ITS own trust
 * domain; the X caller never passes one (clearnet, operator's own IP + cookies).
 *
 * Every window created here is hardened per the plan's Global Constraints:
 *   nodeIntegration:false, contextIsolation:true, sandbox:true,
 *   webviewTag:false, webSecurity:true; a deny-by-default
 *   `setWindowOpenHandler`; and a `will-navigate` guard that prevents any
 *   navigation to a host outside `allowHosts` (or to a non-HTTP(S) scheme).
 *
 * Ported and hardened from quarantine `electron/main.cjs:214-268` (the
 * `webPreferences` lockdown + deny-by-default open handler + permission-deny),
 * with the will-navigate host-allowlist guard added.
 */

import { BrowserWindow, session } from 'electron';
import { withNavigationTimeout, NAVIGATION_TIMEOUT_MS } from './nav-timeout';

export interface CaptureWindowOpts {
  /** Session partition the window runs on, e.g. `persist:x-listening`. */
  partition: string;
  /** Initial URL to load. Must be reachable under `allowHosts`. */
  url: string;
  /** Hostnames the window may navigate to (exact host or a subdomain of one). */
  allowHosts: string[];
  /** Optional SOCKS proxy applied to the partition session BEFORE the first load.
   *  Plan B (Telegram-over-Tor) only — the X caller never supplies this. */
  proxy?: { socks: string };
  /** Optional WebRTC IP-handling policy applied to the window's webContents
   *  BEFORE the guest navigates, and re-asserted on every later same-webContents
   *  navigation. Plan B (Telegram-over-Tor) passes `'disable_non_proxied_udp'` so a
   *  STUN/TURN path cannot leak the real IP around the SOCKS proxy during the very
   *  first load; the factory awaits `loadURL`, so setting this AFTER the factory
   *  returned would apply it too late. The X caller (clearnet) never supplies this. */
  webRTCIPHandlingPolicy?:
    | 'default'
    | 'default_public_interface_only'
    | 'default_public_and_private_interfaces'
    | 'disable_non_proxied_udp';
}

/** Deny every permission request/check on the capture partition — a scrape
 *  window never needs camera/mic/geo/notifications/clipboard, and deny-by-default
 *  is the safe posture for a cookie-authenticated window the analyst may not see. */
function lockDownCaptureSession(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/** True iff `host` is an allowed host exactly, or a subdomain of one. Case-insensitive. */
function hostAllowed(host: string, allowHosts: string[]): boolean {
  const h = host.toLowerCase();
  return allowHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    return h === a || h.endsWith(`.${a}`);
  });
}

/**
 * Build a hardened capture window on `opts.partition`, apply the optional proxy
 * to that partition's session BEFORE loading, install the deny-by-default open
 * handler + the will-navigate host-allowlist guard, then load `opts.url`.
 *
 * Order (per the plan): create session → (await setProxy if proxy) → create the
 * hardened window + install guards → loadURL. setProxy is awaited before the
 * first navigation so a proxied window never leaks a pre-proxy request.
 */
export async function createCaptureWindow(
  opts: CaptureWindowOpts
): Promise<Electron.BrowserWindow> {
  const ses = session.fromPartition(opts.partition);
  lockDownCaptureSession(ses);

  if (opts.proxy) {
    await ses.setProxy({
      proxyRules: `socks5://${opts.proxy.socks}`,
      proxyBypassRules: ''
    });
  }

  const win = new BrowserWindow({
    show: false,
    width: 1240,
    height: 900,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      partition: opts.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  // Deny-by-default: the window may never spawn a new window/tab.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Refuse any in-place navigation to a non-HTTP(S) scheme or a host outside the
  // allowlist. Applied to BOTH `will-navigate` and `will-redirect`: a will-navigate
  // guard alone is bypassed by a server-side 3xx / meta-refresh that Electron surfaces
  // as `will-redirect`, not `will-navigate` — so a hostile page could redirect the
  // capture surface off-host and out from under the guard. The same scheme/host check
  // on both closes that gap.
  const guardNavigation = (e: Electron.Event, navUrl: string): void => {
    try {
      const u = new URL(navUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        e.preventDefault();
        return;
      }
      if (!hostAllowed(u.hostname, opts.allowHosts)) {
        e.preventDefault();
      }
    } catch {
      e.preventDefault();
    }
  };
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  // Lock WebRTC IP handling BEFORE the guest navigates. This runs after window
  // creation but BEFORE `loadURL`, so no STUN/TURN path can leak the real IP
  // around a SOCKS proxy during the initial load. Re-assert on every later
  // same-webContents navigation (e.g. an in-family deep-link) so the lock cannot
  // be silently dropped by a subsequent navigation.
  if (opts.webRTCIPHandlingPolicy) {
    const policy = opts.webRTCIPHandlingPolicy;
    win.webContents.setWebRTCIPHandlingPolicy(policy);
    win.webContents.on('did-start-navigation', () => {
      win.webContents.setWebRTCIPHandlingPolicy(policy);
    });
  }

  // Bounded: an unbounded loadURL over Tor could stall forever, and every X Listening collection op
  // awaits this INSIDE the app-wide collection mutex — one stalled navigation disabled all collection
  // until the app restarted (v3.72.2 field report). Fail-closed instead of hanging.
  await withNavigationTimeout(() => win.loadURL(opts.url), NAVIGATION_TIMEOUT_MS, opts.url);
  return win;
}

/**
 * Run a STATIC JavaScript payload in the capture page's isolated world and
 * resolve its result. `staticJs` must be a fixed, non-interpolated string built
 * by the caller (the X extract scripts are asserted to contain no `${…}`); this
 * harness never builds the payload from scraped input. `userGesture=true` so the
 * page treats the call as user-initiated where that matters.
 */
export function runCapture(win: Electron.BrowserWindow, staticJs: string): Promise<unknown> {
  return win.webContents.executeJavaScript(staticJs, true);
}

/** The app's own local renderer pages. `station.html` is GhostExodus's X Listening Station in its
 *  own top-level window (v3.74.0) — a page THIS build emits, loaded from `file:` like index.html.
 *  Kept as an explicit two-name allowlist rather than "any local .html": the whole purpose of this
 *  gate is that a capture window can host a hostile remote page, so the rule must stay tight. */
const APP_PAGES = /(?:^|\/)(?:index|station)\.html$/i;

/** True iff `url` is one of the app's own renderer frames — a `file://…` app page, or (dev only)
 *  the Vite dev-server renderer origin. */
function isTrustedSenderUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:' && APP_PAGES.test(u.pathname)) {
    return true;
  }
  const devOrigin = process.env['ELECTRON_RENDERER_URL'];
  if (devOrigin) {
    try {
      if (u.origin === new URL(devOrigin).origin) return true;
    } catch {
      /* ignore a malformed dev origin */
    }
  }
  return false;
}

/**
 * Throw unless the IPC event originates from the app's own renderer frame. Every
 * capture/X IPC handler calls this first: a hardened capture window can host a
 * hostile remote page (x.com), so an IPC message whose `senderFrame.url` is a
 * remote origin must never be honoured. No token or frame content is logged.
 */
export function assertTrustedSender(e: Electron.IpcMainInvokeEvent): void {
  const url = e?.senderFrame?.url;
  if (!isTrustedSenderUrl(url)) {
    throw new Error('Rejected IPC from an untrusted sender frame.');
  }
}
