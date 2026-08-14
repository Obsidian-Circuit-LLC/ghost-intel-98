/**
 * X Listening Station — capture session + Tor posture (Task 3).
 *
 * Rebuild-not-port: the Enterprise quarantine (`electron/main.cjs`) shipped its own bundled
 * `tor.exe` and defaulted X to clearnet (the app's prior v3.68.0 "X = clearnet quarantine"
 * posture, `ipc.ts`'s `connectXSession`). This module supersedes both: X is now Tor-BY-DEFAULT,
 * routed through the app's single background Tor engine (`getBgTor()`), mirroring
 * `telegram-hunter/session.ts:44-74` fail-closed — no clearnet fallback while in Tor mode —
 * with one addition Telegram doesn't have: an operator-controlled, per-module clearnet opt-in
 * (`AppSettings.xListening.clearnet`, default false).
 *
 * The one-time real-IP acknowledgement UX (mirroring `ai.linkClearnetAcknowledged` /
 * `geoint.cctvResolveClearnetAck`) lives at the renderer settings layer (Task 13) — this module
 * takes the ALREADY-RESOLVED `clearnetEnabled` boolean from its caller and only enforces the
 * network-posture gate: Tor unless explicitly (and, upstream, acknowledged) opted out.
 *
 * CLEARNET-QUARANTINE NOTE mirrors `capture-window.ts`: THIS module (not `capture-window.ts`
 * itself) is the one that imports `bgconn`/Tor — the shared factory stays import-graph-clean so
 * the quarantine sentinel keeps proving Plan A's harness never reaches into Tor on its own.
 *
 * Migration note: `X_LISTENING_PARTITION`/`X_HOME_URL`/`X_ALLOW_HOSTS` are intentionally
 * redeclared here (not imported from the legacy `ipc.ts`, which this module's IPC wiring
 * supersedes at Task 6 and which Task 16 deletes outright) so this file has no dependency on
 * the code it is replacing.
 */

import type { BrowserWindow } from 'electron';
import { session as electronSession } from 'electron';
import { createCaptureWindow } from '../capture/capture-window';
import { getBgTor } from '../bgconn/tor-singleton';
import { ensureUuid } from '../security/validate';
import { X_PAGE_STATE_SCRIPT, classifyXPageState, type XPageState } from './extract';

/** Session partition the authenticated X capture windows run on — ONE shared login (the
 *  operator's own X account) across every campaign, so multiple per-case windows below still
 *  share the same cookie jar. */
export const X_LISTENING_PARTITION = 'persist:x-listening';
/** The signed-in landing surface a connect window loads. */
export const X_HOME_URL = 'https://x.com/home';
/** Hosts a capture window may navigate to (x.com / twitter.com + subdomains). */
export const X_ALLOW_HOSTS = ['x.com', 'twitter.com'];

export interface XConnectBlocked {
  blocked: true;
  reason: string;
}
export interface XConnectOk {
  blocked: false;
}
export type XConnectResult = XConnectBlocked | XConnectOk;

/** Options for `connectXSession`. */
export interface XConnectOptions {
  /**
   * Whether to SHOW + focus the capture window after opening it (or when reusing an already-open
   * one). Defaults to `true` — the explicit, operator-initiated "Open Session" (sign-in) action.
   *
   * The one-click CAPTURE paths pass `false`: GhostExodus's Enterprise app scraped in the
   * BACKGROUND — "it shouldn't pop up the dedicated Chromium browser when Capturing Timeline or
   * adding entities". A hidden ensure-window keeps that behaviour: the window is created (Tor-gated,
   * fail-closed, WebRTC-locked — all UNCHANGED), it simply never pops up or steals focus.
   */
  visible?: boolean;
}

export interface XSessionStatus {
  /** Derived from auth-cookie PRESENCE only — the token value is read for the domain check and
   *  never returned, echoed, or logged (mirrors the legacy `xSessionStatus`). */
  connected: boolean;
  /** Whether THIS case currently owns a live capture window (independent of `connected` — the
   *  cookie is partition-scoped and shared; the window is per-case). */
  windowOpen: boolean;
}

/** Live capture windows, keyed by caseId — each campaign (Task 5: a self-managed x-namespace
 *  scraping case) gets its own window so concurrent campaigns can each hold an open capture
 *  surface, while all of them share ONE authenticated session (`X_LISTENING_PARTITION`). */
const xWindows = new Map<string, BrowserWindow>();

/** Test-only: drop all cached session windows so each test starts clean. */
export function __resetXSessionsForTests(): void {
  xWindows.clear();
}

/** The resolved network posture for an X capture window. */
export type XTorGate =
  | { blocked: true; reason: string }
  | { blocked: false; proxy?: { socks: string } };

/**
 * Resolve the Tor posture for an X capture window from the already-acknowledged `clearnetEnabled`
 * flag. Shared by this module's per-case `connectXSession` AND the legacy `ipc.ts` connect path,
 * so NO X capture surface can open a proxy-less clearnet window while clearnet mode is off:
 *   - clearnet off + Tor not bootstrapped → `{ blocked }` (fail-closed, no clearnet fallback);
 *   - clearnet off + Tor ready → route over the Tor SOCKS proxy;
 *   - clearnet on → no proxy (the operator's own IP, behind the renderer's one-time ack).
 * The caller still applies `webRTCIPHandlingPolicy:'disable_non_proxied_udp'` regardless.
 */
