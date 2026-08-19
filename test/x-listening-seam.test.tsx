// @vitest-environment jsdom
/**
 * X Listening Station renderer↔main SEAM suite.
 *
 * The v3.24.2 collect-path failure class: the renderer and the main handler each
 * pass their own unit tests, yet the renderer omits a field the handler needs, so
 * the wired feature is dead. This suite used to pin the seam for the clearnet-only
 * X1-X8 surface (connect/capture/captureThreadComments/runArchiveCycle(s)/
 * captureFollowers/captureFollowing/exportItems/exportNetwork/readNotes) in three
 * parts (A: preload forwards every required field, B: the handler rejects a payload
 * missing one, C: end-to-end via the module) — that surface was retired wholesale at
 * Task 16 (see `test/x-listening-whole-module-seam.test.ts`'s standing invariant).
 *
 * What survives is part C's Phase-1 equivalent: rendering `XListeningModule` and
 * clicking "Open Session" flows renderer → preload → the REAL `openSession` handler
 * (`registerXListeningIpc` → session.ts's `connectXSession` → `createCaptureWindow`),
 * over Tor. The per-channel payload-shape coverage for the surviving Phase-1/2 surface
 * lives in `test/x-listening-ipc-seam.test.ts` (Task 6) instead.
 *
 * electron is mocked (contextBridge/ipcRenderer/webUtils for the preload, `session`
 * for session.ts); the shared capture-window harness is mocked so `openSession` sets a
 * live window stub without a real BrowserWindow. `assertTrustedSender` is a no-op here —
 * the sender-rejection guarantee is pinned in x-listening-security.test.ts; this
 * file is about payload shape, not origin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ---- recorder + fake bridge -------------------------------------------

const rec = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  calls: [] as Array<{ channel: string; args: unknown[] }>,
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => unknown>(),
  event: { senderFrame: { url: 'file:///app/index.html' } } as unknown,
  createCaptureWindowCalls: 0,
  listeners: new Map<string, (...a: unknown[]) => void>(),
}));

vi.mock('electron', () => ({
  // A real userData path so the derived-read insights handlers (changeEvents / runLog /
  // networkEvents → prodXStore) resolve to [] via ENOENT instead of throwing on a missing `app`
  // (an incomplete mock left sibling Promise.all rejections unhandled past teardown).
  app: { getPath: () => require('node:os').tmpdir() },
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      rec.exposed[key] = value;
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      rec.calls.push({ channel, args });
      const fn = rec.handlers.get(channel);
      if (fn) return Promise.resolve(fn(rec.event, ...args));
      return Promise.resolve(undefined);
    },
    // v3.72.5: the module subscribes to the main→renderer sweep-progress push, so the seam's
    // ipcRenderer needs the event surface too — an invoke-only mock made the real preload throw.
    on: (channel: string, listener: (...a: unknown[]) => void) => {
      rec.listeners.set(channel, listener);
    },
    removeListener: (channel: string) => {
      rec.listeners.delete(channel);
    },
  },
  webUtils: { getPathForFile: () => '' },
  // ipc.ts imports `session` at module load (never called on the seam paths tested).
  session: { fromPartition: () => ({ cookies: { get: async () => [] as unknown[] } }) },
}));

// The shared harness: `openSession` opens a hardened window. Stub it so
// session.ts's connectXSession sets a live window without a real BrowserWindow,
// and record the open.
vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async () => {
    rec.createCaptureWindowCalls += 1;
    return { show: vi.fn(), focus: vi.fn(), isDestroyed: () => false, webContents: { setWebRTCIPHandlingPolicy: vi.fn() } };
  }),
  runCapture: vi.fn(async () => []),
  assertTrustedSender: vi.fn(), // no-op; origin rejection is covered in the security suite
}));

// Leak fix: the legacy connect path is now Tor-gated. Mock the bg Tor engine bootstrapped so the
// connect handler opens the window over Tor (fail-closed behaviour is proven in x-listening-tor).
vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: () => ({ isBootstrapped: () => true, socksPort: () => 19050 })
}));

// The connect handler reads the clearnet setting via loadClearnetEnabled (a dynamic import of
// json-fs + a secure-fs settings read). Stub the store so that resolves immediately/deterministically
// to Tor mode (clearnet:false) — without a real userData path the timing is otherwise flaky.
vi.mock('../src/main/storage/json-fs', () => ({
  settingsStore: { read: vi.fn(async () => ({ xListening: { clearnet: false } })) }
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerXListeningIpc } from '../src/main/x-listening/ipc';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
// Importing the preload for its side effect: it calls exposeInMainWorld('api', api),
// which our contextBridge mock records into rec.exposed.
import '../src/preload/index';

/** The real preload renderer surface (as the renderer would see `window.api`). */
function api(): any {
  return (rec.exposed.api as any);
}

beforeEach(() => {
  rec.calls = [];
  rec.handlers.clear();
  rec.createCaptureWindowCalls = 0;
});

// ---- C. end-to-end: the module drives the real openSession handler ----
//
// The Task-13 shell no longer has a bare "Connect" button — connecting is per-CAMPAIGN
// (`openSession(campaignId)`, the Phase-1 Tor-default surface), not the retiring clearnet-only
// `connect()`/`status()` pair section A/B above still pin. This proves the shell's Open Session
// button flows through the REAL `openSession` handler end-to-end (renderer → preload →
// registerXListeningIpc → session.ts's `connectXSession` → createCaptureWindow), over Tor.

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

describe('seam C — XListeningModule → preload → openSession handler', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    registerXListeningIpc({ handle: (ch, fn) => rec.handlers.set(ch, fn as never) });
    (globalThis as any).window.api = api();
  });

  it('renders and opens a hardened session for a self-managed campaign — no core case bound', async () => {
    // campaignsList/campaignsSwitch route through the real campaigns.ts → scraping-cases store;
    // stub just that one seam so this stays a controlled, fs-free unit test while everything
    // else (openSession → connectXSession → createCaptureWindow) runs for real.
    const campaign = { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Seam campaign', createdAt: 1, updatedAt: 1 };
    (rec.exposed.api as any).xListening.campaignsList = async () => [campaign];
    (rec.exposed.api as any).xListening.campaignsSwitch = async () => campaign;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => { root.render(<XListeningModule />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // No caseId prop — proves the module works with NO core investigation case bound.
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /open session/i.test(b.textContent || ''));
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { (btn as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(rec.calls.some((c) => c.channel === channels.xListening.openSession)).toBe(true);
    expect(rec.createCaptureWindowCalls).toBeGreaterThan(0);

    act(() => root.unmount());
    container.remove();
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
  });
});
