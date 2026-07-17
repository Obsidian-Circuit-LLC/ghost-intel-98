import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFRawStream, degrees } from 'pdf-lib';
import { signPdf } from '../src/main/pdf-signer/sign';

interface CmOp { a: number; b: number; c: number; d: number; e: number; f: number }

// Pulls every `cm` (concatenate-matrix) operator out of a content stream as parsed 6-tuples.
// pdf-lib's drawImage emits a translate (`1 0 0 1 x y cm`), a rotate (`cos sin -sin cos 0 0 cm`),
// and a scale (`w 0 0 h 0 0 cm`) — this lets the tests inspect the y-flip and the width scale,
// not just the x-translation.
function parseCmOps(text: string): CmOp[] {
  const re = /([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) cm/g;
  const ops: CmOp[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ops.push({ a: +m[1], b: +m[2], c: +m[3], d: +m[4], e: +m[5], f: +m[6] });
  }
  return ops;
}

const near = (x: number, v: number): boolean => Math.abs(x - v) < 1e-6;
// The translate op: identity linear part (a≈d≈1, b≈c≈0) with a non-zero offset (rules out the
// identity rotate/skew ops, which are `1 0 0 1 0 0 cm`).
const findTranslate = (ops: CmOp[]): CmOp | undefined =>
  ops.find((o) => near(o.a, 1) && near(o.d, 1) && near(o.b, 0) && near(o.c, 0) && (!near(o.e, 0) || !near(o.f, 0)));
// The scale op: diagonal (b≈c≈e≈f≈0) with a≠1 (rules out identity).
const findScale = (ops: CmOp[]): CmOp | undefined =>
  ops.find((o) => near(o.b, 0) && near(o.c, 0) && near(o.e, 0) && near(o.f, 0) && !near(o.a, 1));

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

  it('applies the top-left→bottom-left y-flip and the wFrac width scale (not just the x-translation)', async () => {
    const pdfBytes = await buildFixturePdf(600, 800);
    const png = Buffer.from(PNG_B64, 'base64');
    const signed = await signPdf(pdfBytes, png, 'image/png', {
      page: 0,
      xFrac: 0.5,
      yFrac: 0.1,
      wFrac: 0.2
    });

    const ops = parseCmOps(await contentStreamText(signed, 0));
    const translate = findTranslate(ops);
    expect(translate).toBeDefined();
    // x = xFrac*W = 0.5*600 = 300
    expect(translate!.e).toBeCloseTo(300, 4);
    // y is FLIPPED: H*(1-yFrac) - h = 800*0.9 - 120 = 600. A dropped flip would give H*yFrac = 80.
    expect(translate!.f).toBeCloseTo(600, 4);

    const scale = findScale(ops);
    expect(scale).toBeDefined();
    // width = wFrac*W = 0.2*600 = 120; height = width*(imgH/imgW) = 120 (1x1 png). An ignored
    // wFrac (constant width) would not produce 120 here.
    expect(scale!.a).toBeCloseTo(120, 4);
    expect(scale!.d).toBeCloseTo(120, 4);
  });

  it('honours the page /Rotate (90°): counter-rotates the signature and maps it into the swapped display space', async () => {
    const doc = await PDFDocument.create();
    const pg = doc.addPage([600, 800]);
    pg.setRotation(degrees(90));
    const pdfBytes = await doc.save();
    const png = Buffer.from(PNG_B64, 'base64');

    const signed = await signPdf(pdfBytes, png, 'image/png', {
      page: 0,
      xFrac: 0.5,
      yFrac: 0.1,
      wFrac: 0.2
    });

    const ops = parseCmOps(await contentStreamText(signed, 0));
    // A real 90° rotation operator (b≈1, c≈-1) must be present — proves /Rotate is applied so the
    // signature stays upright once the viewer rotates the page. Unrotated code emits identity here.
    const rotate = ops.find((o) => Math.abs(o.b - 1) < 1e-6 && Math.abs(o.c + 1) < 1e-6);
    expect(rotate, 'expected a 90° rotation cm operator').toBeDefined();

    // On a 90° page the display space is swapped: Wd=H=800, Hd=W=600.
    //   wd = 0.2*800 = 160, hd = 160, dx = 0.5*800 = 400, dy = 0.1*600 = 60,
    //   sx = 400, sy = dy+hd = 220 → anchor (x=sy=220, y=sx=400) in the unrotated MediaBox.
    const translate = findTranslate(ops);
    expect(translate).toBeDefined();
    expect(translate!.e).toBeCloseTo(220, 3);
    expect(translate!.f).toBeCloseTo(400, 3);

    const scale = findScale(ops);
    expect(scale).toBeDefined();
    expect(scale!.a).toBeCloseTo(160, 3);
    expect(scale!.d).toBeCloseTo(160, 3);
  });

  it('rejects a PNG whose IHDR declares bomb-sized dimensions before embedPng decodes it', async () => {
    const pdfBytes = await buildFixturePdf();
    // Minimal PNG header declaring 30000x30000 (0x7530) = 9e8 px — far over the decoded-pixel cap.
    // The bytes stop after IHDR: the guard must fire on the header, before any pixel decode.
    const bomb = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // length=13, "IHDR"
      0x00, 0x00, 0x75, 0x30, // width  = 30000
      0x00, 0x00, 0x75, 0x30, // height = 30000
      0x08, 0x06, 0x00, 0x00, 0x00 // bit depth / colour type / …
    ]);
    await expect(
      signPdf(pdfBytes, bomb, 'image/png', { page: 0, xFrac: 0.1, yFrac: 0.1, wFrac: 0.2 })
    ).rejects.toThrow(/too large/);
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
