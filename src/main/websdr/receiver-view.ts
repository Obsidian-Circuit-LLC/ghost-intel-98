/**
 * WebSDR Viewer — hardened receiver-view manager (Phase 2, R2/R4/R8).
 *
 * Ports his `electron/main.ts` `WebContentsView` overlay pattern, HARDENED for Ghost Intel 98's
 * multi-window desktop and its egress/isolation invariants. The receiver page is a REMOTE,
 * interactive, UNTRUSTED site (a public WebSDR/KiwiSDR website) hosted in a dedicated
 * `persist:websdr` session — so containment is by ISOLATION, never by a CSP rewrite that would
 * break the site's own scripts/WebSocket (Global Constraint 2).
 *
 * This module is PURE over injected seams (no `electron`/`node` import) so the whole security
 * surface — egress toggle, permission hard-deny, window-open/nav guards, z-order/detach, status —
 * is unit-testable in node vitest with fakes. `receiver-ipc.ts` wires the production seams
 * (`WebContentsView` + `session.fromPartition('persist:websdr')` + the bg-Tor SOCKS endpoint +
 * `shell.openExternal` + P1's encrypt-at-rest egress store).
 *
 * Egress (Global Constraint 1): the receiver session is CLEARNET by DEFAULT — no proxy is ever set
 * for clearnet, so the module works out of the box. A per-session Tor toggle routes the session
 * through the app's background Tor SOCKS endpoint (`session.setProxy`) behind a one-time warning
 * that Tor may break live audio; the choice persists via P1's egress store. A Tor proxy is set even
 * before Tor finishes bootstrapping — a SOCKS connection to a not-yet-listening port fails CLOSED
 * (ERR_PROXY_CONNECTION_FAILED), never falling back to clearnet, so the toggle can never silently
 * deanonymize. Global app egress is untouched — only this one session is affected.
 */

import { normalizeWebSdrUrl } from '@shared/websdr/normalize-url';
import type { WebSdrEgressMode, WebSdrEgressState } from '@shared/websdr/types';
import { execControl, type WebSdrControlKind, type ControlResult } from './control';

// ---- injectable electron-shaped seams ----------------------------------
// Minimal structural shapes of exactly the Electron surface this manager drives. Kept structural
// (not `import type` from electron) so a test can inject a fake with zero electron runtime.

export interface ReceiverBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A cancellable navigation event (the `will-navigate`/`will-redirect` signature). */
export interface NavEventLike {
  preventDefault(): void;
}

export interface ReceiverWebContentsLike {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void;
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (e: NavEventLike, url: string) => void,
  ): void;
  loadURL(url: string): Promise<unknown>;
  setAudioMuted(muted: boolean): void;
  /** Run a script in the receiver page (his `execControl` injection channel). Phase 3 uses this
   *  ONLY for the confined freq/mode/volume control script (Global Constraint 5). */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  /** His `getMediaSourceId(forWebContents)` — the capture handshake the renderer's MediaRecorder
   *  uses to record THIS receiver view (Phase 3, R7). */
  getMediaSourceId(forWebContents: unknown): string;
  /** Re-navigate the CURRENT page. Used only by the unsized-navigation heal (see `navigatedUnsized`). */
  reload(): void;
  close(): void;
}

export interface ReceiverViewLike {
  webContents: ReceiverWebContentsLike;
  setBounds(bounds: ReceiverBounds): void;
  setVisible(visible: boolean): void;
}

/** The subset of `Electron.Session` the manager drives on the `persist:websdr` partition. */
export interface ReceiverSessionLike {
  setProxy(config: { proxyRules?: string; proxyBypassRules?: string; mode?: string }): Promise<void>;
  setPermissionRequestHandler(
    handler:
      | ((wc: unknown, permission: string, callback: (granted: boolean) => void) => void)
      | null,
  ): void;
  setPermissionCheckHandler(handler: (() => boolean) | null): void;
  /** `Session.fetch` — routes over THIS session's proxy config, so a status check automatically
   *  follows the active egress path (clearnet or Tor) with no extra plumbing. */
  fetch(input: string, init?: { method?: string }): Promise<{ ok: boolean; status: number }>;
}

