/**
 * Reports rich-text — the SECURITY SPINE for the Reports module (pure, renderer-side).
 *
 * The main process has no DOM and therefore no DOMPurify, so text-block HTML is sanitized HERE,
 * in the renderer, at every edit BEFORE it is persisted to the encrypted store. `report-html.ts`
 * (PDF) and `docx.ts` (DOCX) then treat the stored block html as already-safe and interpolate it
 * verbatim — so this sanitizer is the sole barrier against script/handler/style injection reaching
 * the exporters. The shared `lib/sanitizeHtml` FORBIDS `style` and is WRONG here: rich text needs a
 * bounded set of formatting — hence a dedicated allowlist. Tags: `b/strong/i/em/u/p/br/span/ul/ol/li/a`.
 * On `style`, ONLY these declarations survive: `font-size:<n>pt`, `font-family:<one of FONT_FAMILIES>`,
 * and `text-align:left|center|right` — every other property (color, position, url(...), expressions)
 * is dropped. On `a`, `href` survives ONLY for the `http:`/`https:`/`mailto:` schemes (no
 * `javascript:`/`data:`). Nothing else — no `img`, no event handlers, no scripts — is kept.
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
  // A global `uponSanitizeAttribute` hook. For `style` it keeps only the whitelisted declarations
  // (font-size:<n>pt, font-family from FONT_FAMILIES, text-align:left|center|right) and drops the
  // attribute if none survive. For `href` it drops the attribute unless the scheme is http/https/
  // mailto. This hook is global to DOMPurify, but it is inert for the doc-viewer `sanitizeHtml`
  // path (that path lists `style` under FORBID_ATTR, so the attribute is stripped regardless of
  // what this hook decides) — no cross-contamination.
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
 * rely on: `b/strong/i/em/u/p/br/span/ul/ol/li/a`, with `style` reduced to font-size:<n>pt /
 * font-family:<whitelisted> / text-align:left|center|right, and `a[href]` scheme-guarded to
 * http/https/mailto. Everything else — scripts, event handlers, images, other schemes/props — is removed.
 */
/**
 * Turn contentEditable's line wrappers into paragraphs BEFORE sanitizing.
 *
 * Chromium wraps each Enter-separated line in a `<div>` (`defaultParagraphSeparator` is "div"),
 * and `div` is not on the allowlist below. DOMPurify UNWRAPS a disallowed tag rather than dropping
 * its text, so `<div>a</div><div>b</div>` came out as `ab` — the break destroyed at edit time,
 * before the block was ever saved. `<p>` is allowlisted, is what the DOCX tokenizer already treats
 * as a paragraph boundary, and carries a margin in the export stylesheet, so rename rather than
 * widen the allowlist: nothing new gets through, the break survives.
 */
function paragraphiseEditorDivs(html: string): string {
  if (typeof DOMParser === 'undefined' || !html.includes('<div')) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const div of Array.from(doc.body.querySelectorAll('div'))) {
    const p = doc.createElement('p');
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  }
  return doc.body.innerHTML;
}

export function sanitizeReportHtml(html: string): string {
  installHook();
  return DOMPurify.sanitize(paragraphiseEditorDivs(String(html ?? '')), {
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

/**
 * Build the HTML a PASTE inserts at the caret in a report text block.
 *
 * Clipboard content is the least trustworthy input the editor takes — it can hold anything the user
 * copied from anywhere, including markup from a scraped page. It is escaped exactly like a
 * descriptor, so nothing pasted into a report body can carry tags, handlers or scripts into the
 * document (and, since reports are exported to PDF/DOCX/HTML, into the artefact afterwards).
 *
 * Line breaks are preserved as `<br>` because a pasted paragraph that collapses to one line is
 * useless — but they are the ONLY markup produced, and they are generated here rather than passed
 * through from the clipboard.
 */
export function pastedTextHtml(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => escape(line))
    .join('<br>');
}
