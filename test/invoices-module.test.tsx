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
});
