// @vitest-environment jsdom
/**
 * Task 6: Signature drawn/uploaded image — editor + module wiring (jsdom half).
 *
 * (c) Capturing a signature (draw or upload, via the shared <SignaturePad>) in the open report
 *     calls putAsset with the decoded bytes and stamps signatureRef onto the working report —
 *     mirroring the banner/logo capture path (invoices' captureSignature / uploadBanner).
 *     Also pins the template round-trip: saveAsTemplate/createFromTemplate carry signatureRef
 *     through copyBody (deep-copied asset, like bannerRef) — the v3.51.0 template-round-trip lesson.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/reports-module.test.tsx / test/invoices-module.test.tsx.
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
  status: 'draft' as const, author: 'Investigator', blocks: [] as any[],
};
const savedTemplate = {
  id: 'tpl1', name: 'Chain of Custody', createdAt: 'a', updatedAt: 'b',
  to: 'PO', signatureRef: 'sig-tpl.png',
  blocks: [{ id: 'blk1', kind: 'text' as const, html: '<p>Body</p>' }],
};

function stubApi(overrides: Record<string, any> = {}): void {
  (globalThis as any).window.api = {
    reports: {
      list: vi.fn(async () => [savedReport]),
      save: vi.fn(async (r: any) => r),
      remove: vi.fn(async () => undefined),
      putAsset: vi.fn(async () => 'sig-ref-1'),
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

async function openSavedReport(): Promise<void> {
  const row = await vi.waitFor(() => {
    const el = container.querySelector('tbody tr[data-report-id="r1"]') as HTMLElement | null;
    if (!el) throw new Error('report row not mounted');
    return el;
  });
  await act(async () => { row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
}

function tiles(text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent || '').includes(text)) as HTMLButtonElement[];
}

async function openTemplatesMenu(): Promise<void> {
  const top = container.querySelector('[data-menu="Templates"]') as HTMLButtonElement;
  await act(async () => { top.click(); });
}

describe('ReportEditor — signature capture (Task 6)', () => {
  it('renders the shared SignaturePad in the open report', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await openSavedReport();
    await vi.waitFor(() => expect(container.querySelector('.ga98-signature-pad')).toBeTruthy());
    expect(container.querySelector('input[aria-label="Upload signature"]')).toBeTruthy();
  });

  it('drawing/uploading a signature persists it via putAsset and stamps signatureRef, embedding the preview', async () => {
    const api = (window as any).api.reports;
    api.putAsset = vi.fn(async () => 'sig-ref-1');
    api.getAsset = vi.fn(async () => ({ mime: 'image/png', dataUrl: 'data:image/png;base64,QUJD' }));

    await act(async () => { root.render(<ReportsModule />); });
    await openSavedReport();

    const input = await vi.waitFor(() => {
      const el = container.querySelector('input[aria-label="Upload signature"]') as HTMLInputElement | null;
      if (!el) throw new Error('signature upload input not mounted');
      return el;
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'sig.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(api.putAsset).toHaveBeenCalled());
    });

    // Bytes were decoded from the captured data URL and handed to the encrypted store as an image.
    expect(api.putAsset.mock.calls[0][0]).toBeInstanceOf(Array);
    expect(api.putAsset.mock.calls[0][1]).toMatch(/^image\//);
    // The resolved data URL is cached and rendered into the signature preview.
    await vi.waitFor(() => {
      expect(container.querySelector('img[alt="Signature"]')).toBeTruthy();
    });
  });
});

describe('ReportsModule — signatureRef template round-trip (Task 6)', () => {
  it('"Save as Template" carries signatureRef into the persisted template', async () => {
    stubApi({ list: vi.fn(async () => [{ ...savedReport, signatureRef: 'sig-report.png' }]) });
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

    await vi.waitFor(() => expect((window as any).api.reports.templates.save).toHaveBeenCalled());
    const t = (window as any).api.reports.templates.save.mock.calls[0][0];
    expect(t.signatureRef).toBe('sig-report.png-copy');
    expect((window as any).api.reports.copyAsset).toHaveBeenCalledWith('sig-report.png');
  });

  it('"Use Template" carries signatureRef into the fresh-id draft report', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.templates.list).toHaveBeenCalled());

    const useTile = tiles('Use Template').find((b) => b.className.includes('ga98-report-tile'))!;
    await act(async () => { useTile.click(); });

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
    expect(seed.signatureRef).toBe('sig-tpl.png-copy');
    expect((window as any).api.reports.copyAsset).toHaveBeenCalledWith('sig-tpl.png');
  });
});
