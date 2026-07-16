/**
 * Chain-of-Custody report → HTML (+ PDF). The main process has no DOM/DOMPurify, so this file
 * treats a text block's stored `html` as already-safe: the renderer's `sanitizeReportHtml`
 * (font-size-only style allowlist) is the sole barrier against script/handler/style injection and
 * runs at every edit, BEFORE the block is persisted. Every OTHER field that lands in this HTML —
 * the report title, the To recipient, an image caption, every contact field — is plain text and is
 * escaped here with the shared `escapeHtml` (main/whiteboard/board-export.ts) before interpolation.
 *
 * `buildReportHtml` is pure (no Electron) and unit-tested directly; `reportToPdf` is the thin
 * Electron-dependent wrapper (mirrors invoices/export.ts, board-export.ts) that hands the built
 * HTML to the shared offscreen `htmlToPdf` render path — it is not unit-tested here for the same
 * reason those siblings aren't (it requires a real BrowserWindow).
 */
import type { Report, Contact } from '@shared/reports-types';
import { escapeHtml } from '../whiteboard/board-export';
import { htmlToPdf } from '../services/export';

/** Plain-text contact fields, escaped, one per line — skips any field the contact left blank. */
function contactHtml(c: Contact | null): string {
  if (!c) return '';
  const fields = [c.name, c.title, c.org, c.email, c.phone, c.address].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
  return fields.map((v) => `<div>${escapeHtml(v)}</div>`).join('');
}

/** A renderer-supplied widthPct should already be clamped to [10,100] by ensureReport at the store
 *  boundary; re-clamp here too so a malformed/legacy record can't emit an out-of-range CSS value. */
function safeWidthPct(v: number): number {
  return Number.isFinite(v) ? Math.max(10, Math.min(100, Math.round(v))) : 60;
}

/**
 * Build the full self-contained export document: banner (if any) → From (contact) → To
 * (recipient) → blocks in order. Text blocks interpolate their stored `html` verbatim (already
 * sanitized in the renderer); image blocks resolve their asset ref to a data URI and escape the
 * caption. A missing asset ref (dropped/never uploaded) degrades to an empty `src` rather than
 * throwing — the export still completes with the surrounding text intact.
 */
export function buildReportHtml(report: Report, assets: Record<string, string>, contact: Contact | null): string {
  const banner = report.bannerRef && assets[report.bannerRef]
    ? `<img src="${assets[report.bannerRef]}" class="banner" alt="">`
    : '';
  const from = `<div class="from"><h3>From</h3>${contactHtml(contact)}</div>`;
  const to = `<div class="to"><h3>To</h3><div>${escapeHtml(report.to)}</div></div>`;
  const dateLine = report.reportDate ? `<div class="reportdate">Date: ${escapeHtml(report.reportDate)}</div>` : '';
  const blocks = report.blocks
    .map((b) => {
      if (b.kind === 'text') return `<div class="block block-text">${b.html}</div>`;
      if (b.kind === 'table') {
        const rows = b.cells.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<table class="ga98-report-doc-table">${rows}</table>`;
      }
      const src = assets[b.assetRef] || '';
      const align = b.align === 'center' ? 'margin:0 auto;' : b.align === 'right' ? 'margin-left:auto;' : '';
      return `<figure class="block block-image" style="${align ? 'display:block;' : ''}"><img src="${src}" style="width:${safeWidthPct(b.widthPct)}%;${align}display:block" alt="">` +
        `<figcaption>${escapeHtml(b.caption)}</figcaption></figure>`;
    })
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>
<style>
body{font-family:'Segoe UI',sans-serif;margin:0;color:#111;background:#fff}
.page{max-width:8.5in;margin:0 auto;padding:0.75in}
.banner{max-width:100%;margin-bottom:1.5em;display:block}
.reportdate{margin-bottom:1em;color:#333}
.from,.to{margin-bottom:1em}
.from h3,.to h3{margin:0 0 0.25em;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em;color:#555}
.block{margin:1em 0}
.block-image img{max-width:100%;display:block}
.block-image figcaption{font-size:0.85em;color:#555;margin-top:0.25em}
.ga98-report-doc-table{border-collapse:collapse;width:100%;margin:1em 0}
.ga98-report-doc-table td{border:1px solid #333;padding:4px 6px;vertical-align:top}
</style>
</head><body>
<div class="page">
${banner}
${from}
${to}
${dateLine}
${blocks}
</div>
</body></html>`;
}

/** Render a report to a PDF Buffer via the shared offline `htmlToPdf` path. */
export async function reportToPdf(
  report: Report,
  assets: Record<string, string>,
  contact: Contact | null
): Promise<Buffer> {
  return htmlToPdf(buildReportHtml(report, assets, contact));
}
