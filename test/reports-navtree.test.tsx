// @vitest-environment jsdom
/**
 * Task 4: ReportsNavTree — the Reports shell's left Explorer tree + Quick Actions panel.
 * The tree exposes the nav nodes (Dashboard · Reports[All/Recent/Drafts/Archived] · Contacts[My
 * Contacts]); clicking a node calls `onSelect(node)` and the active node carries the
 * `ga98-report-nav-active` selection class. The Quick Actions panel offers "Start New Report"
 * (→ onNewReport) and "Manage Contacts" (→ onManageContacts); the "Use Template" quick-action is
 * rendered `disabled` (deferred to sub-project B — never a no-op handler).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportsNavTree } from '../src/renderer/modules/reports/ReportsNavTree';

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

function navEl(node: string): HTMLElement {
  return container.querySelector(`[data-nav="${node}"]`) as HTMLElement;
}

describe('ReportsNavTree', () => {
  it('renders the Explorer tree nodes and Quick Actions', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    for (const node of ['dashboard', 'all', 'recent', 'drafts', 'archived']) {
      expect(navEl(node)).toBeTruthy();
    }
    expect(container.textContent).toContain('Drafts');
    expect(container.textContent).toContain('Quick Actions');
  });

  it('clicking a node calls onSelect with its NavNode', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={onSelect} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    await act(async () => { navEl('drafts').click(); });
    expect(onSelect).toHaveBeenCalledWith('drafts');
  });

  it('marks the active node with the selection class', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="drafts" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    expect(navEl('drafts').className).toContain('ga98-report-nav-active');
    expect(navEl('archived').className).not.toContain('ga98-report-nav-active');
  });

  it('"Use Template" quick-action is disabled (deferred to sub-project B)', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    const tpl = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Use Template')) as HTMLButtonElement;
    expect(tpl).toBeTruthy();
    expect(tpl.disabled).toBe(true);
  });

  it('"Start New Report" calls onNewReport and "Manage Contacts" calls onManageContacts', async () => {
    const onNewReport = vi.fn();
    const onManageContacts = vi.fn();
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={onNewReport} onManageContacts={onManageContacts} />
      );
    });
    const newBtn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Start New Report')) as HTMLButtonElement;
    await act(async () => { newBtn.click(); });
    expect(onNewReport).toHaveBeenCalled();
    const contactsBtn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Manage Contacts')) as HTMLButtonElement;
    await act(async () => { contactsBtn.click(); });
    expect(onManageContacts).toHaveBeenCalled();
  });

  it('the Reports branch collapses/expands, hiding its child nodes when collapsed', async () => {
    await act(async () => {
      root.render(
        <ReportsNavTree active="dashboard" onSelect={vi.fn()} onNewReport={vi.fn()} onManageContacts={vi.fn()} />
      );
    });
    expect(navEl('drafts')).toBeTruthy();
    const toggle = container.querySelector('[data-nav-toggle="reports"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    expect(navEl('drafts')).toBeFalsy();
    await act(async () => { toggle.click(); });
    expect(navEl('drafts')).toBeTruthy();
  });
});