export function resolveXTorGate(clearnetEnabled: boolean): XTorGate {
  if (clearnetEnabled) return { blocked: false };
  const tor = getBgTor();
  if (!tor?.isBootstrapped()) {
    return {
      blocked: true,
      reason:
        'Tor is not ready — X capture is blocked (no clearnet fallback). Enable clearnet mode ' +
        'in Settings to bypass Tor; your real IP will be exposed to X.'
    };
  }
  // Bare host:port; createCaptureWindow prepends `socks5://`. A dead/zero port still yields a
  // SOCKS rule with an empty bypass — connection-refused, never a direct clearnet request.
  return { blocked: false, proxy: { socks: `127.0.0.1:${tor.socksPort()}` } };
}

/**
 * Open (or reuse) the hardened X capture window for `caseId`.
 *
 * `clearnetEnabled` is the resolved value of `settings.xListening.clearnet` (default false),
 * read and gated by the caller (the Task 6 IPC handler) — this function trusts it as already
 * having passed the renderer's one-time acknowledgement, per this module's header.
 *
 *   - `clearnetEnabled === false` (Tor mode): requires `getBgTor()?.isBootstrapped()`. If Tor is
 *     not ready this returns `{ blocked: true }` and opens NO window — there is no clearnet
 *     fallback. When bootstrapped, the window is opened over the Tor SOCKS proxy.
 *   - `clearnetEnabled === true`: the Tor gate is skipped entirely and NO proxy is passed
 *     (clearnet, the operator's own IP).
 *   - EITHER path: WebRTC is locked to `disable_non_proxied_udp`, threaded through
 *     `createCaptureWindow`'s `webRTCIPHandlingPolicy` option so the factory applies it BEFORE
 *     the guest's first navigation (setting it only on the returned webContents would land
 *     after that first load), then re-asserted belt-and-braces on the returned webContents.
 *
 * `opts.visible` (default `true`) governs ONLY whether the opened/reused window is shown +
 * focused. The capture paths (the `captureTimeline` ensure-window, sweeps) pass `false` so the
 * window stays hidden — the Enterprise app scraped in the background and never popped up the
 * Chromium browser on a capture. The Tor gate + hardening above are identical regardless.
 */
export async function connectXSession(
  caseId: string,
  clearnetEnabled: boolean,
  opts: XConnectOptions = {}
): Promise<XConnectResult> {
  const id = ensureUuid(caseId, 'caseId');
  // Default VISIBLE (the "Open Session" sign-in action); the capture paths pass `visible:false`
  // so a one-click capture never pops up the Chromium window (Enterprise scraped in the
  // background). Only the show/focus is gated — the Tor gate + window hardening below are
  // identical on both paths.
  const visible = opts.visible !== false;

  const existing = xWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (visible) {
      existing.show();
      existing.focus();
    }
    return { blocked: false };
  }

  const gate = resolveXTorGate(clearnetEnabled);
  if (gate.blocked) return { blocked: true, reason: gate.reason };
  const proxy = gate.proxy;

  const win = await createCaptureWindow({
    partition: X_LISTENING_PARTITION,
    url: X_HOME_URL,
    allowHosts: X_ALLOW_HOSTS,
    ...(proxy ? { proxy } : {}),
    webRTCIPHandlingPolicy: 'disable_non_proxied_udp'
  });

  // Belt-and-braces re-assert on the returned webContents (idempotent).
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  xWindows.set(id, win);
  if (visible) {
    win.show();
    win.focus();
  }
  return { blocked: false };
}

/** True iff `domain` is x.com / twitter.com or a subdomain of either. */
function isXAuthDomain(domain: string): boolean {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(domain);
}

/**
 * Derive session status for `caseId`: `connected` from the auth-cookie PRESENCE on the shared
 * partition (case-independent — one X login backs every campaign); `windowOpen` from whether
 * this specific case currently owns a live capture window. The cookie VALUE is read only for
 * the domain check and never returned. Port of the legacy `xSessionStatus` cookie check
 * (`ipc.ts:100-105`), extended with the per-case window flag.
 */
export async function getXStatus(caseId: string): Promise<XSessionStatus> {
  const id = ensureUuid(caseId, 'caseId');
  const ses = electronSession.fromPartition(X_LISTENING_PARTITION);
  const cookies = await ses.cookies.get({ name: 'auth_token' });
  const connected = cookies.some((c: { domain?: string }) => isXAuthDomain(c.domain ?? ''));
  const win = xWindows.get(id);
  const windowOpen = !!win && !win.isDestroyed();
  return { connected, windowOpen };
}

