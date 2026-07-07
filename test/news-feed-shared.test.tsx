// @vitest-environment jsdom
/**
 * Task 7: News module mirrors GeoINT Live News.
 *
 * NewsFeedControls (geoint/NewsFeedControls.tsx) is the shared Stream dropdown + Label/kind/m3u8
 * add-form extracted out of LiveNewsPanel, backed by settings.geoint.newsStreams/newsStreamIndex.
 * Both the GeoINT panel and the News module (NewsViewModule) render it, so a feed added on either
 * surface is immediately selectable on the other — one settings-backed list.
 *
 * Two properties matter here:
 *  - addStream/removeStream must re-send the FULL geoint block on every patch() call (the renderer
 *    store shallow-replaces the whole `geoint` object on write, so a partial write would silently
 *    drop the other geoint fields — tileServerUrl/basemap/etc).
 *  - NewsViewModule must reflect the store's active stream (not a hardcoded Bloomberg default),
 *    falling back to DEFAULT_NEWS_STREAM only when the store has no streams at all.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), against a
 * jsdom container, mirroring ai-search-engine-picker.test.tsx / hostinfo-states.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewsFeedControls } from '../src/renderer/modules/geoint/NewsFeedControls';
import { NewsViewModule } from '../src/renderer/modules/geoint/NewsViewModule';
import { DEFAULT_NEWS_STREAM } from '../src/renderer/modules/geoint/NewsStreamView';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

let container: HTMLDivElement;
let root: Root;
let settingsUpdate: ReturnType<typeof vi.fn>;

function installApi(): void {
  // settings.update backs the store's patch(): return the merged settings the way main would.
  settingsUpdate = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
    const cur = useSettings.getState().settings!;
    return { ...cur, ...patch, geoint: { ...cur.geoint, ...(patch.geoint as object) } };
  });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    settings: { update: settingsUpdate }
  };
}

/** Set a React-controlled <input>'s value the way a real keystroke would (native setter + input event). */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('NewsFeedControls — shared add-feed form', () => {
  it('adding a stream patches the full geoint block, not just newsStreams', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: { ...defaultSettings.geoint, newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }], newsStreamIndex: 0 }
      }
    });
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    const labelInput = container.querySelector('input.ga98-text[placeholder="Label"]') as HTMLInputElement;
    const urlInput = container.querySelector('input.ga98-text:not([placeholder="Label"])') as HTMLInputElement;
    const addButton = Array.from(container.querySelectorAll('button')).find((b) => /Add stream/i.test(b.textContent ?? '')) as HTMLButtonElement;

    await act(async () => {
      typeInto(labelInput, 'Al Jazeera English');
      typeInto(urlInput, 'https://example.com/live/aje.m3u8');
    });
    await flush();
    await act(async () => { addButton.click(); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    const payload = settingsUpdate.mock.calls[0][0] as { geoint: Record<string, unknown> };
    expect(payload.geoint).toBeTruthy();
    // The new stream is present.
    expect(payload.geoint.newsStreams).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Al Jazeera English', kind: 'hls' })])
    );
    // AND the rest of the geoint block was re-sent (not dropped by a partial write).
    expect(payload.geoint).toHaveProperty('networkEnabled');
    expect(payload.geoint).toHaveProperty('basemap', defaultSettings.geoint.basemap);
  });

  it('removeStream clamps newsStreamIndex to a valid range after removing the active (last) stream', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: {
          ...defaultSettings.geoint,
          newsStreams: [
            { label: 'Bloomberg TV', url: 'https://a.example.com/a.m3u8', kind: 'hls' },
            { label: 'Sky News', url: 'https://b.example.com/b.m3u8', kind: 'hls' },
            { label: 'Al Jazeera', url: 'https://c.example.com/c.m3u8', kind: 'hls' }
          ],
          newsStreamIndex: 2
        }
      }
    });
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    const removeButton = Array.from(container.querySelectorAll('button')).find((b) => b.title === 'Remove this stream') as HTMLButtonElement;
    await act(async () => { removeButton.click(); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    const payload = settingsUpdate.mock.calls[0][0] as { geoint: { newsStreams: unknown[]; newsStreamIndex: number } };
    expect(payload.geoint.newsStreams).toHaveLength(2);
    // Without clamping this would be 2 (out of range for a 2-entry array); clamped to the last valid index.
    expect(payload.geoint.newsStreamIndex).toBe(1);
  });
});

describe('NewsViewModule — mirrors the store-selected active stream', () => {
  it('renders the store-selected stream label, not the hardcoded Bloomberg default', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: {
          ...defaultSettings.geoint,
          newsStreams: [{ label: 'Al Jazeera English', url: 'https://www.youtube.com/watch?v=gCNeDWCI0vo', kind: 'youtube' }],
          newsStreamIndex: 0
        }
      }
    });
    await act(async () => { root.render(<NewsViewModule />); });
    await flush();

    expect(container.textContent ?? '').toContain('Al Jazeera English');
    expect(container.textContent ?? '').not.toContain(DEFAULT_NEWS_STREAM.label);
  });

  it('falls back to the Bloomberg default when the store has no streams', async () => {
    useSettings.setState({
      settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, newsStreams: [], newsStreamIndex: 0 } }
    });
    await act(async () => { root.render(<NewsViewModule />); });
    await flush();

    expect(container.textContent ?? '').toContain(DEFAULT_NEWS_STREAM.label);
  });
});
