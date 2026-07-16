/** Pure report outline + document metrics (renderer, DOM-free). The right rail's Document Outline
 *  and the status bar's word/page counters are derived here from the block model with plain regex
 *  HTML stripping — no DOMParser — so the same functions run in a jsdom-free unit test and in the
 *  live renderer identically. Text-block html is already `sanitizeReportHtml`-clean, so stripping
 *  tags with a regex is a display transform over trusted markup, not a security barrier. */
import type { ReportBlock } from '@shared/reports-types';

function stripTags(html: string): string { return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

/** A heading is a line whose text is wrapped in an 18pt span (the "Heading" preset). We match each
 *  such span and use its stripped text as an outline entry, keyed by the owning block id. */
export function extractOutline(blocks: ReportBlock[]): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const b of blocks) {
    if (b.kind !== 'text') continue;
    const re = /<span[^>]*font-size:\s*18pt[^>]*>(.*?)<\/span>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.html)) !== null) {
      const text = stripTags(m[1]);
      if (text) out.push({ id: b.id, text });
    }
  }
  return out;
}

export function wordCount(blocks: ReportBlock[]): number {
  let words = 0;
  const add = (s: string): void => { const t = stripTags(s); if (t) words += t.split(/\s+/).length; };
  for (const b of blocks) {
    if (b.kind === 'text') add(b.html);
    else if (b.kind === 'table') for (const row of b.cells) for (const c of row) add(c);
  }
  return words;
}

export function estimatePageCount(scrollHeightPx: number, pageHeightPx: number): number {
  if (pageHeightPx <= 0) return 1;
  return Math.max(1, Math.ceil(scrollHeightPx / pageHeightPx));
}
