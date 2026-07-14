// @vitest-environment jsdom
/**
 * T4: Doc-viewer bodies opt back into text selection.
 *
 * The app is globally `user-select: none` (theme.css); `.ga98-selectable` opts an element's text
 * back into selection/copy. The viewer's text/JSON/CSV/HTML(+docx/eml) bodies must carry that
 * class on their content container so a user can select and copy what they're reading — without
 * it landing on any draggable chrome (that's a whiteboard concern, not this one).
 *
 * Same drive pattern as doc-viewer-documents.test.tsx: React 18 createRoot inside act(), pdfjs-dist
 * and mammoth mocked out (jsdom can't run them).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { DocViewerModule } from '../src/renderer/modules/doc-viewer/DocViewerModule';

const readBytes = vi.fn();
const readEml = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    documents: { readBytes, export: vi.fn() },
    files: { readEml, revealAttachment: vi.fn() }
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

describe('DocViewerModule — selectable bodies', () => {
  it('TextBody <pre> carries ga98-selectable', async () => {
    const bytes = Array.from(new TextEncoder().encode('plain text content'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="notes.txt" name="notes.txt" />); });
    await flush();
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.className).toContain('ga98-selectable');
  });

  it('JsonBody <pre> carries ga98-selectable', async () => {
    const bytes = Array.from(new TextEncoder().encode('{"a":1}'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="data.json" name="data.json" />); });
    await flush();
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.className).toContain('ga98-selectable');
  });

  it('CsvBody table wrapper carries ga98-selectable', async () => {
    const bytes = Array.from(new TextEncoder().encode('a,b\n1,2\n'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="data.csv" name="data.csv" />); });
    await flush();
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    const wrapper = table!.parentElement;
    expect(wrapper!.className).toContain('ga98-selectable');
  });

  it('SanitizedHtml (html) div carries ga98-selectable', async () => {
    const bytes = Array.from(new TextEncoder().encode('<p>hello html</p>'));
    readBytes.mockResolvedValueOnce(bytes);
    await act(async () => { root.render(<DocViewerModule source="documents" relPath="page.html" name="page.html" />); });
    await flush();
    const div = [...container.querySelectorAll('div')].reverse().find((d) => d.textContent?.includes('hello html'));
    expect(div).toBeTruthy();
    expect(div!.className).toContain('ga98-selectable');
  });

  it('EmlBody plain-text fallback <pre> carries ga98-selectable', async () => {
    readEml.mockResolvedValueOnce({
      from: 'a@example.com', to: 'b@example.com', cc: '', subject: 'Plain text msg',
      date: '', headers: [], text: 'plain body content', html: null, attachments: []
    });
    await act(async () => { root.render(<DocViewerModule source="case" caseId="case-1" fileName="msg.eml" />); });
    await flush();
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('plain body content');
    expect(pre!.className).toContain('ga98-selectable');
  });
});
