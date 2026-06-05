/**
 * Extract the text layer from a PDF's bytes, for feeding PDF case attachments to the AI.
 *
 * Text-layer only — no OCR. A scanned/image-only PDF yields little or no text; the caller treats
 * an empty result as "no extractable text". Runs entirely offline through the same pdf.js worker
 * + polyfills the in-app viewer uses; no network, no file:// URLs.
 *
 * The pure item-joining lives in pdfText.ts (unit-tested); this module is the pdfjs orchestration.
 */
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from './pdf-worker?worker';
import { joinPdfTextItems, type PdfTextItem } from './pdfText';

function ensureWorker(): void {
  if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
}

/** Concatenate the text layer across pages, stopping once `maxChars` is reached. Returns '' for
 *  a PDF with no extractable text (e.g. a scan). */
export async function extractPdfText(bytes: Uint8Array, opts: { maxChars?: number } = {}): Promise<string> {
  const maxChars = opts.maxChars ?? 200_000;
  ensureWorker();
  // pdf.js may detach the buffer it's handed — give it a private copy.
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    const pages: string[] = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const text = joinPdfTextItems(tc.items as PdfTextItem[]);
      pages.push(text);
      total += text.length;
      if (total >= maxChars) break;
    }
    return pages.join('\n').slice(0, maxChars);
  } finally {
    await pdf.destroy().catch(() => { /* best-effort cleanup */ });
  }
}
