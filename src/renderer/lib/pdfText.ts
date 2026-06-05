/**
 * Pure text helpers for PDF extraction (kept free of pdfjs-dist so they're unit-testable in
 * isolation; the pdfjs orchestration lives in pdfExtract.ts).
 */

/** One entry from pdf.js getTextContent().items — text items have str/hasEOL; marked-content
 *  items have neither. */
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  type?: string;
}

/** Flatten getTextContent items into plain text: concatenate `str`, newline after `hasEOL`,
 *  skip marked-content items that carry no `str`. */
export function joinPdfTextItems(items: PdfTextItem[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out;
}
