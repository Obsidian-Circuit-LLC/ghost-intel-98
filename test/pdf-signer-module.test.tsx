// @vitest-environment jsdom
/**
 * Task 6: `PdfSignerModule` + Organizer registration.
 *
 * Composes the T4 `PdfPage` renderer, the T5 placement helpers, the shared `SignaturePad`, and the
 * T3 `pdfsign` IPC surface into the standalone module: "Open PDF…" reads a picked path through
 * `pdfsign:read` (capped, transient — never written to the vault); a captured signature shows a
 * draggable overlay on the rendered page; "Sign & Save" is gated on having BOTH a PDF and a
 * signature and calls `pdfsign:sign` with the exact `{ pdfBytes, signatureDataUrl, placement }`
 * shape the main-side handler expects.
 *
 * jsdom can't run real pdf.js/canvas, so pdfjs-dist + the worker entry are mocked the same way
 * test/pdf-signer-page.test.tsx and test/osint-toolkit-module-registered.test.ts do it; the latter's
 * mammoth/maplibre-gl stubs are also needed here because `registerBuiltins()` transitively imports
 * every built-in module (DocViewer/GeoInt among them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const hoisted = vi.hoisted(() => ({ getDocument: vi.fn() }));
const { getDocument } = hoisted;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a: unknown[]) => hoisted.getDocument(...a)
}));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));
vi.mock('maplibre-gl', () => {
  class Noop { constructor(..._a: unknown[]) {} on() { return this; } off() { return this; } addTo() { return this; } remove() {} setLngLat() { return this; } }
  const api = { Map: Noop, Marker: Noop, Popup: Noop, NavigationControl: Noop, LngLatBounds: Noop, LngLat: Noop };
  return { default: api, ...api };
});

import { PdfSignerModule } from '../src/renderer/modules/pdf-signer/PdfSignerModule';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';

let container: HTMLDivElement;
let root: Root;

const api = {
  files: { pickOpen: vi.fn() },
  pdfsign: { read: vi.fn(), sign: vi.fn() }
};

function mockPdf(pageCount = 1): void {
  const pages = Array.from({ length: pageCount }, () => ({
    getViewport: vi.fn((o: { scale: number }) => ({ width: 600 * o.scale, height: 800 * o.scale })),
    render: vi.fn(() => ({ promise: Promise.resolve() }))
  }));
  const getPage = vi.fn((n: number) => Promise.resolve(pages[n - 1]));
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pageCount, getPage }) });
}

beforeEach(() => {
  api.files.pickOpen.mockReset().mockResolvedValue(['/tmp/x/contract.pdf']);
  api.pdfsign.read.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.pdfsign.sign.mockReset().mockResolvedValue({ saved: true });
  (globalThis as unknown as { window: { api: unknown } }).window.api = api;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

function findButton(pattern: RegExp): HTMLButtonElement {
  const el = [...container.querySelectorAll('button')].find((b) => pattern.test(b.textContent ?? ''));
  if (!el) throw new Error(`button matching ${pattern} not found`);
  return el as HTMLButtonElement;
}

// SignaturePad's canvas draw path calls `getContext('2d')` unguarded, which this jsdom returns
// `null` for (no `canvas` package installed) — same reason test/invoice-signature-pad.test.tsx
// only ever exercises Upload/Clear, never a real pointer-drawn stroke. So capture via Upload.
//
// The resulting `onCapture` fires from FileReader's `onload`, a real macrotask OUTSIDE this
// dispatch's call stack — the `vi.waitFor` that observes the resulting re-render must NOT be
// nested inside the same `act()` as the dispatch: `act()` defers flushing any updates scheduled
// during its callback until that callback's own promise resolves, so a `vi.waitFor` awaited INSIDE
// the same `act()` call deadlocks (it can never see the update `act()` itself is holding back).
async function openPdfAndCaptureSignature(): Promise<void> {
  mockPdf(1);
  await act(async () => { root.render(<PdfSignerModule />); });
  await flush();
  await act(async () => { findButton(/open pdf/i).click(); });
  await flush();
  await flush();

  const file = new File([new Uint8Array([1, 2, 3])], 'sig.png', { type: 'image/png' });
  const input = container.querySelector('input[aria-label="Upload signature"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await vi.waitFor(() => expect(container.querySelector('.ga98-pdfsign-overlay')).toBeTruthy());
}

describe('PdfSignerModule registration', () => {
  it('registers under "pdf-signer"', () => {
    registerBuiltins();
    const m = getModule('pdf-signer');
    expect(m).toBeTruthy();
    expect(m?.title).toBe('PDF Signer');
    expect(typeof m?.component).toBe('function');
  });
});

describe('PdfSignerModule', () => {
  it('"Open PDF…" picks a file then reads it via pdfsign.read', async () => {
    mockPdf(1);
    await act(async () => { root.render(<PdfSignerModule />); });
    await flush();
    await act(async () => { findButton(/open pdf/i).click(); });
    await flush();
    expect(api.files.pickOpen).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.any(Array) }));
    expect(api.pdfsign.read).toHaveBeenCalledWith('/tmp/x/contract.pdf');
  });

  it('Sign & Save is disabled with no PDF and no signature', async () => {
    await act(async () => { root.render(<PdfSignerModule />); });
    await flush();
    expect(findButton(/sign.*save/i).disabled).toBe(true);
  });

  it('Sign & Save stays disabled with a PDF but no signature yet', async () => {
    mockPdf(1);
    await act(async () => { root.render(<PdfSignerModule />); });
    await flush();
    await act(async () => { findButton(/open pdf/i).click(); });
    await flush();
    expect(findButton(/sign.*save/i).disabled).toBe(true);
  });

  it('capturing a signature shows a draggable overlay on the page and enables Sign & Save', async () => {
    await openPdfAndCaptureSignature();
    const overlay = container.querySelector('.ga98-pdfsign-overlay');
    expect(overlay).toBeTruthy();
    expect(findButton(/sign.*save/i).disabled).toBe(false);
  });

  it('Sign & Save calls pdfsign.sign with pdfBytes/signatureDataUrl/placement', async () => {
    await openPdfAndCaptureSignature();
    await act(async () => { findButton(/sign.*save/i).click(); });
    await flush();

    expect(api.pdfsign.sign).toHaveBeenCalledWith(expect.objectContaining({
      pdfBytes: expect.any(Uint8Array),
      signatureDataUrl: expect.stringMatching(/^data:/),
      placement: expect.objectContaining({
        page: 0,
        xFrac: expect.any(Number),
        yFrac: expect.any(Number),
        wFrac: expect.any(Number)
      })
    }));
  });
});
