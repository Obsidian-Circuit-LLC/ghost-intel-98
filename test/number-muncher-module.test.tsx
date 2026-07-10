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

function modeByLabel(label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button.ga98-calc-mode')).find((b) => b.textContent === label);
  if (!btn) throw new Error(`mode "${label}" not found`);
  return btn as HTMLButtonElement;
}

const memButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button.ga98-calc-mem')) as HTMLButtonElement[];

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

  it('scopes the memory register to Standard/Scientific and disables it in the other modes', async () => {
    // Memory (MC/MR/MS/M+/M-) is a single decimal scalar; Programmer/Converter/Statistics/Date/Unit
    // have no unambiguous scalar, so their memory buttons are disabled rather than capturing the stale
    // standard display.
    await act(async () => { root.render(<NumberMuncherModule />); });
    expect(memButtons()).toHaveLength(5);
    expect(memButtons().every((b) => !b.disabled)).toBe(true); // Standard: enabled
    await act(async () => { modeByLabel('Scientific').click(); });
    expect(memButtons().every((b) => !b.disabled)).toBe(true); // Scientific: enabled
    await act(async () => { modeByLabel('Programmer').click(); });
    expect(memButtons().every((b) => b.disabled)).toBe(true);  // Programmer: disabled
  });
});
