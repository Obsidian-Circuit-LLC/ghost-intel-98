/**
 * Chain-of-Custody report → OOXML .docx (a ZIP of XML parts) built with adm-zip (already a dep).
 * Mirrors invoices/docx.ts: the private `esc`/`imageSize`/`decodeDataUrl` helpers are copied here
 * (they are NOT exported from that module) exactly as board-docx.ts did.
 *
 * SECURITY SPINE: a text block's stored `html` is the OUTPUT of the renderer's `sanitizeReportHtml`
 * — it is constrained to the fixed tag set `b/strong/i/em/u/p/br/span[font-size:<n>pt]`. The main
 * process has no DOM, so we DO NOT do general HTML parsing: a tiny stack tokenizer walks exactly
 * that allowlist, tracking bold/italic/underline/size state and emitting one `<w:r>` per text run
 * with the matching `<w:rPr>`. Every text token is HTML-entity-decoded (the sanitizer serialized
 * `&`/`<`/`>` as entities) and then XML-escaped via `esc`, so nothing untrusted reaches the XML raw.
 * Every OTHER field (title/to/caption/contact) is plain text and is `esc`-escaped before it enters
 * the document. An unresolved asset ref is skipped rather than aborting the whole export.
 */
import AdmZip from 'adm-zip';
import type { Report, Contact, ReportBlock } from '@shared/reports-types';

const EMU_PER_PX = 9525; // 1px @96dpi = 9525 EMU
// Approx usable content width in px (Letter, 0.5in margins) used to scale widthPct → pixels.
const CONTENT_PX = 600;

function esc(s: string | undefined): string {
  // Strip codepoints not representable in XML 1.0 (C0 controls other than tab/LF/CR, unpaired
  // surrogates, U+FFFE/U+FFFF) — they can't be emitted even as numeric entities and would yield a
  // non-well-formed document.xml (Word's repair prompt). Then escape the XML metacharacters.
  return (s ?? '')
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

/** Read intrinsic pixel size from PNG (IHDR) or JPEG (SOF); fall back to 120x60 if unparseable. */
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

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(image\/(png|jpe?g));base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], bytes: Buffer.from(m[3], 'base64') };
}

/** Decode the HTML entities the sanitizer may have serialized into text nodes, so `esc` can then
 *  re-escape them exactly once (no `&amp;amp;` double-escaping). `&amp;` is decoded LAST. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const EMU_MAX = 0x7fffffff; // clamp DrawingML extents to a sane positive 31-bit range

interface Media { rId: string; part: string; ext: string; bytes: Buffer; cx: number; cy: number }

function para(runs: string, pPr = ''): string { return `<w:p>${pPr}${runs}</w:p>`; }
function richRun(text: string, opts: { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: string }): string {
  // rPr children MUST follow the ECMA-376 CT_RPr/EG_RPrBase sequence: rFonts, b, i, …, sz, …, u.
  // Emitting out of order (e.g. rFonts last, or u before sz) yields a schema-invalid part that strict
  // OOXML importers reject/repair. Order here: rFonts → b → i → sz → u.
  const rPr = `<w:rPr>${opts.font ? `<w:rFonts w:ascii="${esc(opts.font)}" w:hAnsi="${esc(opts.font)}"/>` : ''}${opts.bold ? '<w:b/>' : ''}${opts.italic ? '<w:i/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ''}${opts.underline ? '<w:u w:val="single"/>' : ''}</w:rPr>`;
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

function clampPct(v: number): number {
  return Number.isFinite(v) ? Math.max(10, Math.min(100, Math.round(v))) : 60;
}

interface ParaOut { runs: string; pPr: string }

/**
 * Tokenize sanitizer-constrained block html (`b/strong/i/em/u/p/br/span[font-size|font-family]`
 * + `ul/ol/li` + scheme-guarded `a[href]`) into an array of paragraph descriptors. A small stack of
 * open-tag state (bold/italic/underline counters + font-size and font-family stacks) is walked; text
 * tokens become `<w:r>` runs with the current formatting; `<p>` boundaries and `<br>` split/break;
 * `<li>` boundaries flush a list paragraph carrying `<w:numPr>`. Paragraph-level properties
 * (alignment from `<p style="text-align:…">`, list numbering) attach to `<w:pPr>`, so each entry is
 * `{ runs, pPr }` rather than a bare run-string. A hyperlink wraps its runs in a `w:fldSimple`
 * HYPERLINK field (no relationship part needed). Unmatched closes clamp at zero so malformed input
 * can't crash.
 */
