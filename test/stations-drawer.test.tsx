// @vitest-environment jsdom
/**
 * Task 10: StationsDrawer.
 *
 * The fold-out STREAM STATIONS drawer (full-shade): list + Add/Edit/Remove/Up/Down/Save-List/Test +
 * Now-Playing-Station panel. Gated behind the streaming opt-in like today — shows the opt-in card
 * when off. No @testing-library/react in this repo's deps — driven via React 18's createRoot inside
 * act(), mirroring test/add-station-dialog.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StationsDrawer } from '../src/renderer/modules/media/StationsDrawer';

let container: HTMLDivElement;
let root: Root;

const stations = [
  { id: 'a', label: 'A', url: 'https://a/' },
  { id: 'b', label: 'B', url: 'https://b/' }
];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as any).window.api = {
    media: {
      upsertStation: vi.fn(async () => ({ id: 'a', label: 'A', url: 'https://a/' })),
      deleteStation: vi.fn(async () => {}),
      reorderStations: vi.fn(async () => ({ roots: [], tracks: [], stations })),
      exportStations: vi.fn(async () => 'stations.json')
    }
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('StationsDrawer', () => {
  it('moving A down calls reorderStations with [b, a]', async () => {
    const onChanged = vi.fn();
    await act(async () => {
      root.render(
        <StationsDrawer
          stations={stations}
          streamingEnabled
          onPlay={() => {}}
          onChanged={onChanged}
          onEnableStreaming={() => {}}
        />
      );
    });

    const downButtons = Array.from(container.querySelectorAll('[aria-label="Move down"]')) as HTMLButtonElement[];
    expect(downButtons).toHaveLength(2);
    await act(async () => { downButtons[0].click(); });

    expect((window as any).api.media.reorderStations).toHaveBeenCalledWith(['b', 'a']);
  });

  it('shows the opt-in card when streaming is off', async () => {
    await act(async () => {
      root.render(
        <StationsDrawer
          stations={stations}
          streamingEnabled={false}
          onPlay={() => {}}
          onChanged={() => {}}
          onEnableStreaming={() => {}}
        />
      );
    });

    expect(container.textContent).toMatch(/internet streaming is off/i);
  });
});
