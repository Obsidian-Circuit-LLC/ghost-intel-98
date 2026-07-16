// @vitest-environment jsdom
/**
 * Task 8: TableBlock render + security spine. A table block is a rectangular `string[][]` of
 * sanitized cell HTML. Editing a cell's contentEditable runs its innerHTML through
 * `sanitizeReportHtml` BEFORE the value reaches `onChange` (the save path) — table cells are not a
 * bypass around the sanitizer. The "+ Row" / "+ Col" toolbar actions go through the pure grid
 * helpers, so the grid stays rectangular from the editor too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TableBlock } from '../src/renderer/modules/reports/blocks/TableBlock';
import type { ReportBlock } from '../src/shared/reports-types';

type TableData = Extract<ReportBlock, { kind: 'table' }>;

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

function block2x2(): TableData {
  return { id: 't1', kind: 'table', cells: [['a', 'b'], ['c', 'd']] };
}

describe('TableBlock', () => {
  it('renders every cell as a labelled editable and a "+ Row" / "+ Col" toolbar', async () => {
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={vi.fn()} />); });

    for (const label of ['Cell 1,1', 'Cell 1,2', 'Cell 2,1', 'Cell 2,2']) {
      expect(container.querySelector(`[aria-label="${label}"]`)).toBeTruthy();
    }
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('+ Row');
    expect(buttons).toContain('+ Col');
  });

  it('editing a cell sanitizes its html before onChange (the save path)', async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={onChange} />); });

    const cell = container.querySelector('[aria-label="Cell 1,1"]') as HTMLElement;
    await act(async () => {
      cell.innerHTML = '<b>ok</b><script>bad()</script><span onclick="x()">t</span>';
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const cells = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string[][];
    expect(cells[0][0]).toContain('<b>ok</b>');
    expect(cells[0][0]).not.toContain('script');
    expect(cells[0][0]).not.toContain('onclick');
    // Other cells are left untouched; the grid stays 2×2.
    expect(cells).toEqual([[cells[0][0], 'b'], ['c', 'd']]);
  });

  it('"+ Row" emits a 3×2 grid with an empty new row', async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={onChange} />); });

    const addRowBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+ Row') as HTMLButtonElement;
    await act(async () => { addRowBtn.click(); });

    expect(onChange).toHaveBeenCalledWith([['a', 'b'], ['c', 'd'], ['', '']]);
  });

  it('"+ Col" emits a 2×3 grid with an empty new column', async () => {
    const onChange = vi.fn();
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={onChange} />); });

    const addColBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+ Col') as HTMLButtonElement;
    await act(async () => { addColBtn.click(); });

    expect(onChange).toHaveBeenCalledWith([['a', 'b', ''], ['c', 'd', '']]);
  });

  it('shows a Remove table control only when onRemove is provided', async () => {
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={vi.fn()} />); });
    expect(container.querySelector('button[aria-label="Remove table"]')).toBeNull();

    const onRemove = vi.fn();
    await act(async () => { root.render(<TableBlock block={block2x2()} onChange={vi.fn()} onRemove={onRemove} />); });
    const rm = container.querySelector('button[aria-label="Remove table"]') as HTMLButtonElement;
    expect(rm).toBeTruthy();
    await act(async () => { rm.click(); });
    expect(onRemove).toHaveBeenCalled();
  });
});
