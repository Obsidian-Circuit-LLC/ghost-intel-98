/**
 * Ghost Social Media Manager (hardened GI98 port) — per-account view-manager IPC wiring
 * (Phase 2, G2/G3/G8, constraints 4/5/6/9).
 *
 * Wires the pure `makeGhostSocialViewManager` (view-manager.ts) to the production Electron seams
 * and registers its channels. Like `registerGhostSocialIpc`, every handler calls
 * `assertTrustedSender` FIRST — these overlays host the user's authenticated (and thus sensitive)
 * social sessions, so an IPC message from a non-app frame is rejected before a single argument is
 * read (the v3.24.2 "no fail-open" invariant) — then validates its argument shape before delegating
 * to the manager.
 *
 * Production seams:
 *  - Each overlay is a `WebContentsView` on that account's own `persist:ghost-<campaign>-<account>`
 *    partition with the full isolation `webPreferences` (contextIsolation/nodeIntegration:false/
 *    sandbox — his defaults, kept). Cookies never cross accounts.
 *  - `getSession(partition)` is that partition's session; the manager drives its proxy (per-account
 *    Tor toggle) and its storage wipe (delete-account-data).
 *  - `torSocks()` is the bg-Tor SOCKS endpoint (`getBgTor()`), returned even before Tor bootstraps
 *    so the Tor path fails CLOSED rather than leaking to clearnet.
 *  - `faviconFetch` is SSRF-guarded (`safeFetch`) and caches under the module data dir; the manager
 *    host-anchors it to a REGISTERED account host's own /favicon.ico (hardening #3).
 *  - `openExternal` is `shell.openExternal`; the manager scheme-guards to http/https (hardening #4).
 */

import { channels } from '@shared/ipc-contracts';
import { accountPartition, type BrowserCacheMode } from '@shared/ghost-social/types';
import { assertTrustedSender } from '../capture/capture-window';
import { getBgTor } from '../bgconn/tor-singleton';
import {
  makeGhostSocialViewManager,
  type GhostSocialViewManager,
  type ViewManagerDeps,
  type GsmViewLike,
  type GsmSessionLike,
  type WindowContentViewLike,
  type ViewBounds,
  type ViewAccount,
} from './view-manager';

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

type BrowserWindowLike = { contentView: unknown } | null;

/** Isolation `webPreferences` for every per-account overlay — his defaults kept, plus the app's
 *  standard hardening flags (mirrors the WebSDR receiver overlay). */
function accountWebPreferences(partition: string) {
  return {
    partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  };
}

/** Wire the production Electron seams behind the pure manager. Every electron/bgconn/fs reference
 *  is inside a closure, so importing this module never touches electron at load and constructing
 *  the deps never creates a view/session until the manager first needs one. */
export function prodViewManagerDeps(getWindow: () => BrowserWindowLike): ViewManagerDeps {
  return {
    getWindow: () => {
      const win = getWindow();
      return win ? { contentView: win.contentView as WindowContentViewLike } : null;
    },
    getSession: (partition) => {
      // Resolved lazily via require so importing this module never evaluates electron.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { session } = require('electron') as typeof import('electron');
      return session.fromPartition(partition) as unknown as GsmSessionLike;
    },
    createView: (partition) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { WebContentsView } = require('electron') as typeof import('electron');
      return new WebContentsView({
        webPreferences: accountWebPreferences(partition),
      }) as unknown as GsmViewLike;
    },
    torSocks: () => {
      const t = getBgTor();
      // Endpoint is offered whenever a Tor instance exists (even pre-bootstrap): a SOCKS connect to
      // a not-yet-listening port fails closed, so the toggle can never fall back to clearnet.
      return t ? `127.0.0.1:${t.socksPort()}` : null;
    },
    openExternal: (url) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { shell } = require('electron') as typeof import('electron');
      void shell.openExternal(url);
    },
    faviconFetch: async (iconUrl) => {
      try {
        const [{ safeFetch }, paths, fs, crypto, nodePath] = await Promise.all([
          import('../net/safe-fetch'),
          import('../storage/paths'),
          import('node:fs/promises'),
          import('node:crypto'),
          import('node:path'),
        ]);
        const res = await safeFetch(iconUrl);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const host = new URL(iconUrl).host;
        const ext = (res.headers.get('content-type') || '').includes('png') ? '.png' : '.ico';
        const dir = paths.ghostSocialFaviconDir();
        await fs.mkdir(dir, { recursive: true });
        const file = nodePath.join(dir, crypto.createHash('sha1').update(host).digest('hex') + ext);
        await fs.writeFile(file, buf);
        return `file://${file.replace(/\\/g, '/')}`;
      } catch {
        return null;
      }
    },
    diag: appendGhostSocialDiag,
  };
}

/** v3.72.1 field diagnostic sink — mirror of the WebSDR one: append one timestamped line to
 *  `<module data>/diag.log`, self-capped at ~512 KB. Plaintext by design (view key, visibility,
 *  integer bounds only — never a secret) so a user can send it to diagnose a blank embedded view.
 *  Never throws. */
function appendGhostSocialDiag(line: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const nodePath = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { ghostSocialDir } = require('../storage/paths') as typeof import('../storage/paths');
    const dir = ghostSocialDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = nodePath.join(dir, 'diag.log');
    try { if (fs.statSync(p).size > 512 * 1024) fs.writeFileSync(p, ''); } catch { /* first write */ }
    fs.appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch { /* diagnostic only */ }
}

