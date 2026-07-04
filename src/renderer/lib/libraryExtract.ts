/**
 * Renderer-side extraction dispatcher for the global document library: given a file name and
 * its raw bytes, produce plain text + a mime label suitable for `window.api.memory.library.add`.
 * Dispatches purely by extension — pdf goes through the same pdf.js text-layer extractor the
 * in-app viewer uses; docx goes through mammoth (dynamic import, as DocViewer does) then strips
 * markup down to text; txt/md are decoded as UTF-8. Anything else is rejected loudly rather than
 * silently ingested as garbage.
 */
import { extractPdfText } from './pdfExtract';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractForLibrary(
  name: string,
  bytes: Uint8Array
): Promise<{ title: string; mime: string; text: string }> {
  const lower = name.toLowerCase();

  if (lower.endsWith('.pdf')) {
    const text = await extractPdfText(bytes);
    return { title: name, mime: 'application/pdf', text };
  }

  if (lower.endsWith('.txt')) {
    return { title: name, mime: 'text/plain', text: new TextDecoder().decode(bytes) };
  }

  if (lower.endsWith('.md')) {
    return { title: name, mime: 'text/markdown', text: new TextDecoder().decode(bytes) };
  }

  if (lower.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    return {
      title: name,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text: stripHtml(html)
    };
  }

  throw new Error(`Unsupported file type: ${name}`);
}
