// @vitest-environment jsdom
/**
 * T2: RTFM — Searchlight + SOCMINT guide sections.
 *
 * HelpModule's left rail gains two new sections rendering the in-repo Searchlight and SOCMINT
 * guide markdown (bundled via Vite `?raw` import) through the existing MarkdownView component.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelpModule } from '../src/renderer/modules/help/HelpModule';

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

function railLabels(): string[] {
  return Array.from(container.querySelectorAll('.ga98-settings-rail-item')).map((e) => e.textContent || '');
}

describe('RTFM sections', () => {
  it('lists all six sections incl. Searchlight + SOCMINT', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const t = railLabels().join('|');
    for (const s of ['Manual', 'OpChildSafety', 'Hacktivist Ethos', 'OSINT', 'Searchlight', 'SOCMINT']) expect(t).toContain(s);
  });

  it('selecting Searchlight renders its guide markdown', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const btn = Array.from(container.querySelectorAll('.ga98-settings-rail-item')).find((b) => /Searchlight/.test(b.textContent || ''));
    await act(async () => { (btn as HTMLElement).click(); });
    expect(container.textContent).toMatch(/Searchlight/i); // a heading from the guide
  });

  it('renders the Searchlight §5 reference as a real <table>, not raw pipe text', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const btn = Array.from(container.querySelectorAll('.ga98-settings-rail-item')).find((b) => /Searchlight/.test(b.textContent || ''));
    await act(async () => { (btn as HTMLElement).click(); });
    // The §5 "button by button" table must render as a DOM table with a header row + body rows...
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('th').length).toBe(3); // What the button says | What it means | What to do
    expect(table!.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(5);
    // ...and the raw `|---|` delimiter must NOT leak into the visible text.
    expect(container.textContent).not.toContain('|---|');
  });

  it('selecting SOCMINT renders its guide markdown', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const btn = Array.from(container.querySelectorAll('.ga98-settings-rail-item')).find((b) => /SOCMINT/.test(b.textContent || ''));
    await act(async () => { (btn as HTMLElement).click(); });
    expect(container.textContent).toMatch(/SOCMINT/i); // a heading from the guide
  });
});
