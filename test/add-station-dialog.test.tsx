// @vitest-environment jsdom
/**
 * Task 9: AddStationDialog (Add/Edit) component.
 *
 * Shared by StationsDrawer's Add and Edit buttons: Edit passes `initial` (with id) to pre-fill and
 * carry the id back through onSubmit → upsertStation. No @testing-library/react in this repo's deps
 * (Global Constraint: no new dependency) — driven via React 18's createRoot inside act(), mirroring
 * test/add-stream-dialog.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AddStationDialog } from '../src/renderer/modules/media/AddStationDialog';

let container: HTMLDivElement;
let root: Root;

/** Set a React-controlled <input>'s value the way a real keystroke would (native setter + input event). */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButtonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
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

describe('AddStationDialog', () => {
  it('add mode: returns trimmed label + url, no id', async () => {
    const onSubmit = vi.fn();

    await act(async () => { root.render(<AddStationDialog onSubmit={onSubmit} onCancel={() => {}} />); });

    expect(container.textContent).toContain('Add station');

    const labelInput = container.querySelector('input[placeholder="Label"]') as HTMLInputElement;
    const urlInput = container.querySelector('input[placeholder="http(s) stream URL"]') as HTMLInputElement;

    await act(async () => {
      typeInto(labelInput, ' Rekt ');
      typeInto(urlInput, 'https://s/');
    });
    await act(async () => { findButtonByText('OK').click(); });

    expect(onSubmit).toHaveBeenCalledWith({ label: 'Rekt', url: 'https://s/' });
  });

  it('edit mode: pre-fills and carries the id', async () => {
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(<AddStationDialog initial={{ id: 'x1', label: 'Old', url: 'https://o/' }} onSubmit={onSubmit} onCancel={() => {}} />);
    });

    expect(container.textContent).toContain('Edit station');

    await act(async () => { findButtonByText('OK').click(); });

    expect(onSubmit).toHaveBeenCalledWith({ id: 'x1', label: 'Old', url: 'https://o/' });
  });
});
