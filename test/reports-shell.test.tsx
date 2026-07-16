// @vitest-environment jsdom
/**
 * Task 6: ReportsModule shell + ReportsDashboard + editor status control.
 *
 * The module is now the Win98 app shell — menu bar + toolbar over a body row of the left nav tree
 * and a center view that swaps between the landing Dashboard (when no report is open) and the
 * <ReportEditor>. This test pins the load-bearing wiring:
 *   - with no report open the Dashboard renders (welcome header + Recent Reports table);
 *   - a "Create New Report" action seeds a report with status:'draft' + the settings author
 *     (GhostExodus) and swaps to the editor view;
 *   - the editor header carries a status <select> whose change updates report.status.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-module.test.tsx. window.api.reports is stubbed the
 * way preload exposes it (flat CRUD + nested contacts/descriptors/introductions), and
 * window.api.settings.read returns the persisted reports.author.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportsModule } from '../src/renderer/modules/reports/ReportsModule';

let container: HTMLDivElement;
let root: Root;

const savedReport = {
  id: 'r1', title: 'Case 42', createdAt: 't', updatedAt: '2026-07-14', to: 'Det. Vance',
  status: 'draft' as const, author: 'Investigator', blocks: [] as any[],
};

function stubApi(overrides: Record<string, any> = {}): void {
  (globalThis as any).window.api = {
    reports: {
      list: vi.fn(async () => [savedReport]),
      save: vi.fn(async (r: any) => r),
      remove: vi.fn(async () => undefined),
      putAsset: vi.fn(async () => 'banner-ref-1'),
      getAsset: vi.fn(async () => null),
      exportPdf: vi.fn(async () => 'r.pdf'),
      exportDocx: vi.fn(async () => 'r.docx'),
      contacts: { list: vi.fn(async () => []), save: vi.fn(async (c: any) => c), remove: vi.fn(async () => undefined) },
      descriptors: { list: vi.fn(async () => []), save: vi.fn(async (d: any) => d), remove: vi.fn(async () => undefined) },
      introductions: { list: vi.fn(async () => []), save: vi.fn(async (d: any) => d), remove: vi.fn(async () => undefined) },
      ...overrides,
    },
    settings: {
      read: vi.fn(async () => ({ reports: { author: 'GhostExodus' } })),
      update: vi.fn(async (p: any) => p),
    },
  };
}

beforeEach(() => {
  stubApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function buttonByText(text: string): HTMLButtonElement {
  // Tile buttons carry a decorative (aria-hidden) emoji span before the label, so match on
  // contained text rather than exact equality.
  const btn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text));
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn as HTMLButtonElement;
}

/** Set a React-controlled <select>'s value the way a real change would (native setter + change event). */
function selectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ReportsModule shell (Task 6)', () => {
  it('renders the shell chrome + Dashboard (welcome header + recent table) when no report is open', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.list).toHaveBeenCalled());

    // App-shell chrome: menu bar + toolbar + nav tree.
    expect(container.querySelector('.ga98-report-appshell')).toBeTruthy();
    expect(container.querySelector('.ga98-report-menubar')).toBeTruthy();
    expect(container.querySelector('.ga98-report-nav')).toBeTruthy();
    // Landing Dashboard: welcome header + the Recent Reports table showing the listed report.
    expect(container.querySelector('.ga98-report-dashboard')).toBeTruthy();
    expect(container.querySelector('.ga98-report-recent')).toBeTruthy();
    expect(container.textContent).toContain('Case 42');
    // No editor view yet.
    expect(container.querySelector('.ga98-report-editor')).toBeFalsy();
  });

  it('"Create New Report" seeds status:draft + settings author and swaps to the editor view', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.settings.read).toHaveBeenCalled());

    await act(async () => { buttonByText('Create New Report').click(); });

    await vi.waitFor(() => expect((window as any).api.reports.save).toHaveBeenCalled());
    const seeded = (window as any).api.reports.save.mock.calls[0][0];
    expect(seeded.status).toBe('draft');
    expect(seeded.author).toBe('GhostExodus');
    // Swapped to the editor view.
    await vi.waitFor(() => expect(container.querySelector('.ga98-report-editor')).toBeTruthy());
  });

  it('the editor header status <select> updates report.status on change', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.settings.read).toHaveBeenCalled());
    await act(async () => { buttonByText('Create New Report').click(); });

    const select = await vi.waitFor(() => {
      const el = container.querySelector('select[aria-label="Report status"]') as HTMLSelectElement | null;
      if (!el) throw new Error('status select not mounted');
      return el;
    });
    expect(select.value).toBe('draft');
    await act(async () => { selectValue(select, 'archived'); });
    // Controlled by report.status — a change to 'archived' is reflected back into the select.
    expect((container.querySelector('select[aria-label="Report status"]') as HTMLSelectElement).value).toBe('archived');
  });
});
