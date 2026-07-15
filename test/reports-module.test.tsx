// @vitest-environment jsdom
/**
 * Task 5: ReportsModule host + fixed header (banner / From / To) + ContactBook.
 *
 * Render smoke test — pins the load-bearing shell wiring: the module lists saved reports and can
 * open the editor, whose fixed header exposes a banner slot, a From <select> of contacts, and a To
 * <input>; the ContactBook lists a saved contact and persists a new one via reports.contacts.save.
 *
 * No @testing-library/react (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/invoices-module.test.tsx. window.api.reports is stubbed
 * the way preload exposes it (flat CRUD + nested contacts/descriptors).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportsModule } from '../src/renderer/modules/reports/ReportsModule';
import { ContactBook } from '../src/renderer/modules/reports/ContactBook';
import { toast } from '../src/renderer/state/toasts';

let container: HTMLDivElement;
let root: Root;

const savedReport = {
  id: 'r1', title: 'Case 42', createdAt: 't', updatedAt: 't', to: 'Det. Vance', blocks: [] as any[],
};
const savedContact = { id: 'c1', name: 'A. Investigator', org: 'Ghost Intel' };

function stubApi(overrides: Record<string, any> = {}): void {
  (globalThis as any).window.api = { reports: {
    list: vi.fn(async () => [savedReport]),
    save: vi.fn(async (r: any) => r),
    remove: vi.fn(async () => undefined),
    putAsset: vi.fn(async () => 'banner-ref-1'),
    getAsset: vi.fn(async () => null),
    exportPdf: vi.fn(async () => 'r.pdf'),
    exportDocx: vi.fn(async () => 'r.docx'),
    contacts: {
      list: vi.fn(async () => [savedContact]),
      save: vi.fn(async (c: any) => c),
      remove: vi.fn(async () => undefined),
    },
    descriptors: {
      list: vi.fn(async () => []),
      save: vi.fn(async (d: any) => d),
      remove: vi.fn(async () => undefined),
    },
    ...overrides,
  } };
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

/** Set a React-controlled <input>'s value the way a real keystroke would (native setter + input event). */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn as HTMLButtonElement;
}

/** Simulate a file pick on a <input type=file> the way a real selection would (set .files + change). */
function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ReportsModule', () => {
  it('lists saved reports and opens the editor header (banner / From / To)', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await vi.waitFor(() => expect((window as any).api.reports.list).toHaveBeenCalled());

    // Open the saved report into the editor.
    await act(async () => { buttonByText('Case 42').click(); });

    await vi.waitFor(() => {
      expect(container.querySelector('.ga98-report-banner')).toBeTruthy();
      expect(container.querySelector('select[aria-label="From contact"]')).toBeTruthy();
      expect(container.querySelector('input[aria-label="To recipient"]')).toBeTruthy();
    });
  });

  it('New report seeds + saves a report and opens it', async () => {
    await act(async () => { root.render(<ReportsModule />); });
    await act(async () => { buttonByText('New report').click(); });
    await vi.waitFor(() => expect((window as any).api.reports.save).toHaveBeenCalled());
  });

  it('toasts an error when an over-cap photo upload rejects (putAsset >2 MB)', async () => {
    // Main rejects the oversized asset (ensureAssetInput cap); the renderer must surface it, not
    // swallow the rejection as an unhandled void promise.
    stubApi({ putAsset: vi.fn(async () => { throw new Error('asset too large (max 2MB)'); }) });
    const errSpy = vi.spyOn(toast, 'error');

    await act(async () => { root.render(<ReportsModule />); });
    await act(async () => { buttonByText('Case 42').click(); });

    const input = await vi.waitFor(() => {
      const el = container.querySelector('input[aria-label="Add photo"]') as HTMLInputElement | null;
      if (!el) throw new Error('add-photo input not mounted');
      return el;
    });
    await act(async () => { pickFile(input, new File([new Uint8Array(10)], 'big.jpg', { type: 'image/jpeg' })); });

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect((window as any).api.reports.putAsset).toHaveBeenCalled();
  });

  it('toasts an error when an over-cap banner upload rejects (putAsset >2 MB)', async () => {
    stubApi({ putAsset: vi.fn(async () => { throw new Error('asset too large (max 2MB)'); }) });
    const errSpy = vi.spyOn(toast, 'error');

    await act(async () => { root.render(<ReportsModule />); });
    await act(async () => { buttonByText('Case 42').click(); });

    const input = await vi.waitFor(() => {
      const el = container.querySelector('input[aria-label="Upload banner"]') as HTMLInputElement | null;
      if (!el) throw new Error('banner input not mounted');
      return el;
    });
    await act(async () => { pickFile(input, new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })); });

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect((window as any).api.reports.putAsset).toHaveBeenCalled();
  });
});

describe('ContactBook', () => {
  it('lists a saved contact and persists a new one via reports.contacts.save', async () => {
    const onUse = vi.fn();
    await act(async () => { root.render(<ContactBook onUse={onUse} onClose={() => {}} />); });
    await vi.waitFor(() => expect(container.textContent).toContain('A. Investigator'));

    // Add a fresh contact.
    await act(async () => { buttonByText('Add contact').click(); });
    const nameInput = container.querySelector('input[aria-label="Contact name"]') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    await act(async () => { typeInto(nameInput, 'New Person'); });
    await act(async () => { buttonByText('Save contact').click(); });
    await vi.waitFor(() => expect((window as any).api.reports.contacts.save).toHaveBeenCalled());
    expect((window as any).api.reports.contacts.save.mock.calls[0][0].name).toBe('New Person');
  });
});
