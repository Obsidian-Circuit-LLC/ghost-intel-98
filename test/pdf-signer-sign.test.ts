import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { signPdf } from '../src/main/pdf-signer/sign';

// a 1x1 png (same fixture used by board-docx tests)
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function buildFixturePdf(width = 600, height = 800): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

// Pulls the page's content-stream operators back out as text, decoding the
// FlateDecode-wrapped raw stream(s) so the drawImage `cm` transform is visible.
async function contentStreamText(pdfBytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPages()[pageIndex];
  const contents = page.node.normalizedEntries().Contents;
  const refs = Array.isArray((contents as { array?: unknown }).array)
    ? (contents as { array: unknown[] }).array
    : [contents];
  const ctx = doc.context;
  let text = '';
  for (const ref of refs) {
    const stream = ctx.lookup(ref as Parameters<typeof ctx.lookup>[0]);
    if (stream instanceof PDFRawStream) {
      const raw = Buffer.from(stream.getContents());
      text += inflateSync(raw).toString('latin1') + '\n';
    } else {
      const s = stream as { getUnencodedContents(): Uint8Array };
      text += Buffer.from(s.getUnencodedContents()).toString('latin1') + '\n';
    }
  }
  return text;
}

describe('signPdf', () => {
  it('overlays a signature image onto the chosen page and round-trips via PDFDocument.load', async () => {
    const pdfBytes = await buildFixturePdf();
    const png = Buffer.from(PNG_B64, 'base64');
    const signed = await signPdf(pdfBytes, png, 'image/png', {
      page: 0,
      xFrac: 0.5,
      yFrac: 0.1,
      wFrac: 0.2
    });

    // must round-trip through pdf-lib
    const reloaded = await PDFDocument.load(signed);
    expect(reloaded.getPageCount()).toBe(1);

    // the embedded image should have grown the document (image data appended)
    expect(signed.length).toBeGreaterThan(pdfBytes.length);
  });

  it('places the image x-position at half the page width for xFrac 0.5 on a 600pt-wide page', async () => {
    const pdfBytes = await buildFixturePdf(600, 800);
    const png = Buffer.from(PNG_B64, 'base64');
    const signed = await signPdf(pdfBytes, png, 'image/png', {
      page: 0,
      xFrac: 0.5,
      yFrac: 0.1,
      wFrac: 0.2
    });

    // x = xFrac * W = 0.5 * 600 = 300; the `cm` operator's e-component carries the translation.
    const ops = await contentStreamText(signed, 0);
    expect(ops).toMatch(/1 0 0 1 300 \d+(\.\d+)? cm/);
  });

  it('throws "page out of range" when the requested page index does not exist', async () => {
    const pdfBytes = await buildFixturePdf();
    const png = Buffer.from(PNG_B64, 'base64');
    await expect(
      signPdf(pdfBytes, png, 'image/png', { page: 1, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 })
    ).rejects.toThrow('page out of range');
    await expect(
      signPdf(pdfBytes, png, 'image/png', { page: -1, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 })
    ).rejects.toThrow('page out of range');
  });
});
