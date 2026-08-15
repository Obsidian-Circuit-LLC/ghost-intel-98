/**
 * Ghost Social Media Manager (hardened GI98 port) — Phase 2: per-account view manager + the
 * OVERLAY LIFECYCLE + egress + isolation guards, and their IPC seam.
 *
 * A. Manager (pure, injected fake view/session/window seams — zero electron runtime):
 *    - Egress (G8): clearnet DEFAULT sets NO proxy on the partition; the per-account Tor toggle sets
 *      that partition's session proxy to the bg-Tor SOCKS (and warns once); toggling back CLEARS it
 *      (direct); a persisted `torEnabled` account applies Tor before its first navigation;
 *      Tor-unavailable refuses without changing the path. Each account's partition is independent.
 *    - Isolation guards (constraint 5/6): setWindowOpenHandler DENIES new windows, navigates only a
 *      SAME-SITE popup in place, else openExternals a scheme-guarded URL, and drops javascript:/file:;
 *      will-navigate/will-redirect scheme-guard; favicon:fetch is host-anchored to a REGISTERED
 *      account host (a foreign host is refused, the fetch seam never called); openExternal rejects
 *      non-http(s).
 *    - Overlay lifecycle (constraint 9, MULTIPLIED): a view shows ONLY while the module reports the
 *      window active + non-modal AND the view has on-screen bounds; a governor "window inactive"
 *      call hides + DETACHES every view; a modal detaches all and restores WITHOUT reloading; the
 *      compose grid hosts many views that tear down together; closeAll/teardown closes every
 *      webContents.
 * B. registerGhostSocialViewIpc: every Phase-2 channel is registered AND rejects an UNTRUSTED sender
 *    frame BEFORE any argument is read (real assertTrustedSender).
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-ghost-social-view-test');

// Mock electron down to what view-ipc.ts's import graph touches at load: paths.ts (app.getPath) and
// capture-window's assertTrustedSender (real, over this mock). WebContentsView/session/shell are
// referenced but never called on the untrusted-sender path.
vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({}) },
  shell: { openExternal: async () => undefined },
  WebContentsView: class {},
  dialog: { showSaveDialog: async () => ({ canceled: true }) },
}));
vi.mock('../src/main/services/vault', () => ({
  isEnabledCached: () => false,
  isUnlocked: () => true,
  shouldEncrypt: () => false,
  hasMagicPrefix: () => false,
  isEncrypted: () => false,
  encryptBuffer: (b: Buffer) => b,
  decryptBuffer: (b: Buffer) => b,
}));

import { channels } from '../src/shared/ipc-contracts';
import {
  makeGhostSocialViewManager,
  type ViewManagerDeps,
  type ViewBounds,
  type NavEventLike,
} from '../src/main/ghost-social/view-manager';
import { registerGhostSocialViewIpc } from '../src/main/ghost-social/view-ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';
import { accountPartition } from '../src/shared/ghost-social/types';

// ---- fake seams --------------------------------------------------------

function fakeView() {
  const calls = {
    loadURL: [] as string[],
    reloaded: 0,
    setVisible: [] as boolean[],
    setBounds: [] as ViewBounds[],
    closed: 0,
    navGuards: [] as Array<[string, (e: NavEventLike, url: string) => void]>,
    windowOpenHandler: null as null | ((d: { url: string }) => { action: string }),
  };
  let destroyed = false;
  const webContents = {
    setWindowOpenHandler: (h: (d: { url: string }) => { action: 'allow' | 'deny' }) => {
      calls.windowOpenHandler = h;
    },
    on: (ev: 'will-navigate' | 'will-redirect', l: (e: NavEventLike, url: string) => void) => {
      calls.navGuards.push([ev, l]);
    },
    loadURL: async (u: string) => {
      calls.loadURL.push(u);
    },
    reload: () => {
      calls.reloaded += 1;
    },
    goBack: () => undefined,
    goForward: () => undefined,
    canGoBack: () => true,
    canGoForward: () => true,
    isDestroyed: () => destroyed,
    close: () => {
      calls.closed += 1;
      destroyed = true;
    },
  };
  const view = {
    webContents,
    setBounds: (b: ViewBounds) => calls.setBounds.push(b),
    setVisible: (v: boolean) => calls.setVisible.push(v),
  };
  return { view, calls };
}

function fakeSession() {
  const calls = {
    setProxy: [] as Array<{ proxyRules?: string; proxyBypassRules?: string; mode?: string }>,
    cleared: 0,
  };
  const ses = {
    setProxy: async (c: { proxyRules?: string; proxyBypassRules?: string; mode?: string }) => {
      calls.setProxy.push(c);
    },
    clearStorageData: async () => {
      calls.cleared += 1;
    },
    clearCache: async () => undefined,
    flushStorageData: async () => undefined,
  };
  return { ses, calls };
}

function fakeWindow() {
  const calls = { added: 0, removed: 0 };
  const contentView = {
    addChildView: () => {
      calls.added += 1;
    },
    removeChildView: () => {
      calls.removed += 1;
    },
  };
  return { win: { contentView }, calls };
}

function harness(opts: { torSocks?: string | null } = {}) {
  const w = fakeWindow();
  // One fake view + session per partition (per account).
  const views = new Map<string, ReturnType<typeof fakeView>>();
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const external: string[] = [];
  const faviconFetches: string[] = [];
  let created = 0;
  let lastCreatedPartition = '';

  const sessionFor = (partition: string) => {
    let s = sessions.get(partition);
    if (!s) {
      s = fakeSession();
      sessions.set(partition, s);
    }
    return s;
  };

  const deps: ViewManagerDeps = {
    getWindow: () => w.win,
    getSession: (partition) => sessionFor(partition).ses,
    createView: (partition) => {
      created += 1;
      lastCreatedPartition = partition;
      const v = fakeView();
      views.set(partition, v);
      return v.view;
    },
    torSocks: () => (opts.torSocks === undefined ? '127.0.0.1:9050' : opts.torSocks),
    openExternal: (u) => external.push(u),
    faviconFetch: async (iconUrl) => {
      faviconFetches.push(iconUrl);
      return `file:///cache/${encodeURIComponent(iconUrl)}.ico`;
    },
  };
  const mgr = makeGhostSocialViewManager(deps);
  return {
    mgr,
    w,
    external,
    faviconFetches,
    created: () => created,
    lastCreatedPartition: () => lastCreatedPartition,
    viewFor: (campaignId: string, accountId: string) =>
      views.get(accountPartition(campaignId, accountId))!,
    sessionCalls: (campaignId: string, accountId: string) =>
      sessionFor(accountPartition(campaignId, accountId)).calls,
    activate: () => mgr.setWindowActive(true),
  };
}

const CID = 'camp1';
const ACC = { id: 'acc1', url: 'https://x.com/', platform: 'x' as const, name: 'A' };
const BOUNDS: ViewBounds = { x: 10, y: 20, width: 800, height: 600 };

async function openActive(h: ReturnType<typeof harness>, account = ACC, bounds = BOUNDS) {
  h.activate();
  await h.mgr.openAccount(CID, account, bounds);
}

// ---- A. egress ---------------------------------------------------------

describe('view-manager: egress (per-account clearnet default + warned Tor toggle)', () => {
  it('clearnet DEFAULT opens an account with NO proxy set on its partition', async () => {
    const h = harness();
    await openActive(h);
    expect(h.sessionCalls(CID, ACC.id).setProxy).toEqual([]);
    expect(h.mgr.currentEgress(CID, ACC.id)).toBe('clearnet');
  });

  it('a persisted torEnabled account applies the Tor proxy BEFORE its first navigation', async () => {
    const h = harness();
    h.activate();
    await h.mgr.openAccount(CID, { ...ACC, torEnabled: true }, BOUNDS);
    expect(h.sessionCalls(CID, ACC.id).setProxy).toEqual([
      { proxyRules: 'socks5://127.0.0.1:9050', proxyBypassRules: '' },
    ]);
    // The proxy is set before loadURL so the very first request already follows Tor.
    const v = h.viewFor(CID, ACC.id);
    expect(v.calls.loadURL).toEqual(['https://x.com/']);
    expect(h.mgr.currentEgress(CID, ACC.id)).toBe('tor');
  });

  it('applyEgress("tor") sets the partition proxy to the bg-Tor endpoint, and warns once', async () => {
    const h = harness();
    await openActive(h);
    const r1 = await h.mgr.applyEgress(CID, ACC.id, true);
    expect(h.sessionCalls(CID, ACC.id).setProxy.at(-1)).toEqual({
      proxyRules: 'socks5://127.0.0.1:9050',
      proxyBypassRules: '',
    });
    expect(r1).toEqual({ mode: 'tor', showWarning: true });
    expect(h.mgr.currentEgress(CID, ACC.id)).toBe('tor');
    const r2 = await h.mgr.applyEgress(CID, ACC.id, true);
    expect(r2.showWarning).toBe(false);
  });

  it('applyEgress(false) CLEARS the proxy back to direct', async () => {
    const h = harness();
    await openActive(h);
    await h.mgr.applyEgress(CID, ACC.id, true);
    const r = await h.mgr.applyEgress(CID, ACC.id, false);
    expect(h.sessionCalls(CID, ACC.id).setProxy.at(-1)).toEqual({ mode: 'direct' });
    expect(r.mode).toBe('clearnet');
    expect(h.mgr.currentEgress(CID, ACC.id)).toBe('clearnet');
  });

  it('applyEgress("tor") with no Tor available REFUSES without setting a proxy', async () => {
    const h = harness({ torSocks: null });
    await openActive(h);
    await expect(h.mgr.applyEgress(CID, ACC.id, true)).rejects.toThrow();
    expect(h.sessionCalls(CID, ACC.id).setProxy).toEqual([]);
    expect(h.mgr.currentEgress(CID, ACC.id)).toBe('clearnet');
  });

  it('one account on Tor does not proxy a different account (partition isolation)', async () => {
    const h = harness();
    await openActive(h);
    const other = { id: 'acc2', url: 'https://bsky.app/', platform: 'bluesky' as const, name: 'B' };
    await h.mgr.openAccount(CID, other, BOUNDS);
    await h.mgr.applyEgress(CID, ACC.id, true);
    expect(h.sessionCalls(CID, ACC.id).setProxy.at(-1)).toEqual({
      proxyRules: 'socks5://127.0.0.1:9050',
      proxyBypassRules: '',
    });
    expect(h.sessionCalls(CID, other.id).setProxy).toEqual([]);
  });
});

// ---- A. isolation guards -----------------------------------------------

describe('view-manager: window-open + navigation guards', () => {
  it('setWindowOpenHandler denies new windows; same-site popup navigates in place; off-site opens externally', async () => {
    const h = harness();
    await openActive(h);
    const v = h.viewFor(CID, ACC.id);
    const handler = v.calls.windowOpenHandler!;

    // same-site (x.com sub-page) → navigate the view in place, NOT a new window, NOT external.
    const loadsBefore = v.calls.loadURL.length;
    expect(handler({ url: 'https://x.com/settings' })).toEqual({ action: 'deny' });
    expect(v.calls.loadURL.length).toBe(loadsBefore + 1);
    expect(v.calls.loadURL.at(-1)).toBe('https://x.com/settings');
    expect(h.external).toEqual([]);

    // off-site http(s) → system browser, view unchanged.
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
    expect(v.calls.loadURL.length).toBe(loadsBefore + 1);
    expect(h.external).toEqual(['https://evil.example/']);
  });

  it('a javascript:/file: popup is denied and drives NEITHER a navigation NOR an external open', async () => {
    const h = harness();
    await openActive(h);
    const v = h.viewFor(CID, ACC.id);
    const handler = v.calls.windowOpenHandler!;
    const loadsBefore = v.calls.loadURL.length;
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(v.calls.loadURL.length).toBe(loadsBefore);
    expect(h.external).toEqual([]);
  });

  it('will-navigate and will-redirect both block a non-http(s) scheme jump but allow http(s)', async () => {
    const h = harness();
    await openActive(h);
    const v = h.viewFor(CID, ACC.id);
    expect(v.calls.navGuards.map((g) => g[0])).toEqual(['will-navigate', 'will-redirect']);
    for (const [, guard] of v.calls.navGuards) {
      const blocked = { preventDefault: vi.fn() };
      guard(blocked, 'file:///etc/passwd');
      expect(blocked.preventDefault).toHaveBeenCalled();
      const allowed = { preventDefault: vi.fn() };
      guard(allowed, 'https://x.com/anywhere');
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe('view-manager: favicon host-anchoring + external open', () => {
  it('fetches a REGISTERED account host only via its own /favicon.ico', async () => {
    const h = harness();
    h.mgr.registerAccountHosts(['https://x.com/']);
    const path = await h.mgr.fetchFavicon('https://x.com/some/deep/page');
    expect(h.faviconFetches).toEqual(['https://x.com/favicon.ico']);
    expect(path).toContain('file:///cache/');
  });

  it('refuses a FOREIGN (unregistered) host — the fetch seam is never called', async () => {
    const h = harness();
    h.mgr.registerAccountHosts(['https://x.com/']);
    const path = await h.mgr.fetchFavicon('https://evil.example/favicon.ico');
    expect(path).toBeNull();
    expect(h.faviconFetches).toEqual([]);
  });

  it('refuses a non-http(s) favicon URL without fetching', async () => {
    const h = harness();
    h.mgr.registerAccountHosts(['https://x.com/']);
    const path = await h.mgr.fetchFavicon('file:///etc/passwd');
    expect(path).toBeNull();
    expect(h.faviconFetches).toEqual([]);
  });

  it('an opened account auto-registers its host for favicon fetches', async () => {
    const h = harness();
    await openActive(h);
    const path = await h.mgr.fetchFavicon('https://x.com/');
    expect(path).toContain('file:///cache/');
    expect(h.faviconFetches).toEqual(['https://x.com/favicon.ico']);
  });

  it('externalOpen throws on a non-http(s) URL and opens a validated one', () => {
    const h = harness();
    expect(() => h.mgr.externalOpen('file:///etc/passwd')).toThrow();
    expect(h.external).toEqual([]);
    h.mgr.externalOpen('https://ok.example/');
    expect(h.external).toEqual(['https://ok.example/']);
  });
});

// ---- A. overlay lifecycle ----------------------------------------------

describe('view-manager: overlay lifecycle governor (constraint 9)', () => {
  it('openAccount attaches + shows the view when the window is active', async () => {
    const h = harness();
    await openActive(h);
    expect(h.created()).toBe(1);
    expect(h.w.calls.added).toBe(1);
    const v = h.viewFor(CID, ACC.id);
    expect(v.calls.setBounds.at(-1)).toEqual(BOUNDS);
    expect(v.calls.setVisible.at(-1)).toBe(true);
    expect(v.calls.loadURL).toEqual(['https://x.com/']);
  });

  it('a view stays HIDDEN + detached until the window is reported active (fail-closed)', async () => {
    const h = harness();
    // No activate() — window inactive by default.
    await h.mgr.openAccount(CID, ACC, BOUNDS);
    const v = h.viewFor(CID, ACC.id);
    expect(v.calls.setVisible.at(-1)).toBe(false);
    expect(h.w.calls.added).toBe(0); // never attached while inactive
    // Now the module reports active → it attaches + shows.
    h.mgr.setWindowActive(true);
    expect(h.w.calls.added).toBe(1);
    expect(v.calls.setVisible.at(-1)).toBe(true);
  });

  it('a governor "window inactive" call hides AND detaches EVERY view', async () => {
    const h = harness();
    await openActive(h);
    const grid = [
      { account: { id: 'g1', url: 'https://bsky.app/', platform: 'bluesky' as const, name: 'g1' }, bounds: BOUNDS },
      { account: { id: 'g2', url: 'https://x.com/', platform: 'x' as const, name: 'g2' }, bounds: BOUNDS },
    ];
    await h.mgr.showGrid(CID, grid);
    const before = h.w.calls.removed;
    h.mgr.setWindowActive(false);
    // Every currently-attached view is hidden + detached.
    for (const acc of [ACC.id, 'g1', 'g2']) {
      const v = h.viewFor(CID, acc);
      expect(v.calls.setVisible.at(-1)).toBe(false);
    }
    expect(h.w.calls.removed).toBeGreaterThan(before);
  });

  it('a modal detaches all views and restores them WITHOUT reloading', async () => {
    const h = harness();
    await openActive(h);
    const v = h.viewFor(CID, ACC.id);
    const loadsBefore = v.calls.loadURL.length;
    const removedBefore = h.w.calls.removed;
    h.mgr.setModal(true);
    expect(v.calls.setVisible.at(-1)).toBe(false);
    expect(h.w.calls.removed).toBe(removedBefore + 1);
    expect(v.calls.closed).toBe(0); // detached, not destroyed
    h.mgr.setModal(false);
    expect(v.calls.setVisible.at(-1)).toBe(true);
    expect(v.calls.loadURL.length).toBe(loadsBefore); // no reload
  });

  it('showGrid hosts many views, each at its own card bounds', async () => {
    const h = harness();
    h.activate();
    const b1 = { x: 0, y: 0, width: 200, height: 200 };
    const b2 = { x: 200, y: 0, width: 200, height: 200 };
    await h.mgr.showGrid(CID, [
      { account: { id: 'g1', url: 'https://bsky.app/', platform: 'bluesky' as const, name: 'g1' }, bounds: b1 },
      { account: { id: 'g2', url: 'https://x.com/', platform: 'x' as const, name: 'g2' }, bounds: b2 },
    ]);
    expect(h.viewFor(CID, 'g1').calls.setBounds.at(-1)).toEqual(b1);
    expect(h.viewFor(CID, 'g2').calls.setBounds.at(-1)).toEqual(b2);
    expect(h.viewFor(CID, 'g1').calls.setVisible.at(-1)).toBe(true);
    expect(h.viewFor(CID, 'g2').calls.setVisible.at(-1)).toBe(true);
  });

  it('closeAll tears down (closes the webContents of) every view', async () => {
    const h = harness();
    await openActive(h);
    await h.mgr.showGrid(CID, [
      { account: { id: 'g1', url: 'https://bsky.app/', platform: 'bluesky' as const, name: 'g1' }, bounds: BOUNDS },
    ]);
    h.mgr.closeAll();
    expect(h.viewFor(CID, ACC.id).calls.closed).toBe(1);
    expect(h.viewFor(CID, 'g1').calls.closed).toBe(1);
    expect(h.mgr.cacheStatus().cachedKeys).toEqual([]);
  });

  it('deleteAccountData closes the view and clears its partition storage', async () => {
    const h = harness();
    await openActive(h);
    const removedBefore = h.w.calls.removed;
    await h.mgr.deleteAccountData(CID, ACC.id);
    expect(h.viewFor(CID, ACC.id).calls.closed).toBe(1);
    expect(h.sessionCalls(CID, ACC.id).cleared).toBe(1);
    expect(h.w.calls.removed).toBe(removedBefore + 1);
  });

  it('refresh reloads a cached view', async () => {
    const h = harness();
    await openActive(h);
    expect(h.mgr.refresh(CID, ACC.id)).toBe(true);
    expect(h.viewFor(CID, ACC.id).calls.reloaded).toBe(1);
  });
});

// ---- B. IPC registration seam ------------------------------------------

function fakeIpcMain() {
  const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    registered.set(channel, (e, ...args) => fn(e, ...args));
  };
  return { registered, handle };
}

const TRUSTED_EVENT = { senderFrame: { url: 'file:///app/index.html' } };
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://x.com/' } };
const SENDER_ERROR = 'Rejected IPC from an untrusted sender frame.';

const VIEW_CHANNELS = [
  channels.ghostSocial.browserOpenAccount,
  channels.ghostSocial.browserShowGrid,
  channels.ghostSocial.browserHide,
  channels.ghostSocial.browserClose,
  channels.ghostSocial.browserCloseAll,
  channels.ghostSocial.browserRefresh,
  channels.ghostSocial.browserNav,
  channels.ghostSocial.browserResize,
  channels.ghostSocial.browserSetCacheMode,
  channels.ghostSocial.browserDeleteAccountData,
  channels.ghostSocial.browserSetWindowActive,
  channels.ghostSocial.browserSetModal,
  channels.ghostSocial.browserApplyEgress,
  channels.ghostSocial.browserRegisterHosts,
  channels.ghostSocial.browserCacheStatus,
  channels.ghostSocial.faviconFetch,
  channels.ghostSocial.openExternal,
];

describe('registerGhostSocialViewIpc: every channel is wired + sender-checks FIRST', () => {
  it('sanity-checks the real assertTrustedSender fixture', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });

  it('registers a handler for every Phase-2 view channel', () => {
    const ipc = fakeIpcMain();
    registerGhostSocialViewIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of VIEW_CHANNELS) expect(ipc.registered.has(ch)).toBe(true);
  });

  it('rejects an untrusted sender on EVERY channel, even with garbage args', async () => {
    const ipc = fakeIpcMain();
    registerGhostSocialViewIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of VIEW_CHANNELS) {
      const fn = ipc.registered.get(ch)!;
      await expect(
        (async () => fn(UNTRUSTED_EVENT, { hostile: true }))(),
      ).rejects.toThrow(SENDER_ERROR);
    }
  });

  it('a trusted sender reaches past the boundary (modal toggle needs no view/window)', async () => {
    const ipc = fakeIpcMain();
    registerGhostSocialViewIpc({ handle: ipc.handle as never, getWindow: () => null });
    const fn = ipc.registered.get(channels.ghostSocial.browserSetModal)!;
    await expect((async () => fn(TRUSTED_EVENT, true))()).resolves.not.toThrow();
  });
});