function blockRuns(html: string): ParaOut[] {
  let bold = 0, italic = 0, underline = 0;
  const sizeStack: (number | null)[] = []; // one entry per open <span>; null = span without font-size
  const fontStack: (string | null)[] = []; // one entry per open <span>; null = span without font-family
  let listDepth = 0;                 // >0 while inside ul/ol
  let ordered = false;               // last-opened list type
  let curAlign = '';                 // from the current <p style="text-align:...">
  let linkUrl = '';                  // href of the open <a>, or ''
  const paragraphs: ParaOut[] = [];
  let current = '';

  const jc = (a: string): string => (a ? `<w:pPr><w:jc w:val="${a}"/></w:pPr>` : '');
  const listPPr = (): string => `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr></w:pPr>`;

  const flushPara = (): void => { if (current) { paragraphs.push({ runs: current, pPr: jc(curAlign) }); current = ''; } curAlign = ''; };
  const flushListItem = (): void => { if (current) { paragraphs.push({ runs: current, pPr: listPPr() }); current = ''; } };

  const effSize = (): number | undefined => { for (let i = sizeStack.length - 1; i >= 0; i--) { const s = sizeStack[i]; if (s != null) return s; } return undefined; };
  const effFont = (): string | undefined => { for (let i = fontStack.length - 1; i >= 0; i--) { const f = fontStack[i]; if (f != null) return f; } return undefined; };

  // Split into tags and the text between them.
  const parts = String(html ?? '').split(/(<[^>]*>)/);
  for (const tok of parts) {
    if (tok === '') continue;
    if (tok[0] === '<') {
      const closing = tok[1] === '/';
      const nameMatch = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tok);
      const name = nameMatch ? nameMatch[1].toLowerCase() : '';
      if (name === 'b' || name === 'strong') { closing ? (bold = Math.max(0, bold - 1)) : bold++; }
      else if (name === 'i' || name === 'em') { closing ? (italic = Math.max(0, italic - 1)) : italic++; }
      else if (name === 'u') { closing ? (underline = Math.max(0, underline - 1)) : underline++; }
      else if (name === 'span') {
        if (closing) { sizeStack.pop(); fontStack.pop(); }
        else {
          const sz = /font-size:\s*(\d+(?:\.\d+)?)pt/i.exec(tok);
          sizeStack.push(sz ? parseFloat(sz[1]) : null);
          const fm = /font-family:\s*([^;"]+)/i.exec(tok);
          fontStack.push(fm ? fm[1].trim() : null);
        }
      }
      else if (name === 'a') { if (closing) linkUrl = ''; else { const h = /href="([^"]*)"/.exec(tok); linkUrl = h ? h[1] : ''; } }
      else if (name === 'ul' || name === 'ol') { if (closing) listDepth = Math.max(0, listDepth - 1); else { listDepth++; ordered = name === 'ol'; } }
      else if (name === 'li') { if (closing) flushListItem(); }
      else if (name === 'br') { current += '<w:r><w:br/></w:r>'; }
      else if (name === 'p') { if (closing) flushPara(); else { flushPara(); const a = /text-align:\s*(left|center|right)/i.exec(tok); curAlign = a ? a[1].toLowerCase() : ''; } }
      // any other tag (shouldn't occur post-sanitize) is ignored
      continue;
    }
    // text token
    const text = decodeEntities(tok);
    if (text === '') continue;
    const size = effSize();
    const run = richRun(text, { bold: bold > 0, italic: italic > 0, underline: underline > 0, size: size != null ? Math.round(size * 2) : undefined, font: effFont() });
    current += linkUrl ? `<w:fldSimple w:instr="HYPERLINK &quot;${esc(linkUrl)}&quot;">${run}</w:fldSimple>` : run;
  }
  if (listDepth > 0) flushListItem(); else flushPara();
  return paragraphs;
}

/** Render a rectangular string grid (validator-bounded) as a bordered `<w:tbl>`; each cell's text is
 *  run through `blockRuns` so cell content follows the same allowlist as text blocks. */
function tableXml(cells: string[][]): string {
  const rows = cells.map((row) => {
    const tcs = row.map((cell) => {
      const paras = blockRuns(cell);
      const cellBody = paras.length ? paras.map((p) => para(p.runs, p.pPr)).join('') : para('');
      return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>${cellBody}</w:tc>`;
    }).join('');
    return `<w:tr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

export function renderReportDocx(report: Report, assets: Record<string, string>, contact: Contact | null): Buffer {
  const media: Media[] = [];
  const addImage = (ref: string | undefined, widthPct: number): Media | null => {
    if (!ref || !assets[ref]) return null;
    const d = decodeDataUrl(assets[ref]);
    if (!d) return null;
    const { w, h } = imageSize(d.bytes, d.mime);
    const targetPx = (CONTENT_PX * clampPct(widthPct)) / 100;
    const scale = w > 0 ? targetPx / w : 1;
    const ext = d.mime === 'image/png' ? 'png' : 'jpg';
    const m: Media = {
      rId: `rIdImg${media.length + 1}`, part: `word/media/image${media.length + 1}.${ext}`, ext, bytes: d.bytes,
      cx: Math.max(1, Math.min(EMU_MAX, Math.round(w * scale * EMU_PER_PX))),
      cy: Math.max(1, Math.min(EMU_MAX, Math.round(h * scale * EMU_PER_PX)))
    };
    media.push(m); return m;
  };

  let imgId = 1;
  const smallSz = 18; // 9pt caption (half-points)

  const contactLines = contact
    ? [contact.name, contact.title, contact.org, contact.email, contact.phone, contact.address]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];

  const banner = addImage(report.bannerRef, 100);

  const body: string[] = [];
  body.push(para(richRun(report.title || 'Report', { bold: true, size: 40 })));
  if (banner) body.push(para(imageRun(banner, imgId++)));
  body.push(para(richRun('From', { bold: true })));
  for (const line of contactLines) body.push(para(richRun(line, {})));
  body.push(para(richRun('To', { bold: true })));
  body.push(para(richRun(report.to, {})));
  if (report.reportDate) body.push(para(richRun('Date: ' + report.reportDate, {})));

  for (const b of report.blocks as ReportBlock[]) {
    if (b.kind === 'text') {
      const paras = blockRuns(b.html);
      if (paras.length === 0) { body.push(para('')); continue; }
      for (const p of paras) body.push(para(p.runs, p.pPr));
    } else if (b.kind === 'table') {
      body.push(tableXml(b.cells));
    } else {
      const m = addImage(b.assetRef, b.widthPct);
      if (m) body.push(para(imageRun(m, imgId++)));
      body.push(para(richRun(b.caption, { size: smallSz })));
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`
    + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
    + `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`
    + media.map((m) => `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${m.part.split('image')[1]}"/>`).join('')
    + `</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf8'));
  zip.addFile('word/numbering.xml', Buffer.from(numberingXml, 'utf8'));
  for (const m of media) zip.addFile(m.part, m.bytes);
  return zip.toBuffer();
}
