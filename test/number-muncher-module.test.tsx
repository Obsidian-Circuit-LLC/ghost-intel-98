// @vitest-environment jsdom
/**
 * Task 3: NumberMuncherModule shell + Standard mode.
 *
 * Verifies the 7-mode rail renders and that the Standard keypad drives the pure
 * FSM through the shell: clicking 2, +, 3, = shows 5 in the display. No
 * @testing-library (not a repo dependency) — React 18 createRoot inside act(),
 * mirroring test/invoices-module.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NumberMuncherModule } from '../src/renderer/modules/number-muncher/NumberMuncherModule';

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

function keyByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button.ga98-calc-key')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`key "${text}" not found`);
  return btn as HTMLButtonElement;
}

describe('NumberMuncherModule', () => {
  it('renders the 7 mode-rail labels', async () => {
    await act(async () => { root.render(<NumberMuncherModule />); });
    const labels = Array.from(container.querySelectorAll('.ga98-calc-mode')).map((e) => e.textContent);
    expect(labels).toEqual(['Standard', 'Scientific', 'Programmer', 'Converter', 'Statistics', 'Date Calc', 'Unit Calc']);
  });

  it('clicking 2 + 3 = shows 5 in the display', async () => {
    await act(async () => { root.render(<NumberMuncherModule />); });
    await act(async () => { keyByText('2').click(); });
    await act(async () => { keyByText('+').click(); });
    await act(async () => { keyByText('3').click(); });
    await act(async () => { keyByText('=').click(); });
    const display = container.querySelector('.ga98-calc-display');
    expect(display?.textContent).toBe('5');
  });
});
