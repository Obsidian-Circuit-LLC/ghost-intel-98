// @vitest-environment jsdom
/**
 * Task 3: RecentReportsTable — the Dashboard's "Recent Reports" grid. Renders a row per report
 * (Name / Status / Last Modified / Created By), sorts on a header click (local sort state via the
 * pure `sortReports` from Task 2), highlights the selected row, opens on double-click, and exposes a
 * right-click `ga98-context-menu` (Open/Rename/Duplicate/Export/Archive/Delete) through `onContext`.
 * Status cells carry a `ga98-report-status-{draft|completed|archived}` class so the CSS (Task 7) can
 * colour them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RecentReportsTable } from '../src/renderer/modules/reports/RecentReportsTable';
import type { Report } from '../src/shared/reports-types';

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

const mk = (id: string, title: string, status: Report['status'], updatedAt: string, author: string): Report =>
  ({ id, title, createdAt: '2026-01-01', updatedAt, to: '', status, author, blocks: [] });

const reports: Report[] = [
  mk('a', 'Alpha', 'draft', '2026-07-10', 'GhostExodus'),
  mk('b', 'Bravo', 'completed', '2026-07-14', 'Investigator'),
  mk('c', 'Charlie', 'archived', '2026-07-12', 'Zeta')
];

function bodyRowIds(): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.getAttribute('data-report-id') ?? '');
}

describe('RecentReportsTable', () => {
  it('renders a row per report with Name / Status / Last Modified / Created By columns', async () => {
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onContext={vi.fn()} />);
    });
    // Header text may carry a sort indicator (" ▲"/" ▼"); match on the leading label.
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').replace(/[▲▼]/g, '').trim());
    expect(headers).toContain('Name');
    expect(headers).toContain('Status');
    expect(headers).toContain('Last Modified');
    expect(headers).toContain('Created By');
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
    // Cell content is present.
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('GhostExodus');
  });

  it('re-sorts when a column header is clicked', async () => {
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onContext={vi.fn()} />);
    });
    const nameHeader = Array.from(container.querySelectorAll('thead th')).find((th) => th.textContent === 'Name') as HTMLElement;
    await act(async () => { nameHeader.click(); });
    expect(bodyRowIds()).toEqual(['a', 'b', 'c']); // Alpha, Bravo, Charlie ascending
    await act(async () => { nameHeader.click(); });
    expect(bodyRowIds()).toEqual(['c', 'b', 'a']); // toggled to descending
  });

  it('single click selects, double click opens', async () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId={null} onSelect={onSelect} onOpen={onOpen} onContext={vi.fn()} />);
    });
    const firstRow = container.querySelector('tbody tr') as HTMLElement;
    const id = firstRow.getAttribute('data-report-id');
    await act(async () => { firstRow.click(); });
    expect(onSelect).toHaveBeenCalledWith(id);
    await act(async () => { firstRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(onOpen).toHaveBeenCalledWith(id);
  });

  it('highlights the selected row and tags status cells with a status class', async () => {
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId="b" onSelect={vi.fn()} onOpen={vi.fn()} onContext={vi.fn()} />);
    });
    const selected = container.querySelector('tbody tr[data-report-id="b"]') as HTMLElement;
    expect(selected.className).toContain('ga98-report-recent-selected');
    expect(container.querySelector('.ga98-report-status-draft')).toBeTruthy();
    expect(container.querySelector('.ga98-report-status-completed')).toBeTruthy();
    expect(container.querySelector('.ga98-report-status-archived')).toBeTruthy();
  });

  it('right-click opens a context menu whose items dispatch onContext(id, action)', async () => {
    const onContext = vi.fn();
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId={null} onSelect={vi.fn()} onOpen={vi.fn()} onContext={onContext} />);
    });
    const row = container.querySelector('tbody tr[data-report-id="a"]') as HTMLElement;
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
    const menu = container.querySelector('.ga98-context-menu');
    expect(menu).toBeTruthy();
    const items = Array.from(menu!.querySelectorAll('.ga98-context-menu-item')).map((b) => b.textContent);
    expect(items).toEqual(['Open', 'Rename', 'Duplicate', 'Export', 'Archive', 'Delete']);
    const dup = Array.from(menu!.querySelectorAll('.ga98-context-menu-item')).find((b) => b.textContent === 'Duplicate') as HTMLButtonElement;
    await act(async () => { dup.click(); });
    expect(onContext).toHaveBeenCalledWith('a', 'duplicate');
  });

  it('"Open Selected Report" is disabled without a selection and enabled with one', async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId={null} onSelect={vi.fn()} onOpen={onOpen} onContext={vi.fn()} />);
    });
    const openBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Open Selected Report') as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);

    await act(async () => {
      root.render(<RecentReportsTable reports={reports} selectedId="a" onSelect={vi.fn()} onOpen={onOpen} onContext={vi.fn()} />);
    });
    const openBtn2 = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Open Selected Report') as HTMLButtonElement;
    expect(openBtn2.disabled).toBe(false);
    await act(async () => { openBtn2.click(); });
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
