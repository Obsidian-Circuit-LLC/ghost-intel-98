// @vitest-environment jsdom
/**
 * Task 8: InvoiceForm component (editor + live preview).
 *
 * Pins the two load-bearing behaviours: the live grand total (3.5h*20=70 +10% tax = 77) and that
 * editing the flat rate emits an updated invoice. Plan draft used @testing-library/react but that
 * package is NOT a repo dependency (Global Constraint: no new dependency) — driven via React 18's
 * createRoot inside act(), mirroring test/invoice-line-item-table.test.tsx / test/news-feed-shared.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvoiceForm } from '../src/renderer/modules/invoices/InvoiceForm';
import type { Invoice } from '../src/shared/invoice-types';

let container: HTMLDivElement;
let root: Root;

const inv: Invoice = {
  id: 'i1', number: '0001', issueDate: '2026-07-08', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'GI' }, client: { name: 'C', company: 'Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }],
  createdAt: 'x', updatedAt: 'x',
};

/** Set a React-controlled <input>'s value the way a real keystroke would (native setter + input event). */
function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

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

describe('InvoiceForm', () => {
  it('renders the live grand total (3.5h*20=70 +10% = 77)', async () => {
    await act(async () => {
      root.render(<InvoiceForm invoice={inv} assets={{}} onChange={() => {}} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    expect(container.textContent).toMatch(/77/);
  });

  it('editing the rate emits an updated invoice', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<InvoiceForm invoice={inv} assets={{}} onChange={onChange} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    const rate = container.querySelector('input[aria-label="Rate"]') as HTMLInputElement;
    await act(async () => { typeInto(rate, '40'); });
    expect(onChange.mock.calls[0][0].rate).toBe(40);
  });

  it('shows a logo preview + Remove that clears the ref', async () => {
    const onChange = vi.fn();
    const withLogo = { ...inv, sender: { ...inv.sender, logoRef: 'a.png' } };
    await act(async () => {
      root.render(<InvoiceForm invoice={withLogo} assets={{ 'a.png': 'data:image/png;base64,AAA' }}
        onChange={onChange} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    const img = container.querySelector('img[alt="From logo"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('data:image/png;base64,AAA');
    const removeBtn = container.querySelector('[aria-label="Remove From logo"]') as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    await act(async () => { removeBtn.click(); });
    expect(onChange.mock.calls[0][0].sender.logoRef).toBeUndefined();
  });

  it('shows "No logo" when there is no logoRef', async () => {
    await act(async () => {
      root.render(<InvoiceForm invoice={inv} assets={{}} onChange={() => {}} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    expect(container.querySelector('img[alt="From logo"]')).toBeNull();
    expect(container.textContent).toMatch(/No logo/);
  });

  it('shows a signature preview + Remove that clears the ref', async () => {
    const onChange = vi.fn();
    const withSig = { ...inv, signature: { signerName: 'Me', signatureRef: 's.png' } };
    await act(async () => {
      root.render(<InvoiceForm invoice={withSig} assets={{ 's.png': 'data:image/png;base64,BBB' }}
        onChange={onChange} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    const img = container.querySelector('img[alt="Signature"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('data:image/png;base64,BBB');
    const removeBtn = container.querySelector('[aria-label="Remove signature"]') as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    await act(async () => { removeBtn.click(); });
    expect(onChange.mock.calls[0][0].signature.signatureRef).toBeUndefined();
  });

  it('shows "No signature" when there is no signatureRef', async () => {
    await act(async () => {
      root.render(<InvoiceForm invoice={inv} assets={{}} onChange={() => {}} onUploadLogo={() => {}} onCaptureSignature={() => {}} />);
    });
    expect(container.querySelector('img[alt="Signature"]')).toBeNull();
    expect(container.textContent).toMatch(/No signature/);
  });
});
