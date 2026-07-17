// @vitest-environment jsdom
/**
 * T4: `PdfPage` — single-page pdf.js renderer reused by the PDF Signer.
 *
 * Extracted from DocViewerModule's PdfBody (which renders every page + a selectable text
 * layer). The signer only needs ONE page rendered to a canvas at a time, plus the resulting
 * viewport size and total page count, so a caller can do overlay math and page navigation.
 * No TextLayer here — the signer overlays a draggable signature image, not selectable text.
 *
 * jsdom can't run real pdf.js/canvas, so pdfjs-dist is fully mocked (same pattern as
 * doc-viewer-pdf-textlayer.test.tsx): a fake document whose page count and per-page
 * getViewport/render are configurable per test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const hoisted = vi.hoisted(() => ({ getDocument: vi.fn() }));
const { getDocument } = hoisted;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a: unknown[]) => hoisted.getDocument(...a)
}));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));

import { PdfPage } from '../src/renderer/modules/pdf-signer/pdf-page';

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
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

interface FakePage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void> };
}

function mockPdf(pageCount: number): { pages: FakePage[]; getPage: ReturnType<typeof vi.fn> } {
  const pages: FakePage[] = Array.from({ length: pageCount }, () => ({
    getViewport: vi.fn((opts: { scale: number }) => ({ width: 100 * opts.scale, height: 120 * opts.scale })),
    render: vi.fn(() => ({ promise: Promise.resolve() }))
  }));
  const getPage = vi.fn((n: number) => Promise.resolve(pages[n - 1]));
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pageCount, getPage }) });
  return { pages, getPage };
}

describe('PdfPage', () => {
  it('renders the requested page to a canvas and reports viewport dims + page count', async () => {
    const { getPage } = mockPdf(3);
    const bytes = new Uint8Array([1, 2, 3]);
    const onLoaded = vi.fn();
    await act(async () => {
      root.render(<PdfPage bytes={bytes} pageIndex={0} scale={1.5} onLoaded={onLoaded} />);
    });
    await flush();

    // pdf.js pages are 1-indexed; pageIndex 0 -> getPage(1).
    expect(getPage).toHaveBeenCalledWith(1);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(onLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, viewportWidth: 150, viewportHeight: 180, pageCount: 3 })
    );
  });

  it('page navigation re-fetches and renders the newly selected page (1-indexed to pdf.js)', async () => {
    const { getPage } = mockPdf(3);
    const bytes = new Uint8Array([1, 2, 3]);
    await act(async () => {
      root.render(<PdfPage bytes={bytes} pageIndex={0} scale={1} />);
    });
    await flush();
    expect(getPage).toHaveBeenCalledWith(1);

    await act(async () => {
      root.render(<PdfPage bytes={bytes} pageIndex={2} scale={1} />);
    });
    await flush();
    expect(getPage).toHaveBeenCalledWith(3);
  });

  it('sizes the canvas from the viewport and calls page.render with that canvas', async () => {
    const { pages } = mockPdf(1);
    const bytes = new Uint8Array([1, 2, 3]);
    await act(async () => {
      root.render(<PdfPage bytes={bytes} pageIndex={0} scale={2} />);
    });
    await flush();

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(240);
    expect(pages[0].render).toHaveBeenCalledWith(expect.objectContaining({ canvas }));
  });

  it('reports a render error via onError instead of throwing', async () => {
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('bad pdf')) });
    const bytes = new Uint8Array([1, 2, 3]);
    const onError = vi.fn();
    await act(async () => {
      root.render(<PdfPage bytes={bytes} pageIndex={0} scale={1} onError={onError} />);
    });
    await flush();

    expect(onError).toHaveBeenCalledWith('bad pdf');
  });
});
