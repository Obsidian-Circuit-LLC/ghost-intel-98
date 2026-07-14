// @vitest-environment jsdom
/**
 * T5: PDF pages get a selectable text layer over the rendered canvas.
 *
 * pdf.js 5.x renders a page to a <canvas> (pixels, not selectable). To let the user select and
 * copy PDF text we overlay a pdf.js `TextLayer` — a div of absolutely-positioned transparent
 * spans — on top of the canvas, marked `.ga98-pdf-textlayer .ga98-selectable`. A text-layer
 * failure must never blank the page canvas, so the render is guarded.
 *
 * jsdom can't run real pdf.js/canvas, so pdfjs-dist is fully mocked: a one-page document whose
 * page exposes getViewport/render/streamTextContent, plus a fake TextLayer class we assert against.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Hoisted so the vi.mock factory (itself hoisted to top of file) can close over them.
const hoisted = vi.hoisted(() => {
  const textLayerRender = vi.fn().mockResolvedValue(undefined);
  const state: { args: { textContentSource: unknown; container: HTMLElement; viewport: unknown } | null } = { args: null };
  class FakeTextLayer {
    constructor(opts: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) {
      state.args = opts;
    }
    render(): Promise<void> { return textLayerRender(); }
  }
  const getDocument = vi.fn();
  return { textLayerRender, state, FakeTextLayer, getDocument };
});
const { textLayerRender, state, getDocument } = hoisted;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a: unknown[]) => hoisted.getDocument(...a),
  TextLayer: hoisted.FakeTextLayer
}));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { DocViewerModule } from '../src/renderer/modules/doc-viewer/DocViewerModule';

const readBytes = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    documents: { readBytes, export: vi.fn() },
    files: { readEml: vi.fn(), revealAttachment: vi.fn() }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  state.args = null;
});

async function flush(): Promise<void> {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

function mockOnePagePdf(): { streamTextContent: () => unknown } {
  const streamTextContent = vi.fn(() => ({ __stream: true }));
  const page = {
    getViewport: () => ({ width: 100, height: 120 }),
    render: () => ({ promise: Promise.resolve() }),
    streamTextContent
  };
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) }) });
  return page;
}

describe('DocViewerModule — PDF text layer', () => {
  it('overlays a selectable text layer div on the page canvas', async () => {
    mockOnePagePdf();
    const bytes = Array.from(new TextEncoder().encode('%PDF-1.4 fake'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="a.pdf" name="a.pdf" />); });
    await flush();

    const textDiv = container.querySelector('.ga98-pdf-textlayer');
    expect(textDiv).toBeTruthy();
    expect(textDiv!.className).toContain('ga98-selectable');
    // The text layer sits inside a positioned page wrapper alongside the canvas.
    const wrap = textDiv!.parentElement!;
    expect(wrap.querySelector('canvas')).toBeTruthy();
    expect(textLayerRender).toHaveBeenCalled();
    expect(state.args).not.toBeNull();
    expect(state.args!.container).toBe(textDiv);
  });

  it('a text-layer failure does not blank the page canvas', async () => {
    mockOnePagePdf();
    textLayerRender.mockRejectedValueOnce(new Error('boom'));
    const bytes = Array.from(new TextEncoder().encode('%PDF-1.4 fake'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="a.pdf" name="a.pdf" />); });
    await flush();

    // Canvas still present; the viewer did not fall into the "Could not render PDF" error state.
    expect(container.querySelector('canvas')).toBeTruthy();
    expect(container.textContent).not.toContain('Could not render PDF');
  });
});
