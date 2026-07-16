/**
 * Reports rich-text — the SECURITY SPINE for the Reports module (pure, renderer-side).
 *
 * The main process has no DOM and therefore no DOMPurify, so text-block HTML is sanitized HERE,
 * in the renderer, at every edit BEFORE it is persisted to the encrypted store. `report-html.ts`
 * (PDF) and `docx.ts` (DOCX) then treat the stored block html as already-safe and interpolate it
 * verbatim — so this sanitizer is the sole barrier against script/handler/style injection reaching
 * the exporters. The shared `lib/sanitizeHtml` FORBIDS `style` and is WRONG here: rich text needs a
 * font-size, and only a font-size — hence a dedicated allowlist that keeps exactly `font-size:<n>pt`
 * on `style` and nothing else (no `color`, `position`, `url(...)`, expressions, ...).
 */
import DOMPurify from 'dompurify';

export interface FontSize {
  key: 'small' | 'normal' | 'large' | 'heading';
  label: string;
  pt: number;
  bold?: boolean;
}

/** The four toolbar presets. `pt` is the point size written into `<span style="font-size:${pt}pt">`. */
export const FONT_SIZES: FontSize[] = [
  { key: 'small', label: 'Small', pt: 9 },
  { key: 'normal', label: 'Normal', pt: 11 },
  { key: 'large', label: 'Large', pt: 14 },
  { key: 'heading', label: 'Heading', pt: 18, bold: true }
];

/** Closed whitelist of typefaces guaranteed present on Windows (the only ship target). The sanitizer
 *  accepts font-family ONLY when the value is exactly one of these strings. */
export const FONT_FAMILIES: string[] = ['Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'];

const ALIGNS = new Set(['left', 'center', 'right']);

let hookInstalled = false;

function installHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  // A global `uponSanitizeAttribute` hook: for a `style` attribute keep ONLY a `font-size:<n>pt`
  // declaration and drop the attribute otherwise. This hook is global to DOMPurify, but it is
  // inert for the doc-viewer `sanitizeHtml` path (that path lists `style` under FORBID_ATTR, so
  // the attribute is stripped regardless of what this hook decides) — no cross-contamination.
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style') {
      const decls: string[] = [];
      const raw = data.attrValue || '';
      const size = /font-size:\s*(\d+(?:\.\d+)?)pt/i.exec(raw);
      if (size) decls.push(`font-size:${size[1]}pt`);
      const fam = /font-family:\s*([^;]+)/i.exec(raw);
      if (fam) {
        const name = fam[1].trim().replace(/^['"]|['"]$/g, '');
        if (FONT_FAMILIES.includes(name)) decls.push(`font-family:${name}`);
      }
      const align = /text-align:\s*(left|center|right)/i.exec(raw);
      if (align && ALIGNS.has(align[1].toLowerCase())) decls.push(`text-align:${align[1].toLowerCase()}`);
      if (decls.length > 0) data.attrValue = decls.join(';');
      else data.keepAttr = false;
    } else if (data.attrName === 'href') {
      const v = (data.attrValue || '').trim();
      if (!/^(https?:|mailto:)/i.test(v)) data.keepAttr = false;
    }
  });
}

/**
 * Sanitize a rich-text block's HTML down to the fixed allowlist the DOCX tokenizer + PDF path
 * rely on: `b/strong/i/em/u/p/br/span`, with `style` reduced to a single `font-size:<n>pt`.
 * Everything else — scripts, event handlers, images, links, arbitrary style props — is removed.
 */
export function sanitizeReportHtml(html: string): string {
  installHook();
  return DOMPurify.sanitize(String(html ?? ''), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'span', 'ul', 'ol', 'li', 'a'],
    ALLOWED_ATTR: ['style', 'href'],
    ALLOW_DATA_ATTR: false
  });
}

/** HTML-escape a plain descriptor field before it is wrapped into insertable markup. */
function escape(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/**
 * Build the HTML a descriptor inserts at the caret. `text` mode inserts the escaped body only;
 * `title` mode prefixes a bold escaped name. Both fields are HTML-escaped: a descriptor is
 * plain-text data, never trusted markup.
 */
export function descriptorInsertHtml(d: { name: string; body: string }, mode: 'text' | 'title'): string {
  const body = escape(d.body);
  if (mode === 'title') {
    return `<b>${escape(d.name)}</b> — ${body}`;
  }
  return body;
}

/** An introduction inserts identically to a descriptor (both are escaped plain-text data). */
export function introductionInsertHtml(d: { name: string; body: string }, mode: 'text' | 'title'): string {
  return descriptorInsertHtml(d, mode);
}
