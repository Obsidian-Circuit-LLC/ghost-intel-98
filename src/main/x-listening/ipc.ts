/**
 * X Listening Station — connect / status / challenge-refusal IPC (Plan A, Task X2).
 *
 * The main-side seam that opens an authenticated X session in the shared hardened
 * capture window (F1) and derives connectivity from the auth cookie WITHOUT ever
 * copying, echoing, or logging the token. Also the challenge-refusal gate: before
 * any capture runs, the visible page state is probed and — on an X verification /
 * rate-limit / arkose interstitial, or a signed-out page — capture STOPS and
 * reports `blocked`. It NEVER attempts to solve or bypass a challenge.
 *
 * CLEARNET-QUARANTINE NOTE: this module imports ONLY the shared capture harness
 * and electron's `session`. It pulls in NOTHING from `bgconn`/Tor/socks/`socmint`/
 * `telegram`; the X caller passes NO proxy (clearnet, the operator's own IP +
 * cookies). Ported and hardened from quarantine `electron/main.cjs`:
 *   - `getXSessionStatus` (auth-cookie → boolean) at `main.cjs:236-242`
 *   - `assertSignedInPage` (challenge refusal) at `main.cjs:426-443`
 * The quarantine THREW on a challenge; here the gate returns a structured
 * `{ blocked:true }` so the caller stops cleanly and runs no capture.
 */

import { session } from 'electron';
import { channels } from '@shared/ipc-contracts';
import {
  createCaptureWindow,
  runCapture,
  assertTrustedSender
} from '../capture/capture-window';

/** Clearnet partition the authenticated X session lives on. Matches the X1 contract. */
export const X_LISTENING_PARTITION = 'persist:x-listening';
/** The signed-in landing surface the connect window loads. */
export const X_HOME_URL = 'https://x.com/home';
/** Hosts the capture window may navigate to (x.com / twitter.com + subdomains). */
export const X_ALLOW_HOSTS = ['x.com', 'twitter.com'];

/** The single live connect window, reused across `connect()` calls. */
let xWindow: Electron.BrowserWindow | null = null;

/** Test hook: drop the cached connect window so each case starts clean. */
export function __resetXWindowForTests(): void {
  xWindow = null;
}

/**
 * Open (or reopen) the hardened X login window on the clearnet partition. No proxy
 * is ever supplied — X is a clearnet-quarantine trust domain. If a live window
 * already exists it is surfaced rather than duplicated.
 */
export async function connectXSession(): Promise<{ opened: boolean }> {
  if (xWindow && !xWindow.isDestroyed()) {
    xWindow.show();
    xWindow.focus();
    return { opened: true };
  }
  const win = await createCaptureWindow({
    partition: X_LISTENING_PARTITION,
    url: X_HOME_URL,
    allowHosts: X_ALLOW_HOSTS
    // NO `proxy`: clearnet quarantine — the operator's own IP + cookies.
  });
  xWindow = win;
  win.show();
  win.focus();
  return { opened: true };
}

/** True iff `domain` is x.com / twitter.com or a subdomain of either. */
function isXAuthDomain(domain: string): boolean {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(domain);
}

/**
 * Derive a `connected` boolean from the presence of an `auth_token` cookie scoped
 * to x.com / twitter.com. The token VALUE is read for the domain check only and is
 * never returned, echoed, or logged. Port of quarantine `main.cjs:236-242`.
 */
export async function xSessionStatus(): Promise<{ connected: boolean }> {
  const ses = session.fromPartition(X_LISTENING_PARTITION);
  const cookies = await ses.cookies.get({ name: 'auth_token' });
  const connected = cookies.some((c) => isXAuthDomain(c.domain || ''));
  return { connected };
}

/** Shape returned by the in-page state probe (visible-DOM only). */
export interface PageState {
  url: string;
  text: string;
  articles: number;
}

/**
 * STATIC page-state probe. No interpolation — the harness never builds a payload
 * from scraped input. Reads only the current URL, a bounded slice of visible body
 * text, and the count of rendered tweet articles. Port of quarantine
 * `main.cjs:427-432` (the `assertSignedInPage` probe).
 */