/**
 * The live capture window for `caseId`, if one is open and not yet destroyed — `undefined`
 * otherwise. Used by the Task 6 IPC layer (`ipc.ts`'s `captureTimeline` handler) to hand the
 * already-open, already-Tor-routed window to `capture.ts`'s `captureTimeline` without
 * re-deriving session state; it does NOT open a window itself — the caller must have already
 * gone through `connectXSession`.
 */
export function getXWindow(caseId: string): BrowserWindow | undefined {
  const id = ensureUuid(caseId, 'caseId');
  const win = xWindows.get(id);
  return win && !win.isDestroyed() ? win : undefined;
}

const X_PROFILE_USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Injectable seams for `navigateXToProfile` (testable without electron/network). */
export interface XNavigateDeps {
  /** Resolve the case's live capture window (defaults to `getXWindow`). */
  resolveWindow: (caseId: string) => BrowserWindow | undefined;
  loadUrl: (win: BrowserWindow, url: string) => Promise<void>;
  runScript: (win: BrowserWindow, js: string) => Promise<unknown>;
  delay: (ms: number) => Promise<void>;
  /** Max readiness probes before giving up (soft). */
  maxAttempts: number;
  /** Delay before each probe — also lets the SPA settle before the first one. */
  intervalMs: number;
}

function defaultNavigateDeps(): XNavigateDeps {
  return {
    resolveWindow: getXWindow,
    loadUrl: (win, url) => win.loadURL(url),
    runScript: (win, js) => win.webContents.executeJavaScript(js, true),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxAttempts: 24,
    intervalMs: 500,
  };
}

/**
 * One-click-capture support: navigate this case's capture window to a target profile timeline and
 * wait (bounded) for the X SPA to actually render posts, so the subsequent scrape doesn't hit an
 * empty pre-render page.
 *
 * The username is RE-VALIDATED here (defence-in-depth) BEFORE it is interpolated into the URL — the
 * capture window only ever loads `https://x.com/<validated-handle>` (no path/scheme injection), on
 * the same host-allowlisted partition every capture uses.
 *
 * Returns `{ blocked:true, reason }` on a decisive challenge / rate-limit / signed-out page (the
 * caller surfaces the reason and captures nothing); `{ ready:true }` once posts are visible; or
 * `{ ready:false, blocked:false }` on a render timeout — NOT fatal: the caller still runs the
 * capture, which then reports honestly (0 captured) instead of the old hard "not connected" error.
 * `classifyXPageState` keeps a still-loading (articles:0) profile page as signedIn, so the poll waits
 * through the render rather than mis-flagging it signed-out.
 *
 * `options.collectReplies` (audit HIGH #4): when the campaign's collect gate has REPLIES on, load the
 * `/with_replies` tab (`https://x.com/<handle>/with_replies`) — the route His `scrapeProfile` uses to
 * surface the target's own replies (main.cjs:1647-1648) — instead of the bare profile. The `handle` is
 * already validated (`^[A-Za-z0-9_]{1,15}$`) above and `/with_replies` is a fixed literal, so no path
 * or scheme injection is possible; the host stays x.com on the same allowlisted partition.
 */
export async function navigateXToProfile(
  caseId: string,
  username: string,
  overrides: Partial<XNavigateDeps> = {},
  options: { collectReplies?: boolean } = {},
): Promise<{ ready: boolean; blocked: boolean; reason?: string }> {
  const handle = String(username ?? '').replace(/^@+/, '').trim();
  if (!X_PROFILE_USERNAME_RE.test(handle)) {
    throw new Error(`"${username}" is not a valid X username (letters, digits, underscore; up to 15 characters).`);
  }
  const deps: XNavigateDeps = { ...defaultNavigateDeps(), ...overrides };
  const win = deps.resolveWindow(caseId);
  if (!win) throw new Error('No capture window is open for this campaign.');

  const route = options.collectReplies ? '/with_replies' : '';
  await deps.loadUrl(win, `https://x.com/${handle}${route}`);

  for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
    await deps.delay(deps.intervalMs);
    const probe = (await deps.runScript(win, X_PAGE_STATE_SCRIPT)) as Partial<XPageState>;
    const state = classifyXPageState({
      url: String(probe?.url ?? ''),
      text: String(probe?.text ?? ''),
      articles: Number(probe?.articles ?? 0),
    });
    if (state.blocked) return { ready: false, blocked: true, reason: state.reason };
    if (!state.signedIn) {
      return { ready: false, blocked: true, reason: state.reason ?? 'The saved X session is no longer signed in.' };
    }
    if (Number(probe?.articles ?? 0) > 0) return { ready: true, blocked: false };
  }
  return { ready: false, blocked: false };
}

/**
 * Close and forget the capture window for `caseId`, if one is open. This clears ONLY the
 * window/connection state for that case — it does NOT log the operator out of X (the auth
 * cookie lives on the shared partition and survives; a later `connectXSession` for any case
 * reuses it without a fresh login).
 */
export function clearXSession(caseId: string): { cleared: boolean } {
  const id = ensureUuid(caseId, 'caseId');
  const win = xWindows.get(id);
  xWindows.delete(id);
  if (win && !win.isDestroyed()) {
    win.close();
    return { cleared: true };
  }
  return { cleared: false };
}
