// @vitest-environment jsdom
/**
 * Task 9: document metrics + the right-rail panel. The pure `wordCount` / `estimatePageCount`
 * helpers feed the status bar; `RightRail` is a presentational panel stack that renders the
 * document outline and image-properties controls and reports interactions back up. This is a light
 * render smoke test (React 18 createRoot inside act(), no @testing-library — Global Constraint: no
 * new dependency), driving RightRail via `createElement` so the file stays a plain `.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { wordCount, estimatePageCount } from '../src/renderer/modules/reports/outline';
import { RightRail } from '../src/renderer/modules/reports/panels/RightRail';
import type { ReportBlock } from '../src/shared/reports-types';

type ImageData = Extract<ReportBlock, { kind: 'image' }>;

describe('metrics helpers', () => {
  it('wordCount is empty-safe and sums text + table cells', () => {
    expect(wordCount([])).toBe(0);
    expect(wordCount([{ id: 'x', kind: 'text', html: '<p>one two three</p>' }])).toBe(3);
  });
  it('estimatePageCount guards a non-positive page height', () => {
    expect(estimatePageCount(5000, 0)).toBe(1);
    expect(estimatePageCount(2113, 1056)).toBe(3);
  });
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('RightRail', () => {
  it('renders outline entries and jumps on click', async () => {
    const onOutlineJump = vi.fn();
    await act(async () => {
      root.render(createElement(RightRail, {
        descriptors: [],
        outline: [{ id: 'b1', text: 'Overview' }, { id: 'b2', text: 'Findings' }],
        selectedImage: null,
        onOutlineJump,
        onImagePatch: vi.fn()
      }));
    });

    const items = Array.from(container.querySelectorAll('.ga98-report-outline-item')) as HTMLButtonElement[];
    expect(items.map((i) => i.textContent)).toEqual(['Overview', 'Findings']);

    await act(async () => { items[1].click(); });
    expect(onOutlineJump).toHaveBeenCalledWith('b2');
  });

  it('shows image-properties controls only when an image is selected and patches align', async () => {
    const onImagePatch = vi.fn();
    const selectedImage: ImageData = { id: 'i1', kind: 'image', assetRef: 'a.png', widthPct: 60, caption: '', align: 'left' };
    await act(async () => {
      root.render(createElement(RightRail, {
        descriptors: [],
        outline: [],
        selectedImage,
        onOutlineJump: vi.fn(),
        onImagePatch
      }));
    });

    const align = container.querySelector('select[aria-label="Image align"]') as HTMLSelectElement;
    expect(align).toBeTruthy();
    await act(async () => {
      align.value = 'center';
      align.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onImagePatch).toHaveBeenCalledWith({ align: 'center' });
  });

  it('hides the image-properties panel with no selection', async () => {
    await act(async () => {
      root.render(createElement(RightRail, {
        descriptors: [],
        outline: [],
        selectedImage: null,
        onOutlineJump: vi.fn(),
        onImagePatch: vi.fn()
      }));
    });
    expect(container.querySelector('select[aria-label="Image align"]')).toBeNull();
  });
});