// ---- argument-shape validators (the renderer is hostile) ---------------

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${what} requires a string.`);
  return v;
}

/** True iff `v` is a plausible bounds object (each field a finite number). The manager re-sanitizes;
 *  rejecting a non-object here keeps a garbage payload from reaching it. */
function asBounds(v: unknown): ViewBounds | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { x: n(o.x), y: n(o.y), width: n(o.width), height: n(o.height) };
}

/** Coerce a renderer-supplied account into the minimal `{id,url,torEnabled?}` the manager needs.
 *  `url` MUST be a string (the manager validates the scheme downstream). */
function asAccount(v: unknown): ViewAccount {
  if (!v || typeof v !== 'object') throw new Error('An account object is required.');
  const o = v as Record<string, unknown>;
  return {
    id: asString(o.id, 'account.id'),
    url: asString(o.url, 'account.url'),
    torEnabled: o.torEnabled === true,
  };
}

/**
 * Register the Phase-2 view-manager channels. `getWindow` yields the app's desktop window (the
 * overlay parent). A fresh manager is built per registration — production calls this exactly once.
 */
export function registerGhostSocialViewIpc(deps: {
  handle: HandleWithEvent;
  getWindow: () => BrowserWindowLike;
}): GhostSocialViewManager {
  const { handle, getWindow } = deps;
  const mgr = makeGhostSocialViewManager(prodViewManagerDeps(getWindow));

  handle(channels.ghostSocial.browserOpenAccount, (e, campaignId, account, bounds) => {
    assertTrustedSender(e);
    return mgr.openAccount(asString(campaignId, 'campaignId'), asAccount(account), asBounds(bounds));
  });

  handle(channels.ghostSocial.browserShowGrid, (e, campaignId, items) => {
    assertTrustedSender(e);
    const cid = asString(campaignId, 'campaignId');
    if (!Array.isArray(items)) throw new Error('showGrid requires an array of {account,bounds}.');
    const parsed = items.map((it) => {
      const o = (it || {}) as Record<string, unknown>;
      const b = asBounds(o.bounds);
      if (!b) throw new Error('Each grid item requires bounds.');
      return { account: asAccount(o.account), bounds: b };
    });
    return mgr.showGrid(cid, parsed);
  });

  handle(channels.ghostSocial.browserHide, (e) => {
    assertTrustedSender(e);
    mgr.hideAll();
  });

  handle(channels.ghostSocial.browserClose, (e, campaignId, accountId) => {
    assertTrustedSender(e);
    mgr.closeAccount(asString(campaignId, 'campaignId'), asString(accountId, 'accountId'));
  });

  handle(channels.ghostSocial.browserCloseAll, (e) => {
    assertTrustedSender(e);
    mgr.closeAll();
  });

  handle(channels.ghostSocial.browserRefresh, (e, campaignId, accountId) => {
    assertTrustedSender(e);
    return mgr.refresh(asString(campaignId, 'campaignId'), asString(accountId, 'accountId'));
  });

  handle(channels.ghostSocial.browserNav, (e, action) => {
    assertTrustedSender(e);
    const a = asString(action, 'nav action');
    if (a !== 'back' && a !== 'forward' && a !== 'reload' && a !== 'home') {
      throw new Error('nav action must be back/forward/reload/home.');
    }
    return mgr.nav(a);
  });

  handle(channels.ghostSocial.browserResize, (e, bounds) => {
    assertTrustedSender(e);
    const b = asBounds(bounds);
    if (!b) throw new Error('resize requires a bounds object.');
    mgr.resize(b);
  });

  handle(channels.ghostSocial.browserSetCacheMode, (e, mode) => {
    assertTrustedSender(e);
    mgr.setCacheMode(mode as BrowserCacheMode);
  });

  handle(channels.ghostSocial.browserDeleteAccountData, (e, campaignId, accountId) => {
    assertTrustedSender(e);
    return mgr.deleteAccountData(asString(campaignId, 'campaignId'), asString(accountId, 'accountId'));
  });

  handle(channels.ghostSocial.browserSetWindowActive, (e, active) => {
    assertTrustedSender(e);
    mgr.setWindowActive(active === true);
  });

  handle(channels.ghostSocial.browserSetModal, (e, open) => {
    assertTrustedSender(e);
    mgr.setModal(open === true);
  });

  handle(channels.ghostSocial.browserApplyEgress, (e, campaignId, accountId, torEnabled) => {
    assertTrustedSender(e);
    return mgr.applyEgress(
      asString(campaignId, 'campaignId'),
      asString(accountId, 'accountId'),
      torEnabled === true,
    );
  });

  handle(channels.ghostSocial.browserRegisterHosts, (e, urls) => {
    assertTrustedSender(e);
    if (!Array.isArray(urls)) throw new Error('registerHosts requires an array of URLs.');
    mgr.registerAccountHosts(urls.filter((u): u is string => typeof u === 'string'));
  });

  handle(channels.ghostSocial.browserCacheStatus, (e) => {
    assertTrustedSender(e);
    return mgr.cacheStatus();
  });

  handle(channels.ghostSocial.faviconFetch, (e, url) => {
    assertTrustedSender(e);
    return mgr.fetchFavicon(url);
  });

  handle(channels.ghostSocial.openExternal, (e, url) => {
    assertTrustedSender(e);
    mgr.externalOpen(url);
  });

  return mgr;
}

// Referenced so a future phase's partition helper import resolves through this module too.
export { accountPartition };
