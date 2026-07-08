// @vitest-environment jsdom
/**
 * Task 6: LineItemTable component.
 *
 * Editable line-item table: derived hours + per-line amount, Add/Remove row actions. Plan draft used
 * @testing-library/react (render/screen/fireEvent) but that package is NOT a repo dependency (Global
 * Constraint: no new dependency) — driven via React 18's createRoot inside act(), mirroring
 * test/add-station-dialog.test.tsx / test/news-feed-shared.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LineItemTable } from '../src/renderer/modules/invoices/LineItemTable';
import type { InvoiceLine } from '../src/shared/invoice-types';

let container: HTMLDivElement;
let root: Root;

const lines: InvoiceLine[] = [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }];

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

describe('LineItemTable', () => {
  it('shows derived hours and per-line amount', async () => {
    await act(async () => {
      root.render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={() => {}} />);
    });
    expect(container.textContent).toContain('3.5'); // hours
    expect(container.textContent).toMatch(/70/); // 3.5 * 20
  });

  it('Add line appends an empty line', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={onChange} />);
    });
    await act(async () => { findButtonByText('Add line').click(); });
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });

  it('Remove line drops the row', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={onChange} />);
    });
    const removeBtn = container.querySelector('button[aria-label="Remove line"]') as HTMLButtonElement;
    await act(async () => { removeBtn.click(); });
    expect(onChange.mock.calls[0][0]).toHaveLength(0);
  });
});
