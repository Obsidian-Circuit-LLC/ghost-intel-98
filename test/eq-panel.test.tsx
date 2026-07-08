// @vitest-environment jsdom
/**
 * Task 8: EqPanel component.
 *
 * EqPanel is presentational — ten band sliders + preset select + on/off checkbox — owning no
 * persistence; the parent (MediaPlayerModule, Task 11) maps onChange to settings.media.eq and the
 * live audio graph. No @testing-library/react in this repo's deps — driven via React 18's
 * createRoot inside act(), mirroring test/add-stream-dialog.test.tsx / news-feed-shared.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EqPanel, type EqState } from '../src/renderer/modules/media/EqPanel';

let container: HTMLDivElement;
let root: Root;

const base: EqState = { enabled: true, gains: new Array(10).fill(0), preset: 'Flat' };

/** Set a React-controlled element's value the way a real interaction would (native setter + change event). */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
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

describe('EqPanel', () => {
  it('choosing a preset emits its gains and preset name', async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<EqPanel eq={base} onChange={onChange} />); });

    const select = container.querySelector('[aria-label="EQ preset"]') as HTMLSelectElement;
    await act(async () => { setValue(select, 'Bass'); });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: 'Bass' }));
    expect(onChange.mock.calls[0][0].gains[0]).toBeGreaterThan(0);
  });

  it('toggling enabled emits the flag', async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<EqPanel eq={base} onChange={onChange} />); });

    const checkbox = container.querySelector('[aria-label="EQ on"]') as HTMLInputElement;
    await act(async () => { checkbox.click(); });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
