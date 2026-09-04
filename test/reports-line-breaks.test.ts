// @vitest-environment jsdom
/**
 * Pressing Enter in a report text box must survive into the exported document.
 *
 * FIELD REPORT (GhostExodus): "when I hit enter and drop down a line to write a new sentence, that
 * space doesn't seem to be apparent when I export it. It looks clustered together, so I've been
 * doing double spaces."
 *
 * THE MECHANISM. Chromium's contentEditable wraps each Enter-separated line in a `<div>` — verified
 * in real Chrome, where `defaultParagraphSeparator` reports "div" and typing produces
 * `First sentence.<div>Second sentence.</div>`. `div` is NOT in sanitizeReportHtml's allowlist, and
 * DOMPurify UNWRAPS a disallowed tag rather than dropping its text, so the two sentences come out
 * of the sanitizer welded together: "First sentence.Second sentence."
 *
 * The break is therefore destroyed at EDIT time, not at export time — the block is saved without it,
 * so the export never had one to lose. The live contentEditable DOM keeps its divs, which is why the
 * editor still looks right on screen while the exported file does not.
 *
 * It also explains the workaround exactly: a second Enter produces an empty `<div><br></div>`, whose
 * `<br>` IS allowlisted and survives on its own. One Enter vanished; two left one break.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeReportHtml } from '../src/renderer/modules/reports/rich-text';
import { buildReportHtml } from '../src/main/reports/report-html';
import type { Report } from '../src/shared/reports-types';

const reportWith = (html: string): Report => ({
  id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you',
  blocks: [{ id: 'b', kind: 'text', html }],
});

describe('a line break typed into a report survives the sanitizer', () => {
  it('keeps two Enter-separated sentences apart', () => {
    const out = sanitizeReportHtml('<div>First sentence.</div><div>Second sentence.</div>');
    // The exact failure: the two sentences welded into one string with nothing between them.
    expect(out).not.toContain('First sentence.Second sentence.');
    expect(out).toBe('<p>First sentence.</p><p>Second sentence.</p>');
  });

  it('keeps the shape Chromium actually produces — bare text, then a div', () => {
    // Verified in real Chrome: the first line stays a bare text node, only later lines are wrapped.
    const out = sanitizeReportHtml('First sentence.<div>Second sentence.</div>');
    expect(out).not.toContain('First sentence.Second sentence.');
    expect(out).toBe('First sentence.<p>Second sentence.</p>');
  });

  it('keeps a deliberately blank line blank rather than dropping it', () => {
    expect(sanitizeReportHtml('<div><br></div>')).toBe('<p><br></p>');
  });

  it('leaves markup that was already correct alone', () => {
    expect(sanitizeReportHtml('<p>One.</p><p>Two.</p>')).toBe('<p>One.</p><p>Two.</p>');
    expect(sanitizeReportHtml('One.<br>Two.')).toBe('One.<br>Two.');
  });

  it('does not let a stray div smuggle anything past the allowlist', () => {
    // The div becomes a paragraph; everything inside it is still sanitized as before.
    const out = sanitizeReportHtml('<div onclick="steal()">safe<script>bad()</script></div>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).toContain('safe');
  });
});

describe('the exports carry the break through', () => {
  it('PDF/HTML: paragraphs are visually separated rather than flush', () => {
    const stored = sanitizeReportHtml('<div>First sentence.</div><div>Second sentence.</div>');
    const html = buildReportHtml(reportWith(stored), {}, null, null);
    expect(html).toContain('<p>First sentence.</p><p>Second sentence.</p>');
    // Without a margin rule the paragraphs render flush and it still reads "clustered".
    expect(html).toMatch(/\.block-text p\s*\{[^}]*margin/);
  });
});
