// @vitest-environment jsdom
/**
 * Task 7: SignaturePad component.
 *
 * Optional signature capture: draw on a canvas OR upload an image; emits a data URL. Plan draft used
 * @testing-library/react (render/screen/fireEvent) but that package is NOT a repo dependency (Global
 * Constraint: no new dependency) — driven via React 18's createRoot inside act(), mirroring
 * test/invoice-line-item-table.test.tsx / test/news-feed-shared.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SignaturePad } from '../src/renderer/modules/invoices/SignaturePad';

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

function findByText(tag: string, text: string): HTMLElement {
  const el = Array.from(container.querySelectorAll(tag)).find((b) => b.textContent === text);
  if (!el) throw new Error(`${tag} "${text}" not found`);
  return el as HTMLElement;
}

describe('SignaturePad', () => {
  it('uploading an image file emits a data URL', async () => {
    const onCapture = vi.fn();
    await act(async () => {
      root.render(<SignaturePad onCapture={onCapture} />);
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'sig.png', { type: 'image/png' });
    const input = container.querySelector('input[aria-label="Upload signature"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(onCapture).toHaveBeenCalled());
    });
    expect(onCapture.mock.calls[0][0]).toMatch(/^data:/);
    expect(onCapture.mock.calls[0][1]).toBe('image/png');
  });

  it('uploading a jpeg emits image/jpeg (mime tracks the file, not a hardcoded png)', async () => {
    const onCapture = vi.fn();
    await act(async () => { root.render(<SignaturePad onCapture={onCapture} />); });
    const file = new File([new Uint8Array([1, 2, 3])], 'sig.jpg', { type: 'image/jpeg' });
    const input = container.querySelector('input[aria-label="Upload signature"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(onCapture).toHaveBeenCalled());
    });
    expect(onCapture.mock.calls[0][1]).toBe('image/jpeg');
  });

  it('Clear resets without emitting', async () => {
    const onCapture = vi.fn();
    await act(async () => {
      root.render(<SignaturePad onCapture={onCapture} />);
    });
    await act(async () => { findByText('button', 'Clear').click(); });
    expect(onCapture).not.toHaveBeenCalled();
  });
});
