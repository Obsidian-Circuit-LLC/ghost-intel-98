/**
 * Ghost Social Media Manager (hardened GI98 port) — per-account view manager + THE OVERLAY
 * LIFECYCLE (Phase 2, G2/G3/G8, constraints 4/5/6/9).
 *
 * Ports his `electron/main.ts` per-account `WebContentsView` embedding (his `browserViews` map,
 * `browser:openAccount`/`showComposeGrid`/`nav`/`resize`/`deleteAccountData`), HARDENED for Ghost
 * Intel 98's multi-window win98 desktop and its egress/isolation invariants. His model composited a
 * SINGLE native view above the DOM; this module hosts MANY at once (the embedded browser + every
 * Compose-Live-Account-Wall card), so the SDR port's overlay-lifecycle lesson applies MULTIPLIED:
 * a view is visible ONLY while the module reports its window active + non-modal AND that view has
 * on-screen bounds; a blur/minimize/modal hides + DETACHES every view; module unmount TEARS DOWN
 * (closes) every webContents. A stray native view floating over the desktop or another GI98 window
 * is a release blocker (constraint 9).
 *
 * This module is PURE over injected seams (no `electron`/`node` import) so the whole security
 * surface — the per-partition egress toggle, the window-open/navigation guards, the host-anchored
 * favicon fetch, the scheme-guarded external open, and the z-order/detach governor — is unit-
 * testable in node vitest with fakes. `view-ipc.ts` wires the production seams (`WebContentsView` +
 * `session.fromPartition(persist:ghost-…)` + the bg-Tor SOCKS endpoint + `shell.openExternal` +
 * an SSRF-guarded favicon fetch).
 *
 * Egress (G8): each account's `persist:` session is CLEARNET by DEFAULT — no proxy is EVER set for
 * clearnet, so logged-in posting works out of the box (Tor trips platform checkpoints). A per-
 * account Tor toggle routes ONLY that partition's session through the bg-Tor SOCKS endpoint behind
 * a one-time warning; a Tor proxy set before Tor finishes bootstrapping fails CLOSED (a SOCKS
 * connect to a not-yet-listening port errors rather than falling back to clearnet), so the toggle
 * can never silently deanonymize. One account's egress never affects another's partition.
 *
 * NOTE on permissions: unlike the WebSDR overlay (which hard-denies every permission because a
 * WebSDR page needs none), these views host the user's OWN authenticated social accounts, whose
 * login/feature flows may legitimately need default permission handling. The spec's Phase-2
 * hardening is scoped to window-open/navigation/favicon/openExternal (not a permission lockdown),
 * so this manager does not impose a deny-all handler that would break authenticated social use.
 */

import type { AccountLike, BrowserCacheMode, PlatformKey } from '@shared/ghost-social/types';
import { accountPartition } from '@shared/ghost-social/types';
import { hostOfUrl, normalizeSocialUrl, sameSite } from '@shared/ghost-social/url';

// ---- injectable electron-shaped seams ----------------------------------
// Minimal structural shapes of exactly the Electron surface this manager drives — kept structural
// (not `import type` from electron) so a test injects a fake with zero electron runtime.

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A cancellable navigation event (the `will-navigate`/`will-redirect` signature). */
export interface NavEventLike {
  preventDefault(): void;
}

export interface GsmWebContentsLike {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void;
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (e: NavEventLike, url: string) => void,
  ): void;
  loadURL(url: string): Promise<unknown>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  isDestroyed(): boolean;
  close(): void;
}

export interface GsmViewLike {
  webContents: GsmWebContentsLike;
  setBounds(bounds: ViewBounds): void;
  setVisible(visible: boolean): void;
}

/** The subset of `Electron.Session` the manager drives on ONE account partition. */
export interface GsmSessionLike {
  setProxy(config: { proxyRules?: string; proxyBypassRules?: string; mode?: string }): Promise<void>;
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
  flushStorageData?(): Promise<void>;
}

/** The app's single desktop `BrowserWindow`'s content view host (the overlay parent). */
export interface WindowContentViewLike {
  addChildView(view: GsmViewLike): void;
  removeChildView(view: GsmViewLike): void;
}

