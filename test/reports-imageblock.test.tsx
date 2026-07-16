// @vitest-environment jsdom
/**
 * Task 8: photo blocks. `ImageBlock` renders a report's image block — the resolved image at its
 * stored `widthPct`, a bottom-right resize handle that mutates `widthPct` (always clamped to
 * [10,100] by the pure `clampPct` helper), and a caption <input> in a smaller font. The resize
 * math is isolated in `clampPct` so it is unit-testable without simulating a full pointer drag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ImageBlock, clampPct } from '../src/renderer/modules/reports/blocks/ImageBlock';
import type { ReportBlock } from '../src/shared/reports-types';

type ImageData = Extract<ReportBlock, { kind: 'image' }>;

describe('clampPct', () => {
  it('clamps into [10,100] and rounds to an integer', () => {
    expect(clampPct(5)).toBe(10);
    expect(clampPct(9.9)).toBe(10);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(63.4)).toBe(63);
    expect(clampPct(63.6)).toBe(64);
    expect(clampPct(10)).toBe(10);
    expect(clampPct(100)).toBe(100);
  });
  it('falls back to a safe default on a non-finite value', () => {
    expect(clampPct(Number.NaN)).toBe(60);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(60);
    expect(clampPct(Number.NEGATIVE_INFINITY)).toBe(60);
  });
});

let container: HTMLDivElement;
let root: Root;

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

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

describe('ImageBlock', () => {
  it('sizes the FRAME to widthPct (not the image) so the frame hugs the image — no whitespace', async () => {
    const block: ImageData = { id: 'i1', kind: 'image', assetRef: 'a.png', widthPct: 40, caption: 'Scene' };
    await act(async () => {
      root.render(<ImageBlock block={block} src="data:image/png;base64,AAAA" onChange={vi.fn()} />);
    });

    const frame = container.querySelector('.ga98-report-imageblock-frame') as HTMLElement;
    expect(frame).toBeTruthy();
    // The frame — not the image — tracks widthPct, so an empty column no longer flanks the photo.
    expect(frame.style.width).toBe('40%');

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    // The image fills its (now correctly sized) frame rather than a fraction of the full column.
    expect(img.style.width).toBe('100%');

    // The resize handle is a child of the frame, so it lands on the image's own corner, not the
    // column's — it never sits far off to the right of a narrow photo.
    const handle = container.querySelector('.ga98-report-imageblock-handle');
    expect(handle).toBeTruthy();
    expect(frame.contains(handle)).toBe(true);

    const cap = container.querySelector('input[aria-label="Photo caption"]') as HTMLInputElement;
    expect(cap).toBeTruthy();
    expect(cap.value).toBe('Scene');
  });

  it('editing the caption calls onChange with the new caption', async () => {
    const block: ImageData = { id: 'i2', kind: 'image', assetRef: 'a.png', widthPct: 60, caption: '' };
    const onChange = vi.fn();
    await act(async () => {
      root.render(<ImageBlock block={block} src="x" onChange={onChange} />);
    });

    const cap = container.querySelector('input[aria-label="Photo caption"]') as HTMLInputElement;
    await act(async () => { typeInto(cap, 'North entrance'); });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.caption).toBe('North entrance');
  });

  it('a resize drag pushes a clamped widthPct through onChange (never outside [10,100])', async () => {
    const block: ImageData = { id: 'i3', kind: 'image', assetRef: 'a.png', widthPct: 60, caption: '' };
    const onChange = vi.fn();
    await act(async () => {
      root.render(<ImageBlock block={block} src="x" onChange={onChange} />);
    });

    const handle = container.querySelector('.ga98-report-imageblock-handle') as HTMLElement;
    expect(handle).toBeTruthy();

    // Drag far to the right — well past 100% — and assert the emitted widthPct is clamped.
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5000 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5000 }));
    });

    expect(onChange).toHaveBeenCalled();
    for (const call of onChange.mock.calls) {
      const pct = call[0].widthPct;
      if (pct !== undefined) {
        expect(pct).toBeGreaterThanOrEqual(10);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });
});
