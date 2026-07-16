import { PDFDocument } from 'pdf-lib';

export interface Placement {
  page: number;
  xFrac: number;
  yFrac: number;
  wFrac: number;
}

/** Overlays a signature image onto one page of a PDF, returning the signed bytes.
 *  Pure — no filesystem/IPC access; the caller reads/writes bytes. `xFrac`/`yFrac`
 *  are top-left-anchored fractions of the page (0..1); the PDF coordinate origin
 *  is bottom-left, so `y` is flipped here. */
export async function signPdf(
  pdfBytes: Uint8Array,
  sigBytes: Uint8Array,
  sigMime: 'image/png' | 'image/jpeg',
  p: Placement
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (!Number.isInteger(p.page) || p.page < 0 || p.page >= pages.length) {
    throw new Error('page out of range');
  }
  const page = pages[p.page];
  const W = page.getWidth();
  const H = page.getHeight();
  const img = sigMime === 'image/png' ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);
  const w = Math.max(1, p.wFrac * W);
  const h = w * (img.height / img.width);
  const x = p.xFrac * W;
  const y = H * (1 - p.yFrac) - h;
  page.drawImage(img, { x, y, width: w, height: h });
  return doc.save();
}