/** The app's single desktop `BrowserWindow`'s content view host (the overlay parent). */
export interface WindowContentViewLike {
  addChildView(view: ReceiverViewLike): void;
  removeChildView(view: ReceiverViewLike): void;
}

export interface ReceiverViewDeps {
  /** The app's main desktop window, or null if it is gone. */
  getWindow(): { contentView: WindowContentViewLike } | null;
  /** The dedicated `persist:websdr` session. */
  getSession(): ReceiverSessionLike;
  /** Build a fresh hardened `WebContentsView` on the `persist:websdr` partition. */
  createView(): ReceiverViewLike;
  /** The bg-Tor SOCKS endpoint `host:port`, or null when no Tor instance exists in this build.
   *  Returns the endpoint even before Tor finishes bootstrapping (fail-closed, see file header). */
  torSocks(): string | null;
  /** Read the persisted egress choice (P1 encrypt-at-rest store). */
  readEgress(): Promise<WebSdrEgressState>;
  /** Persist the egress choice (P1 encrypt-at-rest store). */
  writeEgress(mode: WebSdrEgressMode): Promise<WebSdrEgressState>;
  /** Open a URL in the system browser (already `normalizeUrl`-validated by the manager). */
  openExternal(url: string): void;
  /** v3.72.1 field diagnostic (optional): a one-line append sink for the overlay show/bounds/load
   *  lifecycle, so a blank receiver view is diagnosable from a log the user can send. Production wires
   *  it to a plaintext file under the module data dir; tests leave it undefined (no-op). Never carries
   *  a secret — only visibility, integer bounds, and load outcomes. */
  diag?(line: string): void;
}

// ---- status result (his `receiver:status` shape) -----------------------

export interface ReceiverStatus {
  online: boolean;
  status?: number;
  error?: string;
}

export interface EgressApplyResult {
  mode: WebSdrEgressMode;
  /** True the FIRST time Tor is enabled in this process — the renderer shows the one-time
   *  "Tor may break live audio" warning. */
  showWarning: boolean;
}

export interface ReceiverViewManager {
  /** Load a receiver URL into the overlay (his `receiver:load`). Rejects a non-http(s) URL at the
   *  trust boundary BEFORE a view is ever created. Applies the persisted egress before the first
   *  navigation so the very first request already follows the chosen path. */
  load(rawUrl: unknown): Promise<void>;
  /** Destroy the overlay (his `receiver:hide`): detach + close the webContents + drop state. */
  hide(): void;
  /** Z-order reconcile (his `receiver:visible`+`receiver:bounds`, fused for the multi-window
   *  desktop): the renderer reports whether the SDR module window is focused+visible+uncovered and
   *  the overlay bounds; main shows+positions or hides the native overlay to match, so a stray
   *  overlay never floats over another GI98 window. */
  present(input: { visible: boolean; bounds?: ReceiverBounds; diag?: string }): void;
  /** Detach the overlay while a GI98 modal/dialog is open, and restore it WITHOUT reloading when
   *  the modal closes (his v0.1.6 fix). */
  setModal(open: boolean): void;
  /** Online/offline check over the ACTIVE egress path (his `receiver:status`), URL-validated. */
  status(rawUrl: unknown): Promise<ReceiverStatus>;
  /** Mute/unmute the receiver audio (his `receiver:mute` → `setAudioMuted`). */
  setMuted(muted: boolean): void;
  /** Tune the receiver (his `receiver:tune`): inject the frequency control script ONLY into the
   *  receiver view. Returns his {ok,message} result; a no-view state reports "No receiver is
   *  loaded." rather than injecting anywhere. */
  tune(frequencyHz: number): Promise<ControlResult>;
  /** Set the demod mode (his `receiver:mode`) via the confined control injection. */
  setMode(mode: string): Promise<ControlResult>;
  /** Set the receiver volume 0..1 (his `receiver:volume`) via the confined control injection. */
  setVolume(volume: number): Promise<ControlResult>;
  /** His `receiver:capture-source`: return the receiver view's media source id for `forWebContents`
   *  (the requesting renderer). Throws his "Load a receiver before recording." when no view is
   *  loaded — nothing to capture. */
  captureSourceId(forWebContents: unknown): string;
  /** Open a receiver URL in the system browser (his `external:open`), URL-validated. */
  externalOpen(rawUrl: unknown): void;
  /** Apply + persist the egress toggle: set/clear the session proxy and return the live path plus
   *  the one-time-warning flag. */
  applyEgress(mode: unknown): Promise<EgressApplyResult>;
  /** The live egress path (for the always-visible CLEARNET/TOR marker). */
  currentEgress(): WebSdrEgressMode;
}

