// @vitest-environment jsdom
/**
 * T2: My Documents internal viewer (documents source).
 *
 * DocViewerModule gained a discriminated `source` union. The `documents` source reads decrypted
 * bytes in-process via window.api.documents.readBytes (never an OS handoff) and renders them
 * through the same byte pipeline the `case` source uses. A type the pipeline can't render (an
 * archive, media, …) shows a "Can't preview" panel with an Export… button (documents:export).
 *
 * No @testing-library — drive React 18's createRoot inside act(), mirroring my-documents-module.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// pdfjs-dist uses DOMMatrix (unavailable in jsdom); stub it out. DocViewerModule sets
// GlobalWorkerOptions.workerPort at import time, so the object must exist.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
// pdf-worker?worker → a WorkerWrapper calling `new Worker` (undefined in node). Mock the
// absolute resolved specifier (same trick as register-builtins.test.ts).
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
// mammoth (DOCX → HTML) — only loaded lazily, but mock defensively.
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { DocViewerModule } from '../src/renderer/modules/doc-viewer/DocViewerModule';

const readBytes = vi.fn();
const exportFn = vi.fn().mockResolvedValue(undefined);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    documents: { readBytes, export: exportFn }
  };
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('DocViewerModule (documents source)', () => {
  it('renders a text file from decrypted bytes read in-process', async () => {
    const bytes = Array.from(new TextEncoder().encode('hello from my documents'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="notes.txt" name="notes.txt" />); });
    await flush();
    expect(readBytes).toHaveBeenCalledWith('notes.txt');
    expect(container.textContent).toContain('hello from my documents');
  });

  it('shows a Can\'t-preview panel with Export for an unsupported type', async () => {
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="a/archive.zip" name="archive.zip" />); });
    await flush();
    // No byte load for an unsupported type — straight to the Export fallback.
    expect(readBytes).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Can't preview");
    const exportBtn = [...container.querySelectorAll('button')].find((b) => /export/i.test(b.textContent ?? ''));
    expect(exportBtn).toBeTruthy();
    await act(async () => { exportBtn!.click(); });
    await flush();
    expect(exportFn).toHaveBeenCalledWith('a/archive.zip');
  });
});
