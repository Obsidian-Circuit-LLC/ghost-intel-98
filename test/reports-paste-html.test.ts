// @vitest-environment node
/**
 * Pasting into a report text block.
 *
 * GhostExodus asked for copy/paste on the right-click menu inside Reports text boxes. Paste is the
 * one that carries risk: clipboard content is the least trustworthy input the editor accepts — it
 * can hold anything copied from anywhere, including markup lifted off a scraped page — and reports
 * are exported to PDF, DOCX and HTML afterwards, so anything that survives into the document
 * survives into the artefact.
 *
 * So pasted text is escaped exactly like a descriptor body. Line breaks are the only markup
 * produced, and they are generated here rather than passed through.
 */
import { describe, expect, it } from 'vitest';
import { pastedTextHtml } from '../src/renderer/modules/reports/rich-text';

describe('pastedTextHtml', () => {
  it('escapes tags rather than inserting them', () => {
    expect(pastedTextHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('neutralises a script paste', () => {
    const out = pastedTextHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('neutralises an event-handler payload', () => {
    const out = pastedTextHtml('<img src=x onerror="steal()">');
    // The text "onerror=" survives as inert characters — that is fine and expected. What must NOT
    // survive is a live tag for it to be an attribute OF, so assert on the tag, not the substring.
    expect(out).not.toContain('<img');
    expect(out).not.toMatch(/<[a-z]/i);
    expect(out).toContain('&lt;img');
  });

  it('escapes quotes and ampersands', () => {
    expect(pastedTextHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;');
  });

  it('keeps line breaks as the ONLY markup it emits', () => {
    expect(pastedTextHtml('one\ntwo')).toBe('one<br>two');
    expect(pastedTextHtml('one\r\ntwo')).toBe('one<br>two');
  });

  it('handles empty and nullish input', () => {
    expect(pastedTextHtml('')).toBe('');
    expect(pastedTextHtml(null as unknown as string)).toBe('');
  });
});
