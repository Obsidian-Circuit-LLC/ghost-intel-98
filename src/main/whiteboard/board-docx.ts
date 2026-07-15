/**
 * Whiteboard → DOCX: a real, editable OOXML .docx (a ZIP of XML parts) built with adm-zip, mirroring
 * `src/main/invoices/docx.ts`. The rasterized board snapshot becomes a `word/media` part + an inline
 * DrawingML run; a plain node/edge appendix follows. Node text is untrusted free-form user input, so
 * every value crosses an XML-escape boundary (`esc`) before interpolation — this file owns that
 * boundary for board DOCX exports (the main process has no DOM, so DOMPurify is not applicable here).
 *
 * The small pure helpers (`esc`, `imageSize`, `decodeDataUrl`, the DrawingML run + EMU scaling) are
 * COPIED from `invoices/docx.ts` on purpose: those are private there, and duplicating a handful of
 * pure functions is cheaper than widening the invoice module's export surface.
 */
import AdmZip from 'adm-zip';
import type { WhiteboardNode, WhiteboardEdge } from '../../shared/types';

const EMU_PER_PX = 9525; // 1px @96dpi = 9525 EMU

/** XML-escape untrusted text; strip codepoints not representable in XML 1.0 so Word never sees a
 *  corrupt document.xml. Copied from invoices/docx.ts. */
function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

/** Read intrinsic pixel size from PNG (IHDR) or JPEG (SOF); fall back to 120x60. Copied from invoices/docx.ts. */
function imageSize(bytes: Buffer, mime: string): { w: number; h: number } {
  try {
    if (mime === 'image/png') return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
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

/** Decode a base64 `data:` URL (png/jpeg only). Copied from invoices/docx.ts. */
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

// Identify a node by its most human-readable content: explicit name, then its own text/url, then type.
function nodeLabel(n: WhiteboardNode): string {
  return n.name || n.text || n.url || n.type;
}
function nodeBody(n: WhiteboardNode): string {
  return n.text || n.url || '';
}

/** Render the board snapshot (inline figure) + a plain node/edge appendix to a real .docx Buffer. */
export function renderBoardDocx(pngDataUrl: string, nodes: WhiteboardNode[], edges: WhiteboardEdge[]): Buffer {
  const media: Media[] = [];
  const d = decodeDataUrl(pngDataUrl);
  if (d) {
    const { w, h } = imageSize(d.bytes, d.mime);
    const maxW = 620; const scale = w > maxW ? maxW / w : 1; // fit a portrait page's text column
    const ext = d.mime === 'image/png' ? 'png' : 'jpg';
    media.push({
      rId: 'rIdImg1', part: `word/media/image1.${ext}`, ext, bytes: d.bytes,
      cx: Math.round(w * scale * EMU_PER_PX), cy: Math.round(h * scale * EMU_PER_PX),
    });
  }
  let imgId = 1;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeParas = nodes.map((n) =>
    para(`${textRun(nodeLabel(n), { bold: true })}${textRun(` (${n.type}): ${nodeBody(n)}`)}`)
  ).join('');
  const edgeParas = edges.map((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) return ''; // dangling edge — skip
    return para(textRun(`${nodeLabel(from)} → ${nodeLabel(to)}`));
  }).filter(Boolean).join('');

  const body = [
    para(textRun('Whiteboard export', { bold: true, size: 40 })),
    media.length ? para(imageRun(media[0], imgId++)) : '',
    para(textRun('Nodes', { bold: true, size: 28 })),
    nodeParas,
    para(textRun('Connections', { bold: true, size: 28 })),
    edgeParas,
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
