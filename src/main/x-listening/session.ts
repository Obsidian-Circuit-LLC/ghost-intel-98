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
 */
export async function connectXSession(caseId: string, clearnetEnabled: boolean): Promise<XConnectResult> {
  const id = ensureUuid(caseId, 'caseId');

  const existing = xWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
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
  win.show();
  win.focus();
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
