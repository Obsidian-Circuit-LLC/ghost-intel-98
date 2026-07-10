import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every ipcMain.handle registration so the test can drive the real handlers
// registered by registerIpc (mirrors the makeHandle pattern used elsewhere, but against
// the monolithic register.ts). The wrapped handler has the shape (event, ...args).
const { handlers, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  showSaveDialog: vi.fn()
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ga98-docs-ipc-test', on: () => {}, whenReady: () => Promise.resolve(), quit: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: { showSaveDialog },
  BrowserWindow: class {}
}));

// ensureDocRelPath is stubbed to a recording passthrough — this test asserts the wiring
// (handler routes the renderer arg through validation into the store), not the traversal
// enforcement itself, which lives in validate.ts's own suite and store confineExisting.
vi.mock('../src/main/security/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/security/validate')>();
  return { ...actual, ensureDocRelPath: vi.fn((v: unknown) => v as string) };
});

// documents store: keep the real module but replace the two Task-1 entry points with spies
// so invoking the handlers records calls instead of touching the filesystem/decrypt path.
vi.mock('../src/main/documents/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/documents/store')>();
  return { ...actual, exportEntry: vi.fn(async () => {}) };
});

import { channels } from '../src/shared/ipc-contracts';
import { registerIpc } from '../src/main/ipc/register';
import { ensureDocRelPath } from '../src/main/security/validate';
import * as store from '../src/main/documents/store';

// Invoke a registered handler the way ipcRenderer.invoke would (event arg + renderer args).
const invoke = (channel: string, ...args: unknown[]): unknown => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler registered for ${channel}`);
  return h({}, ...args);
};

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerIpc(() => null);
});

describe('documents IPC surface', () => {
  it('declares every documents channel', () => {
    expect(channels.documents).toEqual({
      list: 'documents:list',
      mkdir: 'documents:mkdir',
      rename: 'documents:rename',
      remove: 'documents:remove',
      copy: 'documents:copy',
      move: 'documents:move',
      importDropped: 'documents:importDropped',
      reveal: 'documents:reveal',
      export: 'documents:export',
      writeText: 'documents:writeText',
      readText: 'documents:readText',
      readBytes: 'documents:readBytes'
    });
  });

  it('exposes the readBytes channel for the internal viewer', () => {
    expect(channels.documents.readBytes).toBe('documents:readBytes');
  });

  it('documents.readBytes validates relPath and returns the bytes as a Uint8Array (no number[] inflation)', async () => {
    const spy = vi
      .spyOn(store, 'readBytes')
      .mockResolvedValueOnce(new Uint8Array([104, 105]));
    const out = await invoke('documents:readBytes', 'a.txt');
    expect(ensureDocRelPath).toHaveBeenCalledWith('a.txt', 'relPath');
    expect(spy).toHaveBeenCalledWith('a.txt');
    expect(out).toEqual(new Uint8Array([104, 105]));
  });

  it('documents.export opens a save dialog and no-ops on cancel', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await invoke('documents:export', 'a.pdf');
    expect(store.exportEntry).not.toHaveBeenCalled();
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/a.pdf' });
    await invoke('documents:export', 'a.pdf');
    expect(store.exportEntry).toHaveBeenCalledWith('a.pdf', '/out/a.pdf');
  });
});
