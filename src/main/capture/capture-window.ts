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

  await win.loadURL(opts.url);
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

/** True iff `url` is the app's own renderer frame — a `file://…/index.html`
 *  document, or (dev only) the Vite dev-server renderer origin. */
function isTrustedSenderUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:' && /(?:^|\/)index\.html$/i.test(u.pathname)) {
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