export interface ViewManagerDeps {
  /** The app's main desktop window, or null if it is gone (the overlay parent). */
  getWindow(): { contentView: WindowContentViewLike } | null;
  /** The session for a `persist:ghost-…` partition (proxy + storage wiping live here). */
  getSession(partition: string): GsmSessionLike;
  /** Build a fresh hardened `WebContentsView` on the given account partition. */
  createView(partition: string): GsmViewLike;
  /** The bg-Tor SOCKS endpoint `host:port`, or null when no Tor instance exists in this build.
   *  Returned even before Tor bootstraps (fail-closed — see file header). */
  torSocks(): string | null;
  /** Open a URL in the system browser (already `normalizeSocialUrl`-validated by the manager). */
  openExternal(url: string): void;
  /** SSRF-guarded fetch of a host-anchored `…/favicon.ico`, returning a cached `file://` path or
   *  null. The manager decides WHICH url (only a registered account host's own /favicon.ico) — the
   *  seam only performs the guarded fetch + cache. */
  faviconFetch(iconUrl: string): Promise<string | null>;
}

/** The per-account minimum the manager needs to open a view + apply egress. */
export interface ViewAccount {
  id: string;
  url: string;
  platform?: PlatformKey;
  name?: string;
  /** G8: `true` routes this account's partition over Tor from first navigation. Absent/false =
   *  clearnet (the default). */
  torEnabled?: boolean;
}

export type EgressMode = 'clearnet' | 'tor';

export interface EgressApplyResult {
  mode: EgressMode;
  /** True the FIRST time Tor is enabled anywhere in this process — the renderer shows the one-time
   *  "Tor will likely break your logged-in session" warning. */
  showWarning: boolean;
}

export interface CacheStatus {
  mode: BrowserCacheMode;
  activeKey: string | null;
  cachedKeys: string[];
  visibleKeys: string[];
}

export interface GhostSocialViewManager {
  /** Open/cache an account's embedded view (his `browser:openAccount`) and make it the single
   *  ACTIVE view at `bounds`; all OTHER views hide. Applies the account's persisted egress before
   *  the first navigation. */
  openAccount(campaignId: string, account: ViewAccount, bounds?: ViewBounds): Promise<boolean>;
  /** MANUAL PREPARE support (Finding 2/6): open-or-reuse the account's TRACKED embedded view and
   *  return its `webContents` so a manual prepare fills the SAME lifecycle-managed view instead of
   *  an untracked top-level window. The view is registered in the cache, so `closeAll()`/teardown/
   *  lock tears it down; it never outlives the module. Returns null if the app window is gone. */
  openForPrepare(campaignId: string, account: ViewAccount): Promise<GsmWebContentsLike | null>;
  /** Show a grid of live per-account views (his `browser:showComposeGrid` — the Compose Live
   *  Account Wall), each at its own card bounds; all others hide. No single active view. */
  showGrid(
    campaignId: string,
    items: Array<{ account: ViewAccount; bounds: ViewBounds }>,
  ): Promise<boolean>;
  /** Hide + detach ALL cached views (kept in cache); his `browser:hide`. */
  hideAll(): void;
  /** Close one account's view (his `browser:close`). */
  closeAccount(campaignId: string, accountId: string): void;
  /** Close + tear down EVERY view (his `browser:closeAll` + module-unmount teardown). */
  closeAll(): void;
  /** Reload one cached account's view (his `browser:refreshAccount`). */
  refresh(campaignId: string, accountId: string): boolean;
  /** back/forward/reload/home on the ACTIVE embedded view (his `browser:nav`). */
  nav(action: 'back' | 'forward' | 'reload' | 'home'): Promise<boolean>;
  /** Update the ACTIVE embedded view's bounds (his `browser:resize`). */
  resize(bounds: ViewBounds): void;
  /** Set the LRU cache mode (his `browser:setCacheMode`). */
  setCacheMode(mode: BrowserCacheMode): void;
  /** Delete one account's session storage + cache and close its view (his
   *  `browser:deleteAccountData`). */
  deleteAccountData(campaignId: string, accountId: string): Promise<boolean>;
  /** Governor: the module reports whether ITS window is focused + non-minimized. Inactive hides +
   *  detaches ALL views (constraint 9). */
  setWindowActive(active: boolean): void;
  /** Governor: a GI98 modal is open — detach ALL views; restore (no reload) when it closes. */
  setModal(open: boolean): void;
  /** G8 per-account egress: set/clear that partition's proxy + the one-time-warning flag. */
  applyEgress(campaignId: string, accountId: string, torEnabled: boolean): Promise<EgressApplyResult>;
  /** The live egress path for one account (for the per-view CLEARNET/TOR marker). */
  currentEgress(campaignId: string, accountId: string): EgressMode;
  /** Seed the set of known account hosts so the host-anchored favicon fetch can accept them. */
  registerAccountHosts(urls: string[]): void;
  /** Host-anchored favicon fetch (hardening #3): only a REGISTERED account host's own
   *  `/favicon.ico`; a foreign or non-http(s) host returns null WITHOUT fetching. */
  fetchFavicon(rawUrl: unknown): Promise<string | null>;
  /** Scheme-guarded external open (hardening #4): throws on a non-http(s) URL. */
  externalOpen(rawUrl: unknown): void;
  /** Debug/inspection snapshot of the view cache (his `browser:cacheStatus`). */
  cacheStatus(): CacheStatus;
}

