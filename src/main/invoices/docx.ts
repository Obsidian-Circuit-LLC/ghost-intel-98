/** Builds a real, editable OOXML .docx (a ZIP of XML parts) from a structured Invoice, using adm-zip
 *  (already a dep). Numbers reuse calc.ts so they foot with the PDF. All user text is XML-escaped.
 *  Images (logos/signature) become word/media parts + inline DrawingML runs. */
import AdmZip from 'adm-zip';
import type { Invoice } from '@shared/invoice-types';
import { lineHours, round2, computeTotals, formatMoney } from '../../renderer/modules/invoices/calc';

const EMU_PER_PX = 9525; // 1px @96dpi = 9525 EMU

function esc(s: string | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}
/** Read intrinsic pixel size from PNG (IHDR) or JPEG (SOF); fall back to 120x60 if unparseable. */
function imageSize(bytes: Buffer, mime: string): { w: number; h: number } {
  try {
    if (mime === 'image/png') return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
    // JPEG: scan for an SOF marker
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  } catch { /* fall through */ }
  return { w: 120, h: 60 };
}
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(image\/(png|jpe?g));base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], bytes: Buffer.from(m[3], 'base64') };
}

interface Media { rId: string; part: string; ext: string; bytes: Buffer; cx: number; cy: number }

function para(runs: string, pPr = ''): string { return `<w:p>${pPr}${runs}</w:p>`; }
function textRun(text: string, opts?: { bold?: boolean; size?: number }): string {
  const rPr = `<w:rPr>${opts?.bold ? '<w:b/>' : ''}${opts?.size ? `<w:sz w:val="${opts.size}"/>` : ''}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function imageRun(m: Media, id: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${m.cx}" cy="${m.cy}"/>`
    + `<wp:docPr id="${id}" name="img${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
function cell(inner: string): string { return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${inner}</w:tc>`; }
function rowOf(cells: string[]): string { return `<w:tr>${cells.map((c) => cell(c)).join('')}</w:tr>`; }

export function renderInvoiceDocx(invoice: Invoice, assets: Record<string, string>): Buffer {
  const { currency, rate, taxPct } = invoice;
  const media: Media[] = [];
  const addImage = (ref?: string): Media | null => {
    if (!ref || !assets[ref]) return null;
    const d = decodeDataUrl(assets[ref]);
    if (!d) return null;
    const { w, h } = imageSize(d.bytes, d.mime);
    const maxW = 130; const scale = w > maxW ? maxW / w : 1;
    const ext = d.mime === 'image/png' ? 'png' : 'jpg';
    const m: Media = { rId: `rIdImg${media.length + 1}`, part: `word/media/image${media.length + 1}.${ext}`, ext, bytes: d.bytes,
      cx: Math.round(w * scale * EMU_PER_PX), cy: Math.round(h * scale * EMU_PER_PX) };
    media.push(m); return m;
  };
  const senderLogo = addImage(invoice.sender.logoRef);
  const clientLogo = addImage(invoice.client.logoRef);
  const sigImg = addImage(invoice.signature?.signatureRef);
  let imgId = 1;

  const t = computeTotals(invoice.lines, rate, taxPct);
  const headRow = rowOf(['Date', 'Time', 'Description', 'Hours', 'Amount'].map((h) => para(textRun(h, { bold: true }))));
  const lineRows = invoice.lines.map((l) => {
    const h = lineHours(l);
    return rowOf([
      para(textRun(l.date)), para(textRun(`${l.start}–${l.end}`)), para(textRun(l.description)),
      para(textRun(String(h))), para(textRun(formatMoney(round2(h * rate), currency))),
    ]);
  }).join('');
  const tableXml = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')}</w:tblBorders>`
    + `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1800"/>'.repeat(5)}</w:tblGrid>${headRow}${lineRows}</w:tbl>`;

  const body = [
    para(textRun(`INVOICE ${invoice.number}`, { bold: true, size: 40 })),
    para(textRun(`Date: ${invoice.issueDate}`)),
    senderLogo ? para(imageRun(senderLogo, imgId++)) : '',
    para(textRun('From', { bold: true })), para(textRun(invoice.sender.name)), para(textRun(invoice.sender.company)),
    para(textRun('To', { bold: true })), para(textRun(invoice.client.name)), para(textRun(invoice.client.company)),
    clientLogo ? para(imageRun(clientLogo, imgId++)) : '',
    tableXml,
    para(textRun(`Total hours: ${t.totalHours}`)),
    para(textRun(`Subtotal: ${formatMoney(t.subtotal, currency)}`)),
    taxPct ? para(textRun(`Tax: ${formatMoney(t.tax, currency)}`)) : '',
    para(textRun(`Total: ${formatMoney(t.total, currency)}`, { bold: true })),
    invoice.notes ? para(textRun(`Notes: ${invoice.notes}`)) : '',
    sigImg ? para(imageRun(sigImg, imgId++)) : '',
    invoice.signature?.signerName ? para(textRun(`${invoice.signature.signerName}  ${invoice.signature.signedDate ?? ''}  (Signature)`)) : '',
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${m.part.split('image')[1]}"/>`).join('')
    + `</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf8'));
  for (const m of media) zip.addFile(m.part, m.bytes);
  return zip.toBuffer();
}
