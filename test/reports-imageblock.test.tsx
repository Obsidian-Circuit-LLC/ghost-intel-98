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

  it('maps the pointer to a COLUMN-relative widthPct, not the frame\'s own shrunk width', async () => {
    // Regression: the frame is now sized to widthPct% of the column (WS5 hug-the-image change),
    // so dividing the drag delta by the frame's own width snaps a sub-100% photo to 100% on grab.
    // The denominator must be the constant column width (the frame's block parent), so nudging the
    // right-edge handle a few px tracks the pointer proportionally instead of ballooning.
    const block: ImageData = { id: 'i4', kind: 'image', assetRef: 'a.png', widthPct: 40, caption: '' };
    const onChange = vi.fn();
    await act(async () => {
      root.render(<ImageBlock block={block} src="x" onChange={onChange} />);
    });

    const frame = container.querySelector('.ga98-report-imageblock-frame') as HTMLElement;
    const parent = container.querySelector('.ga98-report-imageblock') as HTMLElement;
    const rect = (width: number): DOMRect =>
      ({ width, left: 0, right: width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
    // Column is 500px; a 40% frame is 200px wide, its right-edge handle sits at x≈200.
    parent.getBoundingClientRect = () => rect(500);
    frame.getBoundingClientRect = () => rect(200);

    const handle = container.querySelector('.ga98-report-imageblock-handle') as HTMLElement;
    // Grab the handle at its resting position (x=200) and nudge it 10px right.
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 210 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 210 }));
    });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // 210/500*100 = 42. Frame-relative math would give 210/200*100 = 105 → clamp → 100.
    expect(last.widthPct).toBe(42);
  });
});
