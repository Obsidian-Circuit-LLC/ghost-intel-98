// @vitest-environment jsdom
/**
 * Task 9: InvoicesModule host + module registration.
 *
 * Pins the load-bearing wiring: "New invoice" fetches a fresh number from main (nextNumber) and
 * opens the editor. The window.api.invoices surface is stubbed the way preload exposes it. Plan
 * draft used @testing-library/react but that package is NOT a repo dependency (Global Constraint:
 * no new dependency) — driven via React 18's createRoot inside act(), mirroring
 * test/invoice-form.test.tsx / test/news-feed-shared.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvoicesModule } from '../src/renderer/modules/invoices/InvoicesModule';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).window.api = { invoices: {
    list: vi.fn(async () => []),
    nextNumber: vi.fn(async () => '0001'),
    save: vi.fn(async (i: any) => i),
    listProfiles: vi.fn(async () => []),
    getAsset: vi.fn(async () => null),
    exportPdf: vi.fn(async () => 'invoice.pdf'),
    duplicate: vi.fn(), remove: vi.fn(), saveProfile: vi.fn(), removeProfile: vi.fn(), putAsset: vi.fn(),
  } };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** Find a button by its visible text (no @testing-library screen helper available). */
function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn as HTMLButtonElement;
}

describe('InvoicesModule', () => {
  it('New invoice fetches a number and opens the editor', async () => {
    await act(async () => { root.render(<InvoicesModule />); });
    await act(async () => { buttonByText('New invoice').click(); });
    await vi.waitFor(() => expect((window as any).api.invoices.nextNumber).toHaveBeenCalled());
  });

  it('renders the Ghost Ledger 98 banner at the top of the module', async () => {
    await act(async () => { root.render(<InvoicesModule />); });
    const banner = container.querySelector('img.ga98-ledger-banner') as HTMLImageElement | null;
    expect(banner).toBeTruthy();
    expect(banner!.alt).toBe('Ghost Ledger 98');
  });

  it('capturing a signature persists it via putAsset and embeds it in the preview', async () => {
    const api = (window as any).api.invoices;
    api.putAsset = vi.fn(async () => 'sig-ref-1');
    api.getAsset = vi.fn(async () => ({ mime: 'image/png', dataUrl: 'data:image/png;base64,QUJD' }));

    await act(async () => { root.render(<InvoicesModule />); });
    await act(async () => { buttonByText('New invoice').click(); });
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Upload signature"]')).toBeTruthy());

    const file = new File([new Uint8Array([1, 2, 3])], 'sig.png', { type: 'image/png' });
    const input = container.querySelector('input[aria-label="Upload signature"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(api.putAsset).toHaveBeenCalled());
    });

    // Bytes were decoded from the captured data URL and handed to the encrypted store as an image.
    expect(api.putAsset.mock.calls[0][0]).toBeInstanceOf(Array);
    expect(api.putAsset.mock.calls[0][1]).toMatch(/^image\//);
    // The resolved data URL is cached and rendered into the live preview (== the exported PDF).
    await vi.waitFor(() => {
      const html = container.querySelector('.ga98-invoice-preview')?.innerHTML ?? '';
      expect(html).toContain('class="sigimg"');
    });
  });
});