// ---- helpers -----------------------------------------------------------

function browserKey(campaignId: string, accountId: string): string {
  return `${campaignId}::${accountId}`;
}

/** Sanitize a renderer-reported bounds rectangle (his rounding): integer coords, a strictly
 *  positive size, finite numbers only. */
function sanitizeBounds(b: ViewBounds | undefined): ViewBounds | undefined {
  if (!b) return undefined;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    x: Math.round(n(b.x)),
    y: Math.round(n(b.y)),
    width: Math.max(1, Math.round(n(b.width))),
    height: Math.max(1, Math.round(n(b.height))),
  };
}

function cacheLimit(mode: BrowserCacheMode): number {
  return mode === 'all' ? Number.POSITIVE_INFINITY : mode === 'recent3' ? 3 : 1;
}

// ---- factory -----------------------------------------------------------

interface CachedView {
  key: string;
  campaignId: string;
  accountId: string;
  partition: string;
  home: string;
  host: string | null;
  view: GsmViewLike;
  lastUsed: number;
  desiredVisible: boolean;
  bounds?: ViewBounds;
  attached: boolean;
  egress: EgressMode;
}

export function makeGhostSocialViewManager(deps: ViewManagerDeps): GhostSocialViewManager {
  const views = new Map<string, CachedView>();
  const knownHosts = new Set<string>();
  let activeKey: string | null = null;
  let windowActive = false;
  let modalOpen = false;
  let cacheMode: BrowserCacheMode = 'recent3';
  let torWarned = false;

  // ── overlay governor ──────────────────────────────────────────────────────

  /** Drive one view's native seam to match desired state: shown+positioned ONLY when the module
   *  window is active, no modal is open, the view WANTS to be visible, and it has on-screen bounds;
   *  otherwise hidden AND detached from the content view so it can never paint over another GI98
   *  window. Detach preserves the webContents, so a later re-show restores the page without a
   *  reload. Idempotent. */
  function reconcile(cv: CachedView): void {
    const win = deps.getWindow();
    if (!win) return;
    const show = windowActive && !modalOpen && cv.desiredVisible && !!cv.bounds;
    if (show) {
      if (!cv.attached) {
        win.contentView.addChildView(cv.view);
        cv.attached = true;
      }
      if (cv.bounds) cv.view.setBounds(cv.bounds);
      cv.view.setVisible(true);
    } else {
      cv.view.setVisible(false);
      if (cv.attached) {
        win.contentView.removeChildView(cv.view);
        cv.attached = false;
      }
    }
  }

  function reconcileAll(): void {
    for (const cv of views.values()) reconcile(cv);
  }

  /** Mark every view as not-wanting-visible (their governor state), then reconcile so all hide +
   *  detach. Used by his `browser:hide` and before an openAccount/showGrid re-selects. */
  function markAllHidden(): void {
    for (const cv of views.values()) cv.desiredVisible = false;
    activeKey = null;
    reconcileAll();
  }

  // ── isolation guards on a freshly created view ────────────────────────────

  /** Install the window-open + navigation guards (constraint 5). His `setWindowOpenHandler` did
   *  `loadURL(anyPopupUrl)` on the authenticated view — a remote page could drive it anywhere.
   *  Here: NEW WINDOWS ARE ALWAYS DENIED; a same-site popup navigates the view in place (his
   *  intent — popups drive the account view); an off-site http(s) popup is handed to the SYSTEM
   *  browser instead; a non-http(s) popup is dropped entirely. */
  function installGuards(cv: CachedView): void {
    const wc = cv.view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const normalized = normalizeSocialUrl(url); // throws on non-http(s)
        const host = hostOfUrl(normalized);
        if (host && cv.host && sameSite(host, cv.host)) {
          // Same registrable domain as the account → navigate in place (never a new window).
          void wc.loadURL(normalized);
        } else {
          // Off-site (or unknown current host) → system browser, never into the authed view.
          deps.openExternal(normalized);
        }
      } catch {
        // Non-http(s) or unparseable: refuse silently. The window is denied regardless.
      }
      return { action: 'deny' };
    });
    // Refuse any in-place navigation to a non-http(s) scheme. Applied to BOTH will-navigate and
    // will-redirect (a server 3xx / meta-refresh surfaces as will-redirect). We do NOT host-
    // allowlist — the user browses their own authenticated account — but a scheme-jump to
    // file:/javascript:/data: is always blocked.
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

  // ── per-account egress ────────────────────────────────────────────────────

  /** Set or clear the proxy for ONE account partition. Clearnet uses `{mode:'direct'}` to CLEAR a
   *  previously-set Tor proxy; the DEFAULT clearnet path (never toggled) never calls this, so a
   *  fresh account has no proxy at all. Tor requires a SOCKS endpoint or throws. */
  async function applyProxy(partition: string, mode: EgressMode): Promise<void> {
    const ses = deps.getSession(partition);
    if (mode === 'tor') {
      const socks = deps.torSocks();
      if (!socks) {
        throw new Error('Tor is not available — stay on clearnet for this account.');
      }
      await ses.setProxy({ proxyRules: `socks5://${socks}`, proxyBypassRules: '' });
    } else {
      await ses.setProxy({ mode: 'direct' });
    }
  }

  // ── view lifecycle ────────────────────────────────────────────────────────

  function registerHost(url: string): void {
    const host = hostOfUrl(url);
    if (host) knownHosts.add(host);
  }

  /** Create-or-fetch a cached view for an account. On CREATE: register the account host, build the
   *  hardened view, install its guards, apply the account's persisted egress BEFORE any
   *  navigation, and navigate to its home. On REUSE: refresh home/lastUsed. */
  async function ensureView(campaignId: string, account: ViewAccount): Promise<CachedView> {
    const key = browserKey(campaignId, account.id);
    // Scheme-guard the account URL at the trust boundary (hardening #5). The renderer is hostile;
    // `account.url` arrives from IPC as any non-empty string. Every OTHER URL path in this file
    // (popups, will-navigate/will-redirect, favicon, openExternal) is normalizeSocialUrl-guarded,
    // but the top-level programmatic `loadURL(account.url)` — and `nav('home')` off `cv.home` —
    // bypass the nav listeners entirely, so a `file:`/`chrome:`/`javascript:` account URL would
    // otherwise drive the authenticated partition to an arbitrary non-http(s) scheme. normalize
    // THROWS on a non-http(s) or unparseable URL, rejecting the open before any view is created.
    const home = normalizeSocialUrl(account.url);
    let cv = views.get(key);
    if (cv && !cv.view.webContents.isDestroyed()) {
      cv.home = home;
      cv.lastUsed = Date.now();
      return cv;
    }
    const partition = accountPartition(campaignId, account.id);
    registerHost(home);
    const view = deps.createView(partition);
    cv = {
      key,
      campaignId,
      accountId: account.id,
      partition,
      home,
      host: hostOfUrl(home),
      view,
      lastUsed: Date.now(),
      desiredVisible: false,
      bounds: undefined,
      attached: false,
      egress: 'clearnet',
    };
    views.set(key, cv);
    installGuards(cv);
    // Apply the account's persisted egress BEFORE the first navigation so the very first request
    // already follows the chosen path. G8 fail-CLOSED: an account the user EXPLICITLY marked Tor
    // must NEVER heal to clearnet. applyProxy throws only when no Tor instance exists in this build
    // (torSocks()===null); the everyday pre-bootstrap case sets a real SOCKS proxy that fails closed
    // at connect time and does not throw here. On the no-Tor throw, tear the freshly-created view
    // down and propagate — matching applyEgress()'s refuse-don't-downgrade posture — so the
    // authenticated session is never navigated over clearnet (a retry rebuilds cleanly).
    if (account.torEnabled === true) {
      try {
        await applyProxy(partition, 'tor');
      } catch (err) {
        destroyView(key);
        throw err;
      }
      cv.egress = 'tor';
      if (!torWarned) torWarned = true;
    }
    await cv.view.webContents.loadURL(home);
    return cv;
  }

  /** Destroy one cached view: detach from the content view + close its webContents + drop it. */
  function destroyView(key: string): void {
    const cv = views.get(key);
    if (!cv) return;
    const win = deps.getWindow();
    if (cv.attached && win) {
      try {
        win.contentView.removeChildView(cv.view);
      } catch {
        /* window already gone */
      }
    }
    if (!cv.view.webContents.isDestroyed()) cv.view.webContents.close();
    views.delete(key);
    if (activeKey === key) activeKey = null;
  }

  /** Evict least-recently-used cached views beyond the cache limit, skipping the active + any
   *  currently-visible view (his `enforceBrowserCache`). */
  function enforceCache(): void {
    const limit = cacheLimit(cacheMode);
    if (views.size <= limit) return;
    const candidates = [...views.values()]
      .filter((cv) => cv.key !== activeKey && !cv.desiredVisible)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (views.size > limit && candidates.length) {
      destroyView(candidates.shift()!.key);
    }
  }

  return {
    async openAccount(campaignId, account, bounds) {
      markAllHidden();
      const cv = await ensureView(campaignId, account);
      cv.bounds = sanitizeBounds(bounds) ?? cv.bounds;
      cv.desiredVisible = true;
      cv.lastUsed = Date.now();
      activeKey = cv.key;
      reconcile(cv);
      enforceCache();
      return true;
    },

    async openForPrepare(campaignId, account) {
      // Ensure a TRACKED cached view exists for this account (create-through-the-manager if absent,
      // reuse if the grid/browser already opened it) and return its webContents. We do NOT change
      // visibility/active selection here — the overlay governor (window active + grid/browser
      // desiredVisible) owns that; a manual prepare only needs to fill the composer in the tracked
      // webContents. Because the view lives in `views`, closeAll()/teardown/lock destroys it.
      const cv = await ensureView(campaignId, account);
      cv.lastUsed = Date.now();
      return cv.view.webContents;
    },

    async showGrid(campaignId, items) {
      markAllHidden();
      activeKey = null;
      for (const item of items) {
        const cv = await ensureView(campaignId, item.account);
        cv.bounds = sanitizeBounds(item.bounds) ?? cv.bounds;
        cv.desiredVisible = true;
        cv.lastUsed = Date.now();
        reconcile(cv);
      }
      enforceCache();
      return true;
    },

    hideAll() {
      markAllHidden();
      enforceCache();
    },

    closeAccount(campaignId, accountId) {
      destroyView(browserKey(campaignId, accountId));
    },

    closeAll() {
      for (const key of [...views.keys()]) destroyView(key);
      activeKey = null;
    },

    refresh(campaignId, accountId) {
      const cv = views.get(browserKey(campaignId, accountId));
      if (!cv || cv.view.webContents.isDestroyed()) return false;
      cv.view.webContents.reload();
      cv.lastUsed = Date.now();
      return true;
    },

    async nav(action) {
      if (!activeKey) return false;
      const cv = views.get(activeKey);
      if (!cv || cv.view.webContents.isDestroyed()) return false;
      const wc = cv.view.webContents;
      if (action === 'back' && wc.canGoBack()) wc.goBack();
      else if (action === 'forward' && wc.canGoForward()) wc.goForward();
      else if (action === 'reload') wc.reload();
      else if (action === 'home') await wc.loadURL(cv.home);
      cv.lastUsed = Date.now();
      return true;
    },

    resize(bounds) {
      const clean = sanitizeBounds(bounds);
      if (!clean || !activeKey) return;
      const cv = views.get(activeKey);
      if (!cv) return;
      cv.bounds = clean;
      reconcile(cv);
    },

    setCacheMode(mode) {
      if (mode !== 'all' && mode !== 'recent3' && mode !== 'reload') {
        throw new Error('Invalid browser cache mode');
      }
      cacheMode = mode;
      enforceCache();
    },

    async deleteAccountData(campaignId, accountId) {
      const partition = accountPartition(campaignId, accountId);
      destroyView(browserKey(campaignId, accountId));
      const ses = deps.getSession(partition);
      await ses.clearStorageData();
      await ses.clearCache();
      if (ses.flushStorageData) await ses.flushStorageData();
      return true;
    },

    setWindowActive(active) {
      windowActive = active === true;
      reconcileAll();
    },

    setModal(open) {
      modalOpen = open === true;
      reconcileAll();
    },

    async applyEgress(campaignId, accountId, torEnabled) {
      const partition = accountPartition(campaignId, accountId);
      const next: EgressMode = torEnabled === true ? 'tor' : 'clearnet';
      // applyProxy may throw (Tor requested but unavailable) — do NOT flip the marker/warn in that
      // case; the partition stays on its current path.
      await applyProxy(partition, next);
      const cv = views.get(browserKey(campaignId, accountId));
      if (cv) cv.egress = next;
      let showWarning = false;
      if (next === 'tor' && !torWarned) {
        showWarning = true;
        torWarned = true;
      }
      return { mode: next, showWarning };
    },

    currentEgress(campaignId, accountId) {
      return views.get(browserKey(campaignId, accountId))?.egress ?? 'clearnet';
    },

    registerAccountHosts(urls) {
      if (!Array.isArray(urls)) return;
      for (const u of urls) if (typeof u === 'string') registerHost(u);
    },

    async fetchFavicon(rawUrl) {
      // Validate scheme + parse at the boundary — a non-http(s) or unparseable URL never fetches.
      let host: string | null;
      try {
        host = hostOfUrl(normalizeSocialUrl(rawUrl));
      } catch {
        return null;
      }
      // Host-anchoring (hardening #3): fetch ONLY a REGISTERED account host's own /favicon.ico.
      // An arbitrary/foreign host is refused WITHOUT a fetch — his handler GET'd an attacker-
      // supplied host (SSRF). We never scrape the page HTML or follow a scraped href.
      if (!host || !knownHosts.has(host)) return null;
      const u = new URL(normalizeSocialUrl(rawUrl));
      return deps.faviconFetch(`${u.protocol}//${u.host}/favicon.ico`);
    },

    externalOpen(rawUrl) {
      // Throws on a non-http(s) URL — the caller surfaces the rejection; nothing is opened.
      deps.openExternal(normalizeSocialUrl(rawUrl));
    },

    cacheStatus() {
      return {
        mode: cacheMode,
        activeKey,
        cachedKeys: [...views.keys()],
        visibleKeys: [...views.values()].filter((cv) => cv.desiredVisible).map((cv) => cv.key),
      };
    },
  };
}

// re-export for callers that only need the account shape name
export type { AccountLike };
