/**
 * WebSDR Viewer — Phase 2 hardened receiver-view manager + its IPC seam.
 *
 *  A. Manager (pure, injected fake view/session/window seams — zero electron runtime):
 *     - URL validation guards load/status/external-open at the trust boundary.
 *     - Egress: clearnet DEFAULT sets NO proxy; the Tor toggle sets the session proxy to the
 *       bg-Tor endpoint (and warns once); toggling back CLEARS the proxy (direct); a persisted Tor
 *       choice is applied on first view; Tor-unavailable refuses without changing the path.
 *     - Isolation guards: the permission handler HARD-DENIES; setWindowOpenHandler denies + only
 *       openExternals a validated URL (rejects javascript:/file:); will-navigate/redirect scheme-
 *       guard.
 *     - Multi-window z-order: present() shows+positions or hides+DETACHES; a modal detaches the
 *       overlay and restores it WITHOUT reloading; hide() closes it.
 *  B. registerWebSdrReceiverIpc wiring: every Phase-2 channel is registered AND rejects an
 *     UNTRUSTED sender frame BEFORE any argument is read (real assertTrustedSender).
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-websdr-receiver-test');

// Mock electron down to what receiver-ipc.ts's import graph touches at load: paths.ts (app.getPath),
// capture-window's assertTrustedSender (real, over this mock), and the WebContentsView/session/shell
// bindings (referenced but never called on the untrusted-sender path).
vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
  shell: { openExternal: async () => undefined },
  WebContentsView: class {},
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
  makeReceiverViewManager,
  type ReceiverViewDeps,
  type ReceiverBounds,
  type NavEventLike,
} from '../src/main/websdr/receiver-view';
import { registerWebSdrReceiverIpc } from '../src/main/websdr/receiver-ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';
import type { WebSdrEgressMode } from '../src/shared/websdr/types';

// ---- fake seams --------------------------------------------------------

function fakeView() {
  const calls = {
    loadURL: [] as string[],
    setVisible: [] as boolean[],
    setBounds: [] as ReceiverBounds[],
    muted: [] as boolean[],
    closed: 0,
    navGuards: [] as Array<[string, (e: NavEventLike, url: string) => void]>,
    windowOpenHandler: null as null | ((d: { url: string }) => { action: string }),
  };
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
    setAudioMuted: (m: boolean) => {
      calls.muted.push(m);
    },
    // Phase-3 seam additions (unused on the Phase-2 paths, present so the fake satisfies the type).
    executeJavaScript: async (_code: string) => '',
    getMediaSourceId: (_forWc: unknown) => 'source-id',
    close: () => {
      calls.closed += 1;
    },
  };
  const view = {
    webContents,
    setBounds: (b: ReceiverBounds) => calls.setBounds.push(b),
    setVisible: (v: boolean) => calls.setVisible.push(v),
  };
  return { view, calls };
}

function fakeSession() {
  const calls = {
    setProxy: [] as Array<{ proxyRules?: string; proxyBypassRules?: string; mode?: string }>,
    fetch: [] as string[],
    permReq: null as null | ((wc: unknown, p: string, cb: (g: boolean) => void) => void),
    permCheck: null as null | (() => boolean),
  };
  let fetchImpl = async (): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 });
  const ses = {
    setProxy: async (c: { proxyRules?: string; proxyBypassRules?: string; mode?: string }) => {
      calls.setProxy.push(c);
    },
    setPermissionRequestHandler: (
      h: null | ((wc: unknown, p: string, cb: (g: boolean) => void) => void),
    ) => {
      calls.permReq = h;
    },
    setPermissionCheckHandler: (h: null | (() => boolean)) => {
      calls.permCheck = h;
    },
    fetch: async (u: string) => {
      calls.fetch.push(u);
      return fetchImpl();
    },
  };
  return { ses, calls, setFetch: (f: typeof fetchImpl) => (fetchImpl = f) };
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

function harness(opts: { persistedEgress?: WebSdrEgressMode; torSocks?: string | null } = {}) {
  const v = fakeView();
  const s = fakeSession();
  const w = fakeWindow();
  let persisted = { mode: opts.persistedEgress ?? ('clearnet' as WebSdrEgressMode) };
  const external: string[] = [];
  let created = 0;
  const deps: ReceiverViewDeps = {
    getWindow: () => w.win,
    getSession: () => s.ses,
    createView: () => {
      created += 1;
      return v.view;
    },
    torSocks: () => (opts.torSocks === undefined ? '127.0.0.1:9050' : opts.torSocks),
    readEgress: async () => persisted,
    writeEgress: async (mode) => {
      persisted = { mode };
      return persisted;
    },
    openExternal: (u) => external.push(u),
  };
  const mgr = makeReceiverViewManager(deps);
  return {
    mgr,
    v,
    s,
    w,
    external,
    created: () => created,
    persisted: () => persisted,
  };
}

const BOUNDS: ReceiverBounds = { x: 10, y: 20, width: 800, height: 600 };

// ---- A. manager --------------------------------------------------------

describe('receiver-view: URL validation at the trust boundary', () => {
  it('load rejects a non-http(s) URL BEFORE a view is ever created', async () => {
    const h = harness();
    await expect(h.mgr.load('file:///etc/passwd')).rejects.toThrow();
    expect(h.created()).toBe(0);
    expect(h.v.calls.loadURL).toEqual([]);
  });

  it('load accepts https, attaches the overlay, and navigates to the normalized URL', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    expect(h.created()).toBe(1);
    expect(h.w.calls.added).toBe(1);
    expect(h.v.calls.loadURL).toEqual(['https://sdr.example/']);
    expect(h.v.calls.setVisible.at(-1)).toBe(true);
  });

  it('status rejects a non-http(s) URL without touching the network', async () => {
    const h = harness();
    const r = await h.mgr.status('javascript:alert(1)');
    expect(r.online).toBe(false);
    expect(h.s.calls.fetch).toEqual([]);
  });

  it('status runs over the session (active egress path) and reflects reachability', async () => {
    const h = harness();
    const r = await h.mgr.status('https://sdr.example/');
    expect(h.s.calls.fetch).toEqual(['https://sdr.example/']);
    expect(r).toEqual({ online: true, status: 200 });
  });

  it('externalOpen throws on a non-http(s) URL and opens a validated one', () => {
    const h = harness();
    expect(() => h.mgr.externalOpen('file:///etc/passwd')).toThrow();
    expect(h.external).toEqual([]);
    h.mgr.externalOpen('https://ok.example/');
    expect(h.external).toEqual(['https://ok.example/']);
  });
});

describe('receiver-view: egress (clearnet default + warned Tor toggle)', () => {
  it('clearnet DEFAULT sets NO proxy on the receiver session', async () => {
    const h = harness({ persistedEgress: 'clearnet' });
    await h.mgr.load('https://sdr.example/');
    expect(h.s.calls.setProxy).toEqual([]);
    expect(h.mgr.currentEgress()).toBe('clearnet');
  });

  it('a persisted Tor choice applies the Tor proxy before the first navigation', async () => {
    const h = harness({ persistedEgress: 'tor' });
    await h.mgr.load('https://sdr.example/');
    expect(h.s.calls.setProxy).toEqual([
      { proxyRules: 'socks5://127.0.0.1:9050', proxyBypassRules: '' },
    ]);
    expect(h.mgr.currentEgress()).toBe('tor');
  });

  it('applyEgress("tor") sets the session proxy to the bg-Tor endpoint, persists, and warns once', async () => {
    const h = harness();
    const r1 = await h.mgr.applyEgress('tor');
    expect(h.s.calls.setProxy.at(-1)).toEqual({
      proxyRules: 'socks5://127.0.0.1:9050',
      proxyBypassRules: '',
    });
    expect(r1).toEqual({ mode: 'tor', showWarning: true });
    expect(h.persisted().mode).toBe('tor');
    expect(h.mgr.currentEgress()).toBe('tor');
    const r2 = await h.mgr.applyEgress('tor');
    expect(r2.showWarning).toBe(false);
  });

  it('applyEgress("clearnet") CLEARS the proxy back to direct', async () => {
    const h = harness();
    await h.mgr.applyEgress('tor');
    const r = await h.mgr.applyEgress('clearnet');
    expect(h.s.calls.setProxy.at(-1)).toEqual({ mode: 'direct' });
    expect(r.mode).toBe('clearnet');
    expect(h.mgr.currentEgress()).toBe('clearnet');
    expect(h.persisted().mode).toBe('clearnet');
  });

  it('applyEgress("tor") with no Tor available REFUSES without setting a proxy or persisting', async () => {
    const h = harness({ torSocks: null });
    await expect(h.mgr.applyEgress('tor')).rejects.toThrow();
    expect(h.s.calls.setProxy).toEqual([]);
    expect(h.persisted().mode).toBe('clearnet');
    expect(h.mgr.currentEgress()).toBe('clearnet');
  });

  it('an unknown egress mode clamps to clearnet (direct)', async () => {
    const h = harness();
    const r = await h.mgr.applyEgress('anything-else');
    expect(r.mode).toBe('clearnet');
    expect(h.s.calls.setProxy.at(-1)).toEqual({ mode: 'direct' });
  });
});

describe('receiver-view: isolation guards on the remote receiver page', () => {
  it('hard-denies every permission request and check on the receiver session', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    let granted: boolean | undefined;
    h.s.calls.permReq?.({}, 'media', (g) => {
      granted = g;
    });
    expect(granted).toBe(false);
    expect(h.s.calls.permCheck?.()).toBe(false);
  });

  it('setWindowOpenHandler denies new windows and only openExternals a validated URL', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    const handler = h.v.calls.windowOpenHandler!;
    expect(handler({ url: 'https://good.example/' })).toEqual({ action: 'deny' });
    expect(h.external).toEqual(['https://good.example/']);
    // A javascript:/file: URL is denied AND never reaches shell.openExternal.
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(h.external).toEqual(['https://good.example/']);
  });

  it('will-navigate and will-redirect both block a non-http(s) scheme jump', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    expect(h.v.calls.navGuards.map((g) => g[0])).toEqual(['will-navigate', 'will-redirect']);
    for (const [, guard] of h.v.calls.navGuards) {
      const blocked = { preventDefault: vi.fn() };
      guard(blocked, 'javascript:alert(1)');
      expect(blocked.preventDefault).toHaveBeenCalled();
      const allowed = { preventDefault: vi.fn() };
      guard(allowed, 'https://elsewhere.example/');
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('mute drives setAudioMuted on the receiver webContents', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    h.mgr.setMuted(true);
    expect(h.v.calls.muted).toEqual([true]);
  });
});

describe('receiver-view: multi-window z-order + modal detach', () => {
  it('present(visible:false) hides AND detaches so the overlay cannot float over another window', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    expect(h.w.calls.added).toBe(1);
    h.mgr.present({ visible: false });
    expect(h.v.calls.setVisible.at(-1)).toBe(false);
    expect(h.w.calls.removed).toBe(1);
  });

  it('present(visible:true, bounds) re-attaches, positions, and shows', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    h.mgr.present({ visible: false });
    h.mgr.present({ visible: true, bounds: BOUNDS });
    expect(h.w.calls.added).toBe(2);
    expect(h.v.calls.setBounds.at(-1)).toEqual(BOUNDS);
    expect(h.v.calls.setVisible.at(-1)).toBe(true);
  });

  it('a modal detaches the overlay and restores it WITHOUT reloading', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    const loadsBefore = h.v.calls.loadURL.length;
    h.mgr.setModal(true);
    expect(h.w.calls.removed).toBe(1);
    expect(h.v.calls.closed).toBe(0); // detached, not destroyed
    h.mgr.setModal(false);
    expect(h.w.calls.added).toBe(2);
    expect(h.v.calls.loadURL.length).toBe(loadsBefore); // no reload
  });

  it('hide() closes the webContents and a later present is a no-op until reloaded', async () => {
    const h = harness();
    await h.mgr.load('https://sdr.example/');
    h.mgr.hide();
    expect(h.v.calls.closed).toBe(1);
    expect(h.w.calls.removed).toBe(1);
    const addedAfterHide = h.w.calls.added;
    h.mgr.present({ visible: true, bounds: BOUNDS });
    expect(h.created()).toBe(1); // no new view
    expect(h.w.calls.added).toBe(addedAfterHide); // nothing re-attached
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
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://sdr.attacker/' } };
const SENDER_ERROR = 'Rejected IPC from an untrusted sender frame.';

const RECEIVER_CHANNELS = [
  channels.websdr.receiverLoad,
  channels.websdr.receiverHide,
  channels.websdr.receiverPresent,
  channels.websdr.receiverModal,
  channels.websdr.receiverStatus,
  channels.websdr.receiverMute,
  channels.websdr.receiverExternalOpen,
  channels.websdr.receiverEgressApply,
];

describe('registerWebSdrReceiverIpc: every channel is wired + sender-checks FIRST', () => {
  it('sanity-checks the real assertTrustedSender fixture', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });

  it('registers a handler for every Phase-2 receiver channel', () => {
    const ipc = fakeIpcMain();
    registerWebSdrReceiverIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of RECEIVER_CHANNELS) expect(ipc.registered.has(ch)).toBe(true);
  });

  it('rejects an untrusted sender on EVERY channel, even with garbage args', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrReceiverIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of RECEIVER_CHANNELS) {
      const fn = ipc.registered.get(ch)!;
      await expect(
        (async () => fn(UNTRUSTED_EVENT, { hostile: true }))(),
      ).rejects.toThrow(SENDER_ERROR);
    }
  });

  it('a trusted sender reaches past the boundary (modal toggle needs no view/window)', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrReceiverIpc({ handle: ipc.handle as never, getWindow: () => null });
    const fn = ipc.registered.get(channels.websdr.receiverModal)!;
    await expect((async () => fn(TRUSTED_EVENT, false))()).resolves.not.toThrow();
  });
});
