// @vitest-environment jsdom
/**
 * Task 6: Save-as-template + create-from-template + un-grey the Templates controls.
 *
 *   - "Save as Template" on an open report prompts for a name (themed promptDialog — never
 *     window.prompt) and persists a ReportTemplate carrying the report's body via templates.save.
 *   - "Use Template" opens the library; selecting a template ("Select Template") clones it into a
 *     fresh-id draft Report (its banner/image assets deep-copied via copyAsset), saves it, and swaps
 *     into the editor.
 *   - The Templates menu items, the dashboard "Use Template" tile, and the nav quick-action are all
 *     enabled (no dead/greyed Templates controls).
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-module.test.tsx. `promptDialog` is mocked (jsdom
 * has no themed-dialog host) so the name-prompt resolves deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportsModule } from '../src/renderer/modules/reports/ReportsModule';
import { promptDialog } from '../src/renderer/state/dialogs';

vi.mock('../src/renderer/state/dialogs', () => ({
  promptDialog: vi.fn(async () => 'Chain-of-Custody Template'),
  confirmDialog: vi.fn(async () => true),
  alertDialog: vi.fn(async () => undefined),
}));

let container: HTMLDivElement;
let root: Root;

const savedReport = {
  id: 'r1', title: 'Case 42', createdAt: 't', updatedAt: '2026-07-14', to: 'Det. Vance',
  toContactId: 'c-to', status: 'draft' as const, author: 'Investigator', blocks: [] as any[],
};
const savedTemplate = {
  id: 'tpl1', name: 'Chain of Custody', category: 'Custody', createdAt: 'a', updatedAt: 'b',
  to: 'PO', toContactId: 'c-tpl-to', bannerRef: 'banner.png',
  blocks: [{ id: 'blk1', kind: 'text' as const, html: '<p>Body</p>' }],
};

function stubApi(overrides: Record<string, any> = {}): void {
  (globalThis as any).window.api = {
    reports: {
      list: vi.fn(async () => [savedReport]),
      save: vi.fn(async (r: any) => r),
      remove: vi.fn(async () => undefined),
      putAsset: vi.fn(async () => 'banner-ref-1'),
      getAsset: vi.fn(async () => null),
      copyAsset: vi.fn(async (ref: string) => `${ref}-copy`),
      previewTemplate: vi.fn(async () => '<h1>Chain of Custody</h1>'),
      exportPdf: vi.fn(async () => 'r.pdf'),
      exportDocx: vi.fn(async () => 'r.docx'),
      contacts: { list: vi.fn(async () => []), save: vi.fn(async (c: any) => c), remove: vi.fn(async () => undefined) },
      descriptors: { list: vi.fn(async () => []), save: vi.fn(async (d: any) => d), remove: vi.fn(async () => undefined) },
      introductions: { list: vi.fn(async () => []), save: vi.fn(async (d: any) => d), remove: vi.fn(async () => undefined) },
      templates: {
        list: vi.fn(async () => [savedTemplate]),
        save: vi.fn(async (t: any) => t),
        remove: vi.fn(async () => undefined),
      },
      ...overrides,
    },
    settings: { read: vi.fn(async () => ({ reports: { author: 'Investigator' } })), update: vi.fn(async (p: any) => p) },
  };
}

beforeEach(() => {
  stubApi();
  (promptDialog as any).mockClear?.();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function tiles(text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent || '').includes(text)) as HTMLButtonElement[];
}

async function openSavedReport(): Promise<void> {
  const row = await vi.waitFor(() => {
    const el = container.querySelector('tbody tr[data-report-id="r1"]') as HTMLElement | null;
    if (!el) throw new Error('report row not mounted');
    return el;
  });
  await act(async () => { row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
}

async function openTemplatesMenu(): Promise<void> {
  const top = container.querySelector('[data-menu="Templates"]') as HTMLButtonElement;
  await act(async () => { top.click(); });
}

describe('ReportsModule — Templates actions', () => {
  it('"Save as Template" prompts for a name then persists a template with the report body', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.list).toHaveBeenCalled());
    await openSavedReport();

    await openTemplatesMenu();
    const save = await vi.waitFor(() => {
      const el = container.querySelector('[data-menu-action="templateSave"]') as HTMLButtonElement | null;
      if (!el) throw new Error('Save as Template item not mounted');
      return el;
    });
    await act(async () => { save.click(); });

    await vi.waitFor(() => expect(promptDialog).toHaveBeenCalled());
    await vi.waitFor(() => expect((window as any).api.reports.templates.save).toHaveBeenCalled());
    const t = (window as any).api.reports.templates.save.mock.calls[0][0];
    expect(t.name).toBe('Chain-of-Custody Template');
    expect(t.to).toBe('Det. Vance');
    // The structured recipient contact must round-trip into the template (regression guard: it was
    // dropped, silently losing the recipient the moment a report was saved as a template).
    expect(t.toContactId).toBe('c-to');
    expect(typeof t.id).toBe('string');
  });

  it('"Use Template" clones the selected template into a fresh-id draft report and opens the editor', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.templates.list).toHaveBeenCalled());

    // Dashboard "Use Template" tile → Templates library.
    const useTile = tiles('Use Template').find((b) => b.className.includes('ga98-report-tile'))!;
    expect(useTile.disabled).toBe(false);
    await act(async () => { useTile.click(); });

    // Select the template row → preview, then "Select Template" → create-from-template.
    const row = await vi.waitFor(() => {
      const el = container.querySelector('[data-tpl="tpl1"]') as HTMLElement | null;
      if (!el) throw new Error('template row not mounted');
      return el;
    });
    await act(async () => { row.click(); });
    const select = await vi.waitFor(() => {
      const el = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Select Template')) as HTMLButtonElement | undefined;
      if (!el) throw new Error('Select Template button not mounted');
      return el;
    });
    await act(async () => { select.click(); });

    await vi.waitFor(() => expect((window as any).api.reports.save).toHaveBeenCalled());
    const seed = (window as any).api.reports.save.mock.calls[0][0];
    expect(seed.id).not.toBe('tpl1');
    expect(seed.status).toBe('draft');
    // The template's recipient contact must carry into the new report (regression guard: To was
    // dropped on create-from-template while From carried over).
    expect(seed.toContactId).toBe('c-tpl-to');
    // The banner asset is deep-copied (independent bytes), not reused as-is.
    expect((window as any).api.reports.copyAsset).toHaveBeenCalledWith('banner.png');
    expect(seed.bannerRef).toBe('banner.png-copy');
    // Editor swapped in.
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="To recipient"]')).toBeTruthy());
  });

  it('none of the Templates controls are disabled', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.list).toHaveBeenCalled());

    // Dashboard tile + nav quick-action are live.
    expect(tiles('Use Template').find((b) => b.className.includes('ga98-report-tile'))!.disabled).toBe(false);
    expect(tiles('Use Template').find((b) => b.className.includes('ga98-report-nav-quick-btn'))!.disabled).toBe(false);

    // Menu items live (Save as Template needs an open report — open one first).
    await openSavedReport();
    await openTemplatesMenu();
    await vi.waitFor(() => expect(container.querySelector('[data-menu-action="templateSave"]')).toBeTruthy());
    expect((container.querySelector('[data-menu-action="templateSave"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-menu-action="templateLibrary"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-menu-action="templateUse"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
