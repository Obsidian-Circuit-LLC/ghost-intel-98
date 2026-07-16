// @vitest-environment jsdom
/**
 * Task 5: Photo picker — upload from computer.
 *
 * CasePhotoPicker (the "Import from case" overlay) also offers "Upload from computer": a
 * <input type=file accept="image/png,image/jpeg"> that hands the chosen File straight up to the
 * same add-photo path the "+ Photo" toolbar button uses (onAddPhoto/addPhoto in ReportsModule),
 * then closes the picker — mirroring addSelected()'s onClose() after "Add selected".
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-recipient-ui.test.tsx / invoice-signature-pad.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CasePhotoPicker } from '../src/renderer/modules/reports/CasePhotoPicker';

let container: HTMLDivElement;
let root: Root;

function stubApi(): void {
  (globalThis as any).window.api = {
    cases: { list: vi.fn(async () => []) },
    files: { listAttachments: vi.fn(async () => []) },
  };
}

beforeEach(() => {
  stubApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('CasePhotoPicker upload from computer (Task 5)', () => {
  it('renders an upload input scoped to png/jpeg', async () => {
    await act(async () => {
      root.render(<CasePhotoPicker onAdd={() => {}} onUploadFile={() => {}} onClose={() => {}} />);
    });
    const input = container.querySelector('input[type="file"][aria-label="Upload photo from computer"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.accept).toBe('image/png,image/jpeg');
  });

  it('choosing a file calls onUploadFile with the File and closes the picker', async () => {
    const onUploadFile = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(<CasePhotoPicker onAdd={() => {}} onUploadFile={onUploadFile} onClose={onClose} />);
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    const input = container.querySelector('input[type="file"][aria-label="Upload photo from computer"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(onUploadFile.mock.calls[0][0]).toBe(file);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onUploadFile when the change event has no file', async () => {
    const onUploadFile = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(<CasePhotoPicker onAdd={() => {}} onUploadFile={onUploadFile} onClose={onClose} />);
    });
    const input = container.querySelector('input[type="file"][aria-label="Upload photo from computer"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
