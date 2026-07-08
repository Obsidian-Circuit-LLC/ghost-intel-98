import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Capture every ipcMain.handle registration so the test can drive the REAL handlers registered by
// registerIpc (mirrors documents-ipc-surface.test.ts). The wrapped handler has shape (event, ...args).
const { handlers, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  showSaveDialog: vi.fn()
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ga98-media-ipc-test', on: () => {}, whenReady: () => Promise.resolve(), quit: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: { showSaveDialog },
  BrowserWindow: class {}
}));

// validate stays real EXCEPT ensureIdArray, replaced with a recording passthrough so the test
// proves the reorderStations handler routes the renderer arg THROUGH validation (the finding's
// exact regression: a refactor calling mediaLib.reorderStations(args[0]) directly must fail here).
vi.mock('../src/main/security/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/security/validate')>();
  return { ...actual, ensureIdArray: vi.fn((v: unknown) => v as string[]) };
});

// media library: keep the real module but replace the two new-channel entry points with spies so
// invoking the handlers records calls instead of touching the on-disk station store.
vi.mock('../src/main/media/library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/media/library')>();
  return {
    ...actual,
    reorderStations: vi.fn(async () => ({ roots: [], tracks: [], stations: [] })),
    exportStations: vi.fn(async () => [{ label: 'A', url: 'https://a/' }])
  };
});

import { channels } from '../src/shared/ipc-contracts';
import { registerIpc } from '../src/main/ipc/register';
import { ensureIdArray } from '../src/main/security/validate';
import * as mediaLib from '../src/main/media/library';

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

describe('media IPC channels', () => {
  it('names both new channels', () => {
    expect(channels.media.reorderStations).toBe('media:reorderStations');
    expect(channels.media.exportStations).toBe('media:exportStations');
  });

  it('registers a handler for each new channel', () => {
    expect(handlers.has(channels.media.reorderStations)).toBe(true);
    expect(handlers.has(channels.media.exportStations)).toBe(true);
  });

  it('reorderStations validates the renderer id array before hitting the library', async () => {
    const snap = await invoke(channels.media.reorderStations, ['c', 'a', 'ghost']);
    // The renderer arg must pass THROUGH ensureIdArray — not reach the library raw.
    expect(ensureIdArray).toHaveBeenCalledWith(['c', 'a', 'ghost']);
    expect(mediaLib.reorderStations).toHaveBeenCalledWith(['c', 'a', 'ghost']);
    expect(snap).toEqual({ roots: [], tracks: [], stations: [] });
  });

  it('reorderStations rejects a non-array arg at the validation boundary', async () => {
    (ensureIdArray as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('expected an array of station ids');
    });
    // safeHandle wraps the thrown message as `[channel] <msg>`.
    await expect(invoke(channels.media.reorderStations, 'not-an-array')).rejects.toThrow(/array of station ids/);
    expect(mediaLib.reorderStations).not.toHaveBeenCalled();
  });

  it('exportStations no-ops (returns null) on a cancelled save dialog', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const r = await invoke(channels.media.exportStations);
    expect(mediaLib.exportStations).toHaveBeenCalled();
    expect(showSaveDialog).toHaveBeenCalled();
    expect(r).toBeNull();
  });

  it('exportStations serialises the library stations to the chosen file', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'ga98-media-export-')), 'stations.json');
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out });
    const r = await invoke(channels.media.exportStations);
    expect(r).toBe('stations.json');
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual([{ label: 'A', url: 'https://a/' }]);
  });
});
