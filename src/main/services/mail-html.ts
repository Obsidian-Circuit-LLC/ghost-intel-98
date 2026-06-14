/**
 * Pure HTML builder for printing a single mail message. No Electron import → unit-testable,
 * mirroring report-html.ts. EVERY field is HTML-escaped: the body is untrusted email content,
 * so this escaping is the XSS guard for the offscreen print window (which also runs with
 * javascript:false as defense in depth). The plaintext body is rendered — never msg.html.
 */
import type { MailMessage } from '@shared/post-mvp-types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMailPrintHtml(msg: MailMessage): string {
  const date = (() => { try { return new Date(msg.date).toLocaleString(); } catch { return msg.date; } })();
  const atts = msg.attachments.length
    ? `<div class="att"><b>Attachments (not printed):</b> ${msg.attachments.map((a) => esc(a.filename)).join(', ')}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(msg.subject)}</title>
<style>
  body { font-family: 'Times New Roman', serif; margin: 24px; color: #000; }
  .hdr { border-bottom: 1px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .hdr div { margin: 2px 0; }
  .att { margin-top: 8px; font-size: 12px; }
  pre { white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; }
</style></head><body>
<div class="hdr">
  <div><b>From:</b> ${esc(msg.from)}</div>
  <div><b>To:</b> ${esc(msg.to)}</div>
  <div><b>Subject:</b> ${esc(msg.subject)}</div>
  <div><b>Date:</b> ${esc(date)}</div>
</div>
<pre>${esc(msg.body)}</pre>
${atts}
</body></html>`;
}