export const PAGE_STATE_SCRIPT = `(() => ({
  url: location.href,
  text: (document.body && document.body.innerText || '').slice(0, 5000),
  articles: document.querySelectorAll('article[data-testid="tweet"]').length
}))()`;

const LOGIN_URL_RE = /\/i\/flow\/login/i;
const LOGIN_TEXT_RE = /sign in to x/i;
const CHALLENGE_RE =
  /verify your identity|unusual activity|temporarily limited|rate limit exceeded|try again later|security check|arkose/i;

/**
 * Classify a captured page state (pure). `blocked` marks an X verification /
 * rate-limit / arkose interstitial the analyst must resolve manually — capture
 * must STOP, never solve. `signedIn` is false on the login/flow page (session
 * expired). Port of the two `assertSignedInPage` branches at `main.cjs:436-442`.
 */
export function classifyPageState(page: PageState): {
  signedIn: boolean;
  blocked: boolean;
  reason?: string;
} {
  const url = String(page?.url || '');
  const text = String(page?.text || '');
  if (CHALLENGE_RE.test(text)) {
    return {
      signedIn: true,
      blocked: true,
      reason:
        'X presented a verification challenge or temporary limit. Collection stopped without attempting to bypass it — resolve the prompt in the X session before continuing.'
    };
  }
  if (LOGIN_URL_RE.test(url) || LOGIN_TEXT_RE.test(text)) {
    return {
      signedIn: false,
      blocked: false,
      reason: 'The saved X session is no longer signed in. Reconnect it before continuing.'
    };
  }
  return { signedIn: true, blocked: false };
}

/** Probe the live capture window and classify its visible state. Visible-DOM only. */
export async function checkCaptureAllowed(win: Electron.BrowserWindow): Promise<{
  signedIn: boolean;
  blocked: boolean;
  reason?: string;
}> {
  const raw = (await runCapture(win, PAGE_STATE_SCRIPT)) as PageState;
  return classifyPageState({
    url: String(raw?.url || ''),
    text: String(raw?.text || ''),
    articles: Number(raw?.articles || 0)
  });
}

/**
 * Run `capture` ONLY when the live page is signed in and unchallenged. On a
 * challenge or a signed-out page the capture callback is never invoked and the
 * caller gets `{ blocked:true, reason }`. This is the single refusal gate every
 * X capture path (X3+) routes through.
 */
export async function guardedCapture<T>(
  win: Electron.BrowserWindow,
  capture: () => Promise<T>
): Promise<{ blocked: boolean; reason?: string; result?: T }> {
  const state = await checkCaptureAllowed(win);
  if (state.blocked) {
    return { blocked: true, reason: state.reason };
  }
  if (!state.signedIn) {
    return { blocked: true, reason: state.reason ?? 'The saved X session is no longer signed in.' };
  }
  const result = await capture();
  return { blocked: false, result };
}

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => void;

/**
 * Wire the connect/status channels. Every handler validates the sender frame
 * FIRST (`assertTrustedSender`) — a hardened capture window can host a hostile
 * remote page, so an IPC message from a non-app frame must never be honoured —
 * then runs under the injected `handle`.
 *
 * The injected `handle` MUST be an event-PRESERVING wrapper: register.ts supplies
 * `safeHandleWithEvent` (vault gate + error sanitisation + the raw
 * `IpcMainInvokeEvent` forwarded as the handler's first argument). This is NOT the
 * plain `safeHandle` the investigation seams use — that one discards the event and
 * passes only the renderer args, which would leave `assertTrustedSender` reading a
 * renderer-controlled value (spoofable) or `undefined` (fails closed). The event
 * this handler validates is delivered by Electron/`ipcMain`, never by the renderer.
 */
export function registerXListeningIpc(deps: { handle: HandleWithEvent }): void {
  deps.handle(channels.xListening.connect, (e) => {
    assertTrustedSender(e);
    return connectXSession();
  });
  deps.handle(channels.xListening.status, (e) => {
    assertTrustedSender(e);
    return xSessionStatus();
  });
}
