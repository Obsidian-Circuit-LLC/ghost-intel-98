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
 *  - addStream/removeStream must patch ONLY newsStreams/newsStreamIndex (main deep-merges the
 *    geoint sub-object — json-fs.ts mergeSettings — so a partial write is safe and cannot drop
 *    sibling fields; re-sending the whole reconstructed block from this renderer's own cache could
 *    instead clobber a sibling a different window had just changed — Task 3, v3.35.0).
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
import { newsWindowSpec } from '../src/renderer/modules/geoint/newsWindow';
import { useSettings, useWindows } from '../src/renderer/state/store';
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
  it('adding a stream patches ONLY newsStreams/newsStreamIndex', async () => {
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: { ...defaultSettings.geoint, newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }], newsStreamIndex: 0 }
      }
    });
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    // Add stream now opens the AddStreamDialog modal rather than exposing an inline form.
    const openAddButton = Array.from(container.querySelectorAll('button')).find((b) => /Add stream/i.test(b.textContent ?? '')) as HTMLButtonElement;
    await act(async () => { openAddButton.click(); });
    await flush();

    const labelInput = container.querySelector('input.ga98-text[placeholder="Label"]') as HTMLInputElement;
    const urlInput = container.querySelector('input.ga98-text[aria-label="Stream URL"]') as HTMLInputElement;
    const okButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'OK') as HTMLButtonElement;

    await act(async () => {
      typeInto(labelInput, 'Al Jazeera English');
      typeInto(urlInput, 'https://example.com/live/aje.m3u8');
    });
    await flush();
    await act(async () => { okButton.click(); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    const payload = settingsUpdate.mock.calls[0][0] as { geoint: Record<string, unknown> };
    expect(payload.geoint).toBeTruthy();
    // The new stream is present.
    expect(payload.geoint.newsStreams).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Al Jazeera English', kind: 'hls' })])
    );
    // AND the rest of the geoint block was NOT re-sent (a partial write can't clobber siblings).
    expect(payload.geoint).not.toHaveProperty('networkEnabled');
    expect(payload.geoint).not.toHaveProperty('basemap');
  });

  it('renders the pop-out (⧉) button that opens the active feed in its own window', async () => {
    // Regression (v3.42.0): eefc518 (the v3.38.0 Add-stream-modal batch) removed the feed-level
    // pop-out button along with the intended per-row pop-out. Because NewsFeedControls is shared by
    // both the GeoINT LiveNewsPanel and the standalone OSINT News module (NewsViewModule), restoring
    // it here brings it back on BOTH surfaces at once.
    const bloomberg = { label: 'Bloomberg TV', url: 'https://a.example.com/a.m3u8', kind: 'hls' as const };
    useSettings.setState({
      settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, newsStreams: [bloomberg], newsStreamIndex: 0 } }
    });
    const openSpy = vi.spyOn(useWindows.getState(), 'open').mockImplementation(() => {});
    await act(async () => { root.render(<NewsFeedControls />); });
    await flush();

    const popBtn = Array.from(container.querySelectorAll('button')).find((b) => b.title === 'Pop out to its own window') as HTMLButtonElement;
    expect(popBtn).toBeTruthy();
    await act(async () => { popBtn.click(); });
    expect(openSpy).toHaveBeenCalledWith(newsWindowSpec(bloomberg));
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

  it('a pop-out window (mounted with a fixed snapshot `stream` prop) still follows the store when the operator picks a different feed from its OWN dropdown', async () => {
    const bloomberg = { label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' as const };
    const skyNews = { label: 'Sky News', url: 'https://b.example.com/b.m3u8', kind: 'hls' as const };
    useSettings.setState({
      settings: {
        ...defaultSettings,
        geoint: { ...defaultSettings.geoint, newsStreams: [bloomberg, skyNews], newsStreamIndex: 0 }
      }
    });
    // Mirrors the real pop-out: NewsViewAdapter hands NewsViewModule the stream that was active
    // at the moment of popping (a fixed snapshot prop) — here, Bloomberg (index 0).
    await act(async () => { root.render(<NewsViewModule stream={bloomberg} />); });
    await flush();

    // The header (`.ga98-panel`) is the module's OWN label, distinct from the dropdown's <option>
    // text (which always lists every feed regardless of selection) — assert on it specifically.
    const header = () => container.querySelector('.ga98-panel')?.textContent ?? '';
    expect(header()).toContain('Bloomberg TV');

    // Now pick a different entry from the pop-out's OWN Stream dropdown (NewsFeedControls is
    // rendered inside NewsViewModule) — this writes newsStreamIndex: 1 to the shared store.
    const select = container.querySelector('select.ga98-select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, '1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    // The store now reflects the new selection...
    expect(useSettings.getState().settings?.geoint.newsStreamIndex).toBe(1);
    // ...and the SAME window's header must follow it, not stay pinned to the snapshot.
    expect(header()).toContain('Sky News');
    expect(header()).not.toContain('Bloomberg TV');
  });
});
