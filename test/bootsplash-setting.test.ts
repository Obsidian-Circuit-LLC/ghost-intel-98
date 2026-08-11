// Task 17 — `AppSettings.bootSplashImage` (default null) + `settings:pickBootSplash` IPC,
// cloned from `settings:pickWallpaper` (register.ts:590) via a shared `pickImageDataUri`
// helper. Two things this test proves, per the plan:
//   1. bootSplashImage survives a settings upgrade — an old on-disk settings.json (predating
//      the field) heals to the default (null) through settingsStore.read()'s mergeSettings
//      base-spread, with no extra merge-list work needed (it's a top-level scalar).
//   2. pickBootSplash caps the picked file at 8 MB and rejects a non-image extension, exactly
//      like pickWallpaper — proven by driving the REAL registered IPC handler (registerIpc)
//      against a mocked dialog.showOpenDialog + real temp files on disk (mirrors
//      documents-ipc-surface.test.ts's pattern).

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = '/tmp/ga98-bootsplash-setting-test';
const PICK_TMP = '/tmp/ga98-bootsplash-pick-test';

const { handlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  showOpenDialog: vi.fn()
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ga98-bootsplash-setting-test', on: () => {}, whenReady: () => Promise.resolve(), quit: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: { showOpenDialog, showSaveDialog: vi.fn() },
  BrowserWindow: class {}
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerIpc } from '../src/main/ipc/register';
import { settingsStore } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

const invoke = (channel: string, ...args: unknown[]): unknown => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler registered for ${channel}`);
  return h({}, ...args);
};

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  rmSync(join(TMP, 'GhostAccess98'), { recursive: true, force: true });
  rmSync(PICK_TMP, { recursive: true, force: true });
  mkdirSync(PICK_TMP, { recursive: true });
  registerIpc(() => null);
});

afterAll(() => {
  rmSync(join(TMP, 'GhostAccess98'), { recursive: true, force: true });
  rmSync(PICK_TMP, { recursive: true, force: true });
});

describe('AppSettings.bootSplashImage — default + upgrade healing', () => {
  it('defaults to null', () => {
    expect(defaultSettings.bootSplashImage).toBeNull();
  });

  it('an old on-disk settings.json predating the field heals bootSplashImage to null on read()', async () => {
    const dataRoot = join(TMP, 'GhostAccess98');
    mkdirSync(dataRoot, { recursive: true });
    // Frozen pre-Task-17 shape: no bootSplashImage key at all.
    writeFileSync(join(dataRoot, 'settings.json'), JSON.stringify({ wallpaperColor: '#123456', soundEnabled: false }), 'utf8');

    const s = await settingsStore.read();

    expect(s.bootSplashImage).toBeNull();       // healed to default
    expect(s.wallpaperColor).toBe('#123456');    // pre-existing user value kept
    expect(s.soundEnabled).toBe(false);          // pre-existing user value kept
  });

  it('a stored non-null bootSplashImage survives the merge (not clobbered by the default)', async () => {
    const dataRoot = join(TMP, 'GhostAccess98');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(dataRoot, 'settings.json'), JSON.stringify({ bootSplashImage: 'data:image/png;base64,AAAA' }), 'utf8');

    const s = await settingsStore.read();

    expect(s.bootSplashImage).toBe('data:image/png;base64,AAAA');
  });
});

describe('settings:pickBootSplash IPC — cloned pickWallpaper body via pickImageDataUri', () => {
  it('is registered under the literal channel constant', () => {
    expect(channels.settings.pickBootSplash).toBe('settings:pickBootSplash');
    expect(handlers.has('settings:pickBootSplash')).toBe(true);
  });

  it('cancel (no filePaths) returns null without reading anything', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const out = await invoke('settings:pickBootSplash');
    expect(out).toBeNull();
  });

  it('rejects a non-image extension', async () => {
    const p = join(PICK_TMP, 'not-an-image.txt');
    writeFileSync(p, 'hello');
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [p] });
    await expect(invoke('settings:pickBootSplash')).rejects.toThrow(/Unsupported image type/);
  });

  it('rejects a PNG over the 8 MB cap', async () => {
    const p = join(PICK_TMP, 'big.png');
    writeFileSync(p, Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [p] });
    await expect(invoke('settings:pickBootSplash')).rejects.toThrow(/8 MB/);
  });

  it('accepts a small PNG and returns a data: URI', async () => {
    const p = join(PICK_TMP, 'small.png');
    const bytes = Buffer.from([1, 2, 3, 4]);
    writeFileSync(p, bytes);
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [p] });
    const out = await invoke('settings:pickBootSplash');
    expect(out).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });
});
