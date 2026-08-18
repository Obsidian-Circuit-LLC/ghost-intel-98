/**
 * WebSDR Viewer — receiver-view IPC wiring (Phase 2, R2/R4/R8).
 *
 * Wires the hardened `makeReceiverViewManager` (receiver-view.ts) to the production Electron seams
 * and registers its channels. Like `registerWebSdrIpc`, every handler calls `assertTrustedSender`
 * FIRST — the receiver overlay hosts a hostile remote SDR page, so an IPC message from a non-app
 * frame is rejected before a single argument is read (the v3.24.2 "no fail-open" invariant) — then
 * validates its argument shape before delegating to the manager.
 *
 * Production seams:
 *  - The overlay is a `WebContentsView` on the dedicated `persist:websdr` partition with the full
 *    isolation `webPreferences` (Global Constraint 2).
 *  - `getSession()` is that same partition's session; the manager hard-denies its permissions and
 *    drives its proxy for the Tor toggle.
 *  - `torSocks()` is the bg-Tor SOCKS endpoint (`getBgTor()`), returned even before Tor bootstraps
 *    so the Tor path fails CLOSED rather than leaking to clearnet.
 *  - Egress persistence reuses P1's encrypt-at-rest store via `getEgress`/`setEgress`.
 */

import { WebContentsView, session, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../capture/capture-window';
import { getBgTor } from '../bgconn/tor-singleton';
import { getEgress, setEgress } from './ipc';
import { websdrDir } from '../storage/paths';

/** v3.72.1 field diagnostic sink: append one timestamped line to `<module data>/diag.log`, self-capped
 *  at ~512 KB (rotated by truncation). Plaintext by design — it carries only overlay visibility, integer
 *  bounds, and load outcomes, never a secret — so a user can send it to diagnose a blank receiver view.
 *  Never throws (a diagnostic must never break the feature it observes). */
function appendWebSdrDiag(line: string): void {
  try {
    const dir = websdrDir();
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'diag.log');
    try { if (statSync(p).size > 512 * 1024) writeFileSync(p, ''); } catch { /* first write, no file yet */ }
    appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch { /* diagnostic only */ }
}
import {
  makeReceiverViewManager,
  type ReceiverViewDeps,
  type ReceiverViewLike,
  type ReceiverSessionLike,
  type WindowContentViewLike,
  type ReceiverBounds,
} from './receiver-view';

/** The dedicated, isolated session partition the receiver overlay always runs on. */
export const WEBSDR_PARTITION = 'persist:websdr';

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

/** Wire the production Electron seams behind the pure manager. Every electron/bgconn reference is
 *  inside a closure, so importing this module never touches electron at load and constructing the
 *  deps never creates a view/session until the manager first needs one. */
export function prodReceiverViewDeps(getWindow: () => BrowserWindow | null): ReceiverViewDeps {
  return {
    getWindow: () => {
      const win = getWindow();
      // A win98-desktop GI98 window: the overlay is a child of its single BrowserWindow's
      // contentView (there is no per-in-app-window native surface).
      return win
        ? { contentView: win.contentView as unknown as WindowContentViewLike }
        : null;
    },
    getSession: () => session.fromPartition(WEBSDR_PARTITION) as unknown as ReceiverSessionLike,
    createView: () =>
      new WebContentsView({
        webPreferences: {
          partition: WEBSDR_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          backgroundThrottling: false,
        },
      }) as unknown as ReceiverViewLike,
    torSocks: () => {
      const t = getBgTor();
      // Endpoint is offered whenever a Tor instance exists (even pre-bootstrap): a SOCKS connect
      // to a not-yet-listening port fails closed, so the toggle can never fall back to clearnet.
      return t ? `127.0.0.1:${t.socksPort()}` : null;
    },
    readEgress: () => getEgress(),
    writeEgress: (mode) => setEgress(mode),
    openExternal: (url) => {
      void shell.openExternal(url);
    },
    diag: appendWebSdrDiag,
  };
}

/** True iff `b` is a plausible bounds object (each field a finite number). The manager re-sanitizes,
 *  but rejecting a non-object here keeps a garbage payload from reaching it. */
function asBounds(v: unknown): ReceiverBounds | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { x: n(o.x), y: n(o.y), width: n(o.width), height: n(o.height) };
}

/**
 * Register the Phase-2 receiver-view channels. `getWindow` yields the app's desktop window (the
 * overlay parent). A fresh manager is built per registration — production calls this exactly once.
 */
export function registerWebSdrReceiverIpc(deps: {
  handle: HandleWithEvent;
  getWindow: () => BrowserWindow | null;
}): void {
  const { handle, getWindow } = deps;
  const mgr = makeReceiverViewManager(prodReceiverViewDeps(getWindow));

  handle(channels.websdr.receiverLoad, (e, url) => {
    assertTrustedSender(e);
    if (typeof url !== 'string' || !url) {
      throw new Error('Loading a receiver requires a url string.');
    }
    return mgr.load(url);
  });

  handle(channels.websdr.receiverHide, (e) => {
    assertTrustedSender(e);
    mgr.hide();
  });

  handle(channels.websdr.receiverPresent, (e, input) => {
    assertTrustedSender(e);
    if (!input || typeof input !== 'object') {
      throw new Error('Presenting the receiver requires a { visible, bounds } object.');
    }
    const o = input as Record<string, unknown>;
    mgr.present({
      visible: o.visible === true,
      bounds: asBounds(o.bounds),
      diag: typeof o.diag === 'string' ? o.diag.slice(0, 40) : undefined,
    });
  });

  handle(channels.websdr.receiverModal, (e, open) => {
    assertTrustedSender(e);
    mgr.setModal(open === true);
  });

  handle(channels.websdr.receiverStatus, (e, url) => {
    assertTrustedSender(e);
    if (typeof url !== 'string' || !url) {
      throw new Error('A status check requires a url string.');
    }
    return mgr.status(url);
  });

  handle(channels.websdr.receiverMute, (e, muted) => {
    assertTrustedSender(e);
    mgr.setMuted(muted === true);
  });

  handle(channels.websdr.receiverExternalOpen, (e, url) => {
    assertTrustedSender(e);
    if (typeof url !== 'string' || !url) {
      throw new Error('Opening a receiver externally requires a url string.');
    }
    mgr.externalOpen(url);
  });

  handle(channels.websdr.receiverEgressApply, (e, mode) => {
    assertTrustedSender(e);
    return mgr.applyEgress(mode);
  });

  // ---- Phase 3: control-bar injection (confined to the receiver view) ----
  handle(channels.websdr.receiverTune, (e, hz) => {
    assertTrustedSender(e);
    if (typeof hz !== 'number' || !Number.isFinite(hz)) {
      throw new Error('Tuning requires a finite frequency in hertz.');
    }
    return mgr.tune(hz);
  });

  handle(channels.websdr.receiverMode, (e, mode) => {
    assertTrustedSender(e);
    if (typeof mode !== 'string' || !mode) {
      throw new Error('Setting the mode requires a mode string.');
    }
    return mgr.setMode(mode.slice(0, 32));
  });

  handle(channels.websdr.receiverVolume, (e, v) => {
    assertTrustedSender(e);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('Setting the volume requires a finite number 0..1.');
    }
    return mgr.setVolume(v);
  });

  // ---- Phase 3: recording capture handshake (his getMediaSourceId) ----
  handle(channels.websdr.receiverCaptureSource, (e) => {
    assertTrustedSender(e);
    // getMediaSourceId(sender) grants the requesting renderer capture of THIS receiver view only.
    return mgr.captureSourceId(e.sender);
  });
}
