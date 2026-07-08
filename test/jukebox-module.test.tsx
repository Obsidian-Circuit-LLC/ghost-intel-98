// @vitest-environment jsdom
/**
 * Task 11: MediaPlayerModule rebuild — rounded WMP shell + 3-state shade.
 *
 * Two layers:
 *  (1) pure invariants — default mode is `strip` and maps to the shortest shade height.
 *  (2) a jsdom render smoke — the rounded shell mounts with the Now-Playing readout and the
 *      Playlist / EQ control buttons. No @testing-library (not a dependency); drive React 18's
 *      createRoot inside act(), mirroring test/stations-drawer.test.tsx / test/jukebox-wmp-skin.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { shadeHeight } from '../src/renderer/modules/media/shade';
import { MediaPlayerModule } from '../src/renderer/modules/media/MediaPlayerModule';
import { useSettings, useWindows, type WindowSpec } from '../src/renderer/state/store';
import { defaultSettings } from '../src/shared/types';

describe('jukebox integration invariants', () => {
  it('default mode is strip and maps to the shortest height', () => {
    expect(defaultSettings.media.jukeboxMode).toBe('strip');
    expect(shadeHeight('strip')).toBeLessThan(shadeHeight('full'));
  });
});

const emptySnapshot = { roots: [], tracks: [], stations: [] };
const mediaApi = {
  getSnapshot: vi.fn().mockResolvedValue(emptySnapshot),
  addRoot: vi.fn(),
  removeRoot: vi.fn(),
  refresh: vi.fn(),
  openFiles: vi.fn(),
  loadPlaylist: vi.fn(),
  savePlaylist: vi.fn(),
  upsertStation: vi.fn(),
  deleteStation: vi.fn(),
  reorderStations: vi.fn(),
  exportStations: vi.fn()
};
const settingsApi = { update: vi.fn().mockResolvedValue(defaultSettings) };

let container: HTMLDivElement;
let root: Root;
const spec: WindowSpec = { id: 'jukebox-1', module: 'media-player', title: 'Jukebox' };

beforeEach(() => {
  mediaApi.getSnapshot.mockClear().mockResolvedValue(emptySnapshot);
  settingsApi.update.mockClear().mockResolvedValue(defaultSettings);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    media: mediaApi,
    settings: settingsApi
  };
  useWindows.setState({ windows: [{ ...spec }] });
  useSettings.setState({ settings: { ...defaultSettings } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('MediaPlayerModule rounded shell', () => {
  it('mounts the rounded shell with the Now-Playing readout and Playlist/EQ buttons', async () => {
    await act(async () => { root.render(<MediaPlayerModule spec={spec} />); });
    await flush();

    expect(container.querySelector('.ga98-jukebox-rounded')).toBeTruthy();
    expect(container.querySelector('.ga98-np-title')).toBeTruthy();
    expect(container.querySelector('[aria-label="Playlist"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="EQ"]')).toBeTruthy();
    // Five classic transport buttons still present in the deck.
    expect(container.querySelector('[aria-label="Play"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Stop"]')).toBeTruthy();
  });

  it('default strip mode sizes the window to the strip shade height; Playlist opens the deck', async () => {
    await act(async () => { root.render(<MediaPlayerModule spec={spec} />); });
    await flush();
    expect(useWindows.getState().windows.find((w) => w.id === spec.id)?.height).toBe(shadeHeight('strip'));

    const playlist = container.querySelector('[aria-label="Playlist"]') as HTMLButtonElement;
    await act(async () => { playlist.click(); });
    await flush();
    expect(useWindows.getState().windows.find((w) => w.id === spec.id)?.height).toBe(shadeHeight('deck'));
  });
});
