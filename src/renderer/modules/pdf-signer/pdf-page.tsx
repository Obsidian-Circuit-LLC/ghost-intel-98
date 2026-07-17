/**
 * Single-page pdf.js renderer, extracted from DocViewerModule's `PdfBody` for reuse by the
 * PDF Signer. DocViewer renders every page of a document plus a selectable text layer; the
 * signer only ever needs ONE page rendered to a canvas at a time (for placing a signature
 * overlay), so this component strips that down: no TextLayer, no multi-page loop — just the
 * chosen page at the chosen scale, plus the resulting viewport size and total page count
 * handed back via `onLoaded` so the caller can do overlay math and page navigation.
 */
import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from '../../lib/pdf-worker?worker';

// Same dedicated-worker setup as DocViewerModule: a worker built from our own entry
// (pdf-worker.ts) so the Uint8Array hex/base64 polyfill is present in the worker realm.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export interface PdfPageInfo {
  canvas: HTMLCanvasElement;
  viewportWidth: number;
  viewportHeight: number;
  pageCount: number;
}

interface PdfPageProps {
  bytes: Uint8Array | null;
  /** 0-based page index; pdf.js pages are 1-indexed internally. */
  pageIndex: number;
  scale: number;
  onLoaded?: (info: PdfPageInfo) => void;
  onError?: (message: string) => void;
}

export function PdfPage({ bytes, pageIndex, scale, onLoaded, onError }: PdfPageProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Copy into a fresh buffer — pdf.js may detach the one it's handed.
    const data = bytes.slice();
    void (async () => {
      try {
        // CSP forbids eval, so pdf.js auto-detects and avoids it — no isEvalSupported flag needed.
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // pdf.js 5.x: hand it the canvas element and let it derive the 2D context (passing
        // both `canvas` and `canvasContext` is rejected in v5).
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        onLoaded?.({ canvas, viewportWidth: viewport.width, viewportHeight: viewport.height, pageCount: pdf.numPages });
      } catch (e) {
        if (!cancelled) onError?.((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, pageIndex, scale]);

  return <canvas ref={canvasRef} style={{ display: 'block', boxShadow: '0 0 4px rgba(0,0,0,0.4)' }} />;
}
