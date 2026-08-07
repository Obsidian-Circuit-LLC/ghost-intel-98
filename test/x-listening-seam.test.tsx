// @vitest-environment jsdom
/**
 * V1 — X Listening Station renderer↔main SEAM suite.
 *
 * The v3.24.2 collect-path failure class: the renderer and the main handler each
 * pass their own unit tests, yet the renderer omits a field the handler needs, so
 * the wired feature is dead. This suite pins the seam directly — it proves the
 * preload payload the RENDERER actually sends carries every field the REAL ipc.ts
 * handler requires, for each xListening channel.
 *
 * It does that in three complementary parts, all against the genuine surfaces:
 *  A. The real preload `api.xListening` (captured from the actual
 *     `contextBridge.exposeInMainWorld` call) forwards a full payload — every
 *     required field is present in the object/positional args it hands to invoke.
 *  B. The real `registerXListeningIpc` handlers REJECT a payload missing any
 *     required field — establishing exactly which fields are load-bearing. A is
 *     then proven to include all of them.
 *  C. End-to-end: rendering `XListeningModule` and clicking Connect flows
 *     renderer → preload → the real connect handler (`connectXSession`).
 *
 * electron is mocked (contextBridge/ipcRenderer/webUtils for the preload, `session`
 * for ipc.ts); the shared capture-window harness is mocked so `connect` sets a live
 * window stub without a real BrowserWindow. `assertTrustedSender` is a no-op here —
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
}));

vi.mock('electron', () => ({
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
  },
  webUtils: { getPathForFile: () => '' },
  // ipc.ts imports `session` at module load (never called on the seam paths tested).
  session: { fromPartition: () => ({ cookies: { get: async () => [] as unknown[] } }) },
}));

// The shared harness: `connect` opens a hardened window. Stub it so connectXSession
// sets a live window without a real BrowserWindow, and record the open.
vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async () => {
    rec.createCaptureWindowCalls += 1;
    return { show: vi.fn(), focus: vi.fn(), isDestroyed: () => false };
  }),
  runCapture: vi.fn(async () => []),
  assertTrustedSender: vi.fn(), // no-op; origin rejection is covered in the security suite
}));

import { channels } from '../src/shared/ipc-contracts';
import {
  registerXListeningIpc,
  connectXSession,
  __resetXWindowForTests,
} from '../src/main/x-listening/ipc';
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
  __resetXWindowForTests();
});

// ---- A. the renderer forwards every required field --------------------

describe('seam A — the preload forwards the full payload the handler needs', () => {
  it('exposes the real xListening surface', () => {
    expect(typeof api().xListening.connect).toBe('function');
    expect(typeof api().xListening.capture).toBe('function');
  });

  it('capture() sends { caseId, channelId } (+ optional jobId/channelLabel)', async () => {
    await api().xListening.capture({ caseId: 'c1', jobId: 'j1', channelId: 'target', channelLabel: '@target' });
    const call = rec.calls.find((c) => c.channel === channels.xListening.capture)!;
    expect(call).toBeTruthy();
    const payload = call.args[0] as Record<string, unknown>;
    expect(payload.caseId).toBe('c1');
    expect(payload.channelId).toBe('target'); // the field the v3.24.2-class bug would drop
  });

  it('captureThreadComments() sends { caseId, channelId, rootPostId, rootPostUrl }', async () => {
    await api().xListening.captureThreadComments({
      caseId: 'c1',
      channelId: 'target',
      rootPostId: '123',
      rootPostUrl: 'https://x.com/target/status/123',
    });
    const payload = rec.calls.find((c) => c.channel === channels.xListening.captureThreadComments)!
      .args[0] as Record<string, unknown>;
    expect(payload.caseId).toBe('c1');
    expect(payload.channelId).toBe('target');
    expect(payload.rootPostId).toBe('123');
    expect(payload.rootPostUrl).toBe('https://x.com/target/status/123');
  });

  it('runArchiveCycle()/runArchiveCycles() send { caseId, channelId } (+ maxCycles)', async () => {
    await api().xListening.runArchiveCycle({ caseId: 'c1', channelId: 'target' });
    await api().xListening.runArchiveCycles({ caseId: 'c1', channelId: 'target', maxCycles: 3 });
    const one = rec.calls.find((c) => c.channel === channels.xListening.runArchiveCycle)!
      .args[0] as Record<string, unknown>;
    expect(one.caseId).toBe('c1');
    expect(one.channelId).toBe('target');
    const many = rec.calls.find((c) => c.channel === channels.xListening.runArchiveCycles)!
      .args[0] as Record<string, unknown>;
    expect(many.caseId).toBe('c1');
    expect(many.channelId).toBe('target');
    expect(many.maxCycles).toBe(3);
  });

  it('saveNote() sends { caseId, findingId, text }', async () => {
    await api().xListening.saveNote({ caseId: 'c1', findingId: 'f1', text: 'note' });
    const call = rec.calls.find((c) => c.channel === channels.xListening.saveNote)!;
    const payload = call.args[0] as Record<string, unknown>;
    expect(payload.caseId).toBe('c1');
    expect(payload.findingId).toBe('f1');
    expect(payload.text).toBe('note');
  });

  it('captureFollowers()/captureFollowing() send { caseId, target }', async () => {
    await api().xListening.captureFollowers({ caseId: 'c1', jobId: 'j1', target: 'target' });
    await api().xListening.captureFollowing({ caseId: 'c1', jobId: 'j1', target: 'target' });
    for (const ch of [channels.xListening.captureFollowers, channels.xListening.captureFollowing]) {
      const payload = rec.calls.find((c) => c.channel === ch)!.args[0] as Record<string, unknown>;
      expect(payload.caseId).toBe('c1');
      expect(payload.target).toBe('target');
    }
  });

  it('exportItems() sends { caseId, format }', async () => {
    await api().xListening.exportItems({ caseId: 'c1', format: 'json' });
    const payload = rec.calls.find((c) => c.channel === channels.xListening.exportItems)!.args[0] as Record<string, unknown>;
    expect(payload.caseId).toBe('c1');
    expect(payload.format).toBe('json');
  });

  it('readNotes()/exportNetwork() send the caseId as a positional string', async () => {
    await api().xListening.readNotes('c1');
    await api().xListening.exportNetwork('c1');
    expect(rec.calls.find((c) => c.channel === channels.xListening.readNotes)!.args[0]).toBe('c1');
    expect(rec.calls.find((c) => c.channel === channels.xListening.exportNetwork)!.args[0]).toBe('c1');
  });

  it('connect()/status() take no arguments', async () => {
    await api().xListening.connect();
    await api().xListening.status();
    expect(rec.calls.find((c) => c.channel === channels.xListening.connect)!.args).toEqual([]);
    expect(rec.calls.find((c) => c.channel === channels.xListening.status)!.args).toEqual([]);
  });
});

// ---- B. the handler requires exactly those fields ---------------------

describe('seam B — the real handler rejects a payload missing a required field', () => {
  function register(): Map<string, (e: unknown, ...a: unknown[]) => unknown> {
    registerXListeningIpc({ handle: (ch, fn) => rec.handlers.set(ch, fn as never) });
    return rec.handlers;
  }
  const ev = rec.event;
  /** Normalize sync-throw and async-reject handlers into a single rejected promise. */
  const call = (ch: string, ...a: unknown[]) =>
    Promise.resolve().then(() => rec.handlers.get(ch)!(ev, ...a));

  it('capture requires BOTH caseId and channelId', async () => {
    register();
    await connectXSession(); // set the live window so validation (not the connectivity gate) is reached
    await expect(call(channels.xListening.capture, { caseId: 'c1' })).rejects.toThrow(/Capture requires a caseId and a target channelId/);
    await expect(call(channels.xListening.capture, { channelId: 'target' })).rejects.toThrow(/Capture requires a caseId and a target channelId/);
  });

  it('captureThreadComments requires caseId, channelId, rootPostId AND rootPostUrl', async () => {
    register();
    await connectXSession();
    await expect(
      call(channels.xListening.captureThreadComments, { caseId: 'c1', channelId: 'target', rootPostId: '123' })
    ).rejects.toThrow(/requires a caseId, channelId, rootPostId and rootPostUrl/);
    await expect(
      call(channels.xListening.captureThreadComments, { channelId: 'target', rootPostId: '123', rootPostUrl: 'https://x.com/t/status/1' })
    ).rejects.toThrow(/requires a caseId, channelId, rootPostId and rootPostUrl/);
  });

  it('runArchiveCycle / runArchiveCycles require a caseId and a target channelId', async () => {
    register();
    await connectXSession();
    await expect(call(channels.xListening.runArchiveCycle, { caseId: 'c1' })).rejects.toThrow(/archive cycle requires a caseId and a target channelId/);
    await expect(call(channels.xListening.runArchiveCycle, { channelId: 'target' })).rejects.toThrow(/archive cycle requires a caseId and a target channelId/);
    await expect(call(channels.xListening.runArchiveCycles, { caseId: 'c1' })).rejects.toThrow(/archive run requires a caseId and a target channelId/);
  });

  it('saveNote requires caseId, findingId AND text', async () => {
    register();
    await expect(call(channels.xListening.saveNote, { caseId: 'c1', findingId: 'f1' })).rejects.toThrow(/requires a caseId, findingId and text/);
    await expect(call(channels.xListening.saveNote, { caseId: 'c1', text: 't' })).rejects.toThrow(/requires a caseId, findingId and text/);
    await expect(call(channels.xListening.saveNote, { findingId: 'f1', text: 't' })).rejects.toThrow(/requires a caseId, findingId and text/);
  });

  it('captureFollowers requires a caseId and a target handle', async () => {
    register();
    await connectXSession();
    await expect(call(channels.xListening.captureFollowers, { caseId: 'c1' })).rejects.toThrow(/network capture requires a caseId and a target handle/);
  });

  it('exportItems requires a caseId AND a valid format', async () => {
    register();
    await expect(call(channels.xListening.exportItems, { format: 'json' })).rejects.toThrow(/Export requires a caseId/);
    await expect(call(channels.xListening.exportItems, { caseId: 'c1' })).rejects.toThrow(/Export requires a format/);
    await expect(call(channels.xListening.exportItems, { caseId: 'c1', format: 'exe' })).rejects.toThrow(/Export requires a format/);
  });

  it('readNotes requires a non-empty caseId string', async () => {
    register();
    await expect(call(channels.xListening.readNotes, '')).rejects.toThrow(/Reading notes requires a caseId/);
    await expect(call(channels.xListening.readNotes, 123)).rejects.toThrow(/Reading notes requires a caseId/);
  });
});

// ---- C. end-to-end: the module drives the real connect handler --------

describe('seam C — XListeningModule → preload → connect handler', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    registerXListeningIpc({ handle: (ch, fn) => rec.handlers.set(ch, fn as never) });
    (globalThis as any).window.api = api();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
  });

  it('clicking Connect flows through to the real connectXSession (opens a hardened window)', async () => {
    await act(async () => { root.render(<XListeningModule />); });

    const btn = Array.from(container.querySelectorAll('button')).find((b) => /connect/i.test(b.textContent || ''));
    expect(btn).toBeTruthy();

    await act(async () => { (btn as HTMLButtonElement).click(); });

    // renderer → preload capture() forwarded to the connect channel → connectXSession → createCaptureWindow
    expect(rec.calls.some((c) => c.channel === channels.xListening.connect)).toBe(true);
    expect(rec.createCaptureWindowCalls).toBeGreaterThan(0);
  });
});
