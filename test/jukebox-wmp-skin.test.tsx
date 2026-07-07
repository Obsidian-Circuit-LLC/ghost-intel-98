// @vitest-environment jsdom
/**
 * Task 9: Jukebox WMP re-skin. jsdom smoke test — no @testing-library (not a dependency);
 * drive React 18's createRoot inside act(), mirroring briefcase-dnd.test.tsx /
 * access-menu-osint-flyout.test.tsx.
 *
 * Verifies the collapsed (compact) deck renders the five classic WMP transport buttons
 * (rewind/play/pause/stop/fast-forward), the GI98 logo image, and that the caret button still
 * toggles `collapsed` (which drives the window-resize effect via useWindows.update).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaPlayerModule } from '../src/renderer/modules/media/MediaPlayerModule';
import { useSettings, useWindows, type WindowSpec } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

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
  deleteStation: vi.fn()
};

const settingsApi = {
  update: vi.fn().mockResolvedValue(defaultSettings)
};

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

describe('Jukebox WMP-style compact deck', () => {
  it('renders the five classic transport buttons + the GI98 logo', async () => {
    await act(async () => { root.render(<MediaPlayerModule spec={spec} />); });
    await flush();

    expect(container.querySelector('.ga98-wmp-screen')).toBeTruthy();
    expect(container.querySelector('.ga98-wmp-transport')).toBeTruthy();
    expect(container.querySelector('[aria-label="Rewind 10s"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Play"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pause"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Stop"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Fast-forward 10s"]')).toBeTruthy();

    const logo = container.querySelector('.ga98-wmp-logo');
    expect(logo).toBeTruthy();
    expect(logo?.tagName).toBe('IMG');
  });

  it('the caret button still toggles collapsed (drives the window-resize effect)', async () => {
    await act(async () => { root.render(<MediaPlayerModule spec={spec} />); });
    await flush();

    const caret = container.querySelector('[aria-label="Expand"]') as HTMLButtonElement;
    expect(caret).toBeTruthy();
    await act(async () => { caret.click(); });
    await flush();

    expect(container.querySelector('[aria-label="Collapse"]')).toBeTruthy();
    const win = useWindows.getState().windows.find((w) => w.id === spec.id);
    expect(win?.height).toBe(840);
  });
});
