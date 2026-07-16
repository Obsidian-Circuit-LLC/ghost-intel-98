// @vitest-environment jsdom
/**
 * Task 5: ReportsMenuBar + ReportsToolbar — the Reports shell's Win98 chrome.
 * The menu bar is a `role="menubar"` row of top-level menus (File / Edit / View / Reports /
 * Templates / Tools / Help); clicking a top-level opens a `ga98-context-menu`-style dropdown whose
 * items dispatch a shared action-id union via `onAction(id)`. Editor-only items (Save, Export, Edit
 * ops, Save as Template) are `disabled` unless `hasOpenReport`; Template Library / Use Template are
 * always live (they open the library). The toolbar is a `ga98-toolbar` row of the same actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportsMenuBar } from '../src/renderer/modules/reports/ReportsMenuBar';
import { ReportsToolbar } from '../src/renderer/modules/reports/ReportsToolbar';

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

function topMenu(label: string): HTMLButtonElement {
  return container.querySelector(`[data-menu="${label}"]`) as HTMLButtonElement;
}
function menuItem(action: string): HTMLButtonElement {
  return container.querySelector(`[data-menu-action="${action}"]`) as HTMLButtonElement;
}

describe('ReportsMenuBar', () => {
  it('renders the seven top-level menus in a role="menubar" row', async () => {
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport={false} onAction={vi.fn()} />); });
    expect(container.querySelector('[role="menubar"]')).toBeTruthy();
    for (const label of ['File', 'Edit', 'View', 'Reports', 'Templates', 'Tools', 'Help']) {
      expect(topMenu(label)).toBeTruthy();
    }
  });

  it('File → New Report dispatches onAction("new")', async () => {
    const onAction = vi.fn();
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport={false} onAction={onAction} />); });
    await act(async () => { topMenu('File').click(); });
    const item = menuItem('new');
    expect(item).toBeTruthy();
    await act(async () => { item.click(); });
    expect(onAction).toHaveBeenCalledWith('new');
  });

  it('Templates items are live with a report open and dispatch their action', async () => {
    const onAction = vi.fn();
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport onAction={onAction} />); });
    await act(async () => { topMenu('Templates').click(); });
    const items = Array.from(container.querySelectorAll('.ga98-report-menu-dropdown [data-menu-action]')) as HTMLButtonElement[];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.disabled).toBe(false);
    await act(async () => { menuItem('templateSave').click(); });
    expect(onAction).toHaveBeenCalledWith('templateSave');
  });

  it('Save as Template is disabled with no report open; Library/Use stay live', async () => {
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport={false} onAction={vi.fn()} />); });
    await act(async () => { topMenu('Templates').click(); });
    expect(menuItem('templateSave').disabled).toBe(true);
    expect(menuItem('templateLibrary').disabled).toBe(false);
    expect(menuItem('templateUse').disabled).toBe(false);
  });

  it('Edit → Copy is disabled when no report is open and enabled when one is', async () => {
    const onAction = vi.fn();
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport={false} onAction={onAction} />); });
    await act(async () => { topMenu('Edit').click(); });
    expect(menuItem('copy').disabled).toBe(true);

    // Re-render the same root with a report open; the Edit dropdown stays open, so Copy is now live.
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport onAction={onAction} />); });
    expect(menuItem('copy').disabled).toBe(false);
  });

  it('an outside mousedown closes an open dropdown', async () => {
    await act(async () => { root.render(<ReportsMenuBar hasOpenReport onAction={vi.fn()} />); });
    await act(async () => { topMenu('File').click(); });
    expect(container.querySelector('.ga98-report-menu-dropdown')).toBeTruthy();
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(container.querySelector('.ga98-report-menu-dropdown')).toBeNull();
  });
});

describe('ReportsToolbar', () => {
  it('renders a ga98-toolbar row and Export PDF dispatches onAction("exportPdf")', async () => {
    const onAction = vi.fn();
    await act(async () => { root.render(<ReportsToolbar hasOpenReport onAction={onAction} />); });
    expect(container.querySelector('.ga98-toolbar')).toBeTruthy();
    const pdf = container.querySelector('[data-tool-action="exportPdf"]') as HTMLButtonElement;
    expect(pdf).toBeTruthy();
    await act(async () => { pdf.click(); });
    expect(onAction).toHaveBeenCalledWith('exportPdf');
  });

  it('editor-only toolbar buttons are disabled when no report is open', async () => {
    await act(async () => { root.render(<ReportsToolbar hasOpenReport={false} onAction={vi.fn()} />); });
    expect((container.querySelector('[data-tool-action="save"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-tool-action="exportPdf"]') as HTMLButtonElement).disabled).toBe(true);
    // "New" is always available.
    expect((container.querySelector('[data-tool-action="new"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
