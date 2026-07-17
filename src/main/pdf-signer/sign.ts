import { PDFDocument, degrees } from 'pdf-lib';

export interface Placement {
  page: number;
  xFrac: number;
  yFrac: number;
  wFrac: number;
}

/** Upper bound on a signature PNG's DECODED pixel count. `ensureAssetInput` caps only the
 *  *compressed* signature at 2 MiB, but a small, highly-compressible PNG can declare enormous
 *  IHDR dimensions that make pdf-lib's `embedPng` (UPNG) allocate multi-GB RGBA buffers on the
 *  main event loop — a decompression bomb. A real signature is tiny; 25 MP is far above any
 *  legitimate capture yet blocks the bomb (25000×25000 ≈ 625 MP would be ~2.5 GB of RGBA). */
export const MAX_SIGNATURE_PIXELS = 25_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads a PNG's IHDR width×height from the header WITHOUT decoding any pixels. Returns null when
 *  the bytes are not a PNG (e.g. a JPEG — whose `embedJpg` path keeps the compressed DCTDecode
 *  bytes and never bulk-decodes, so it isn't a memory-bomb vector). */
function pngPixelCount(bytes: Uint8Array): number | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  // IHDR is the first chunk: 8-byte signature, 4-byte length, "IHDR", then width/height (BE u32).
  const w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const h = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  return w * h;
}

/** Overlays a signature image onto one page of a PDF, returning the signed bytes. Pure — no
 *  filesystem/IPC access; the caller reads/writes bytes.
 *
 *  `xFrac`/`yFrac`/`wFrac` are placement fractions in the renderer's *display* (pdf.js viewport)
 *  space — top-left-anchored, 0..1. Because the renderer renders pages with pdf.js `getViewport`,
 *  which honours the page's `/Rotate`, a 90°/270° page displays with SWAPPED (landscape) dimensions
 *  and the fractions are computed against that rotated space. So this function maps the fractions
 *  back through the page rotation into the unrotated MediaBox (PDF origin is bottom-left, hence the
 *  y-flip) and draws the image counter-rotated by `/Rotate` so it stays upright once the viewer
 *  re-applies the rotation. On a non-rotated page this reduces exactly to `x=xFrac*W`,
 *  `y=H*(1-yFrac)-h`, no rotation. */
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

  // Bound the DECODED PNG size before embedPng — the 2 MiB compressed cap upstream does not bound
  // decoded dimensions, and a tiny PNG can declare a huge IHDR (decompression bomb).
  if (sigMime === 'image/png') {
    const px = pngPixelCount(sigBytes);
    if (px !== null && px > MAX_SIGNATURE_PIXELS) {
      throw new Error('signature image dimensions too large');
    }
  }

  const img = sigMime === 'image/png' ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);

  const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const Wm = page.getWidth();
  const Hm = page.getHeight();
  const landscape = rot === 90 || rot === 270;
  const Wd = landscape ? Hm : Wm; // displayed (pdf.js viewport) width
  const Hd = landscape ? Wm : Hm; // displayed height

  const wd = Math.max(1, p.wFrac * Wd);
  const hd = wd * (img.height / img.width);
  const dx = p.xFrac * Wd;
  const dy = p.yFrac * Hd;
  // Display-space bottom-left corner of the upright signature rectangle (y measured from the top).
  const sx = dx;
  const sy = dy + hd;

  // Inverse of the pdf.js viewport map (display px, y-down → unrotated PDF px, y-up), per rotation.
  let x: number;
  let y: number;
  switch (rot) {
    case 90:
      x = sy;
      y = sx;
      break;
    case 180:
      x = Wm - sx;
      y = sy;
      break;
    case 270:
      x = Wm - sy;
      y = Hm - sx;
      break;
    default:
      x = sx;
      y = Hm - sy;
      break;
  }

  page.drawImage(img, { x, y, width: wd, height: hd, rotate: degrees(rot) });
  return doc.save();
}