// ---- helpers -----------------------------------------------------------

function coerceEgressMode(v: unknown): WebSdrEgressMode {
  return v === 'tor' ? 'tor' : 'clearnet';
}

/** Sanitize a renderer-reported bounds rectangle (his `receiver:bounds` rounding): integer coords,
 *  a strictly positive size, and finite numbers only. */
function sanitizeBounds(b: ReceiverBounds | undefined): ReceiverBounds | undefined {
  if (!b) return undefined;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    x: Math.round(n(b.x)),
    y: Math.round(n(b.y)),
    width: Math.max(1, Math.round(n(b.width))),
    height: Math.max(1, Math.round(n(b.height))),
  };
}

/** Where a hidden overlay is parked — far outside any real display, never a 0x0 at the origin. */
const OFFSCREEN_BOUNDS: ReceiverBounds = { x: -20000, y: -20000, width: 1, height: 1 };

/** A rectangle big enough for a receiver page to lay out into. `sanitizeBounds` floors width/height
 *  at 1, so "1×1" is the shape a zero-size host report takes — treat it as unsized, not as real. */
function isRealBounds(b: ReceiverBounds | undefined): boolean {
  return !!b && b.width >= 2 && b.height >= 2;
}

// ---- factory -----------------------------------------------------------

export function makeReceiverViewManager(deps: ReceiverViewDeps): ReceiverViewManager {
  let view: ReceiverViewLike | null = null;
  let attached = false;
  let desiredVisible = false;
  let modalOpen = false;
  let bounds: ReceiverBounds | undefined;
  /** True when the CURRENT page was navigated while the overlay had no real on-screen size. A
   *  WebSDR page lays its waterfall/stream canvas out at load time: loaded into a 0×0 (or not-yet-
   *  positioned) view, the audio still plays but the visual never starts, and only a reload heals
   *  it — the "hit refresh and suddenly the display is there" field report. Cleared by the one-shot
   *  reload the next time the overlay is actually shown at a real size. */
  let navigatedUnsized = false;
  let egressMode: WebSdrEgressMode = 'clearnet';
  let sessionLockedDown = false;
  let torWarned = false;

  /** Hard-deny EVERY permission on the receiver session — a WebSDR website needs none of
   *  camera/mic/geolocation/notifications/USB/serial/MIDI/clipboard/etc., and deny-by-default is
   *  the only safe posture for a remote page we do not control. Idempotent. */
  function lockDownSession(): void {
    if (sessionLockedDown) return;
    const ses = deps.getSession();
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    sessionLockedDown = true;
  }

  /** Install the window-open + navigation guards on a freshly created receiver webContents. */
  function installGuards(wc: ReceiverWebContentsLike): void {
    // A remote page may not spawn a new window/tab. It may only hand a URL to the system browser,
    // and ONLY after it passes normalizeUrl (http/https). A javascript:/file:/data: URL is
    // rejected here and never reaches shell.openExternal.
    wc.setWindowOpenHandler(({ url }) => {
      try {
        deps.openExternal(normalizeWebSdrUrl(url));
      } catch {
        // Non-http(s) or unparseable: refuse silently. The window is denied regardless.
      }
      return { action: 'deny' };
    });
    // Refuse any in-place navigation to a non-http(s) scheme. Applied to BOTH will-navigate and
    // will-redirect: a server 3xx / meta-refresh surfaces as will-redirect, not will-navigate, so
    // guarding only the former leaves a hole. We do NOT host-allowlist — a WebSDR site is meant to
    // be browsed — but a scheme-jump to file:/javascript: is always blocked.
    const guard = (e: NavEventLike, navUrl: string): void => {
      try {
        const u = new URL(navUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') e.preventDefault();
      } catch {
        e.preventDefault();
      }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
  }

  /** Set or clear the receiver-session proxy for `mode`. Clearnet uses `{mode:'direct'}` to CLEAR a
   *  previously-set Tor proxy; the DEFAULT clearnet path (nothing ever toggled) never calls this,
   *  so a fresh module has no proxy at all. Tor requires a SOCKS endpoint or throws. */
  async function applyProxy(mode: WebSdrEgressMode): Promise<void> {
    const ses = deps.getSession();
    if (mode === 'tor') {
      const socks = deps.torSocks();
      if (!socks) {
        throw new Error('Tor is not available — stay on clearnet for this receiver.');
      }
      // Empty bypass = everything through Tor (mirrors the capture-window Tor-over-SOCKS posture).
      await ses.setProxy({ proxyRules: `socks5://${socks}`, proxyBypassRules: '' });
    } else {
      await ses.setProxy({ mode: 'direct' });
    }
  }

  /** Create the overlay view on first use: lock the session down, build the hardened view, install
   *  its guards, and apply the PERSISTED egress before any navigation. Clearnet-persisted → no
   *  proxy call at all. Tor-persisted → apply the Tor proxy (best-effort: a degenerate no-Tor
   *  build heals to clearnet rather than failing the load). */
  async function ensureView(): Promise<ReceiverViewLike> {
    lockDownSession();
    if (!view) {
      view = deps.createView();
      installGuards(view.webContents);
      attached = false;
      const st = await deps.readEgress();
      if (st.mode === 'tor') {
        try {
          await applyProxy('tor');
          egressMode = 'tor';
        } catch {
          egressMode = 'clearnet';
        }
      } else {
        egressMode = 'clearnet';
      }
    }
    return view;
  }

  /** Drive the seam to match desired state: the overlay is shown+positioned ONLY when the renderer
   *  wants it visible AND no modal is open; otherwise it is hidden AND detached from the content
   *  view so it can never paint over another GI98 window. Detach preserves the webContents, so a
   *  later re-show restores the loaded page without reloading. Idempotent. */
  function reconcile(): void {
    if (!view) return;
    const win = deps.getWindow();
    if (!win) return;
    const show = desiredVisible && !modalOpen;
    const b = bounds;
    deps.diag?.(
      `reconcile show=${show} desiredVisible=${desiredVisible} modalOpen=${modalOpen} attached=${attached} ` +
      `bounds=${b ? `${b.x},${b.y} ${b.width}x${b.height}` : 'none'}`,
    );
    if (show) {
      if (!attached) {
        win.contentView.addChildView(view);
        attached = true;
      }
      if (bounds) view.setBounds(bounds);
      view.setVisible(true);
      // One-shot heal: the page was navigated before the overlay had a real size, so its waterfall
      // never started. Now that it is genuinely on screen, re-navigate once (idempotent — the flag
      // clears first, so a later reposition never reloads again).
      if (navigatedUnsized && isRealBounds(bounds)) {
        navigatedUnsized = false;
        deps.diag?.('heal reload (page had been navigated with no real bounds)');
        view.webContents.reload();
      }
    } else {
      // Park OFF-SCREEN before hiding. A WebContentsView is composited by the OS above all DOM, so a
      // visibility flag alone left the receiver painting over the DESKTOP for seconds after the
      // window was minimised (field video, v3.72.3) — a stray native view outliving its window is a
      // release blocker (constraint 9). Moving it out of the viewport first means there is no
      // on-screen rectangle for a stale frame to occupy, whatever the compositor does next.
      view.setBounds(OFFSCREEN_BOUNDS);
      view.setVisible(false);
      if (attached) {
        win.contentView.removeChildView(view);
        attached = false;
      }
    }
  }

  /** Inject the confined control script for `kind`/`value` into the CURRENT receiver view only.
   *  With no view loaded, `execControl(null, …)` reports "No receiver is loaded." — the injection
   *  never runs against anything but the `persist:websdr` overlay (Global Constraint 5). */
  function runControl(kind: WebSdrControlKind, value: string | number): Promise<ControlResult> {
    return execControl(view ? view.webContents : null, kind, value);
  }

  return {
    async load(rawUrl) {
      // Validate BEFORE creating a view — a bad URL rejects with no side effect.
      const url = normalizeWebSdrUrl(rawUrl);
      const v = await ensureView();
      desiredVisible = true;
      reconcile();
      deps.diag?.(`load ${url}`);
      // Did this navigation happen into a view that is actually on screen at a real size? If not,
      // the page laid out at 0×0 and needs the one-shot heal above once it is.
      navigatedUnsized = !(isRealBounds(bounds) && desiredVisible && !modalOpen);
      try {
        await v.webContents.loadURL(url);
        deps.diag?.(`load ok ${url} sized=${!navigatedUnsized}`);
      } catch (e) {
        deps.diag?.(`load FAILED ${url} :: ${(e as Error)?.message ?? e}`);
        throw e;
      }
    },

    hide() {
      if (!view) return;
      const win = deps.getWindow();
      if (attached && win) win.contentView.removeChildView(view);
      view.webContents.close();
      view = null;
      attached = false;
      desiredVisible = false;
    },

    present(input) {
      desiredVisible = input.visible === true;
      const clean = sanitizeBounds(input.bounds);
      if (clean) bounds = clean;
      deps.diag?.(
        `present recv visible=${input.visible === true} ` +
        `bounds=${clean ? `${clean.x},${clean.y} ${clean.width}x${clean.height}` : 'none'} ` +
        `why=${input.diag ?? '-'}`,
      );
      reconcile();
    },

    setModal(open) {
      modalOpen = open === true;
      reconcile();
    },

    async status(rawUrl) {
      let url: string;
      try {
        url = normalizeWebSdrUrl(rawUrl);
      } catch (e) {
        return { online: false, error: (e as Error)?.message || 'Invalid receiver URL.' };
      }
      try {
        const res = await deps.getSession().fetch(url, { method: 'GET' });
        return { online: res.ok, status: res.status };
      } catch (e) {
        return { online: false, error: (e as Error)?.message || 'Connection failed.' };
      }
    },

    setMuted(muted) {
      if (view) view.webContents.setAudioMuted(muted === true);
    },

    tune(frequencyHz) {
      return runControl('frequency', frequencyHz);
    },

    setMode(mode) {
      return runControl('mode', mode);
    },

    setVolume(volume) {
      return runControl('volume', volume);
    },

    captureSourceId(forWebContents) {
      // His guard: a recording needs a loaded receiver to capture. No view → refuse (nothing to
      // record) rather than returning a dangling source id.
      if (!view) throw new Error('Load a receiver before recording.');
      return view.webContents.getMediaSourceId(forWebContents);
    },

    externalOpen(rawUrl) {
      // Throws on a non-http(s) URL — the caller surfaces the rejection; nothing is opened.
      deps.openExternal(normalizeWebSdrUrl(rawUrl));
    },

    async applyEgress(mode) {
      const next = coerceEgressMode(mode);
      // applyProxy may throw (Tor requested but unavailable) — do NOT persist or flip the marker in
      // that case; the session stays on its current path.
      await applyProxy(next);
      egressMode = next;
      await deps.writeEgress(next);
      let showWarning = false;
      if (next === 'tor' && !torWarned) {
        showWarning = true;
        torWarned = true;
      }
      return { mode: next, showWarning };
    },

    currentEgress() {
      return egressMode;
    },
  };
}
