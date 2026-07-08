/** Builds the self-contained printable invoice HTML — used for BOTH the on-screen preview and the PDF
 *  export (preview == output). Pure + deterministic. Every user string is HTML-escaped (untrusted →
 *  HTML fence). Images are embedded as data URLs resolved from `assets` by ref. */
import type { Invoice } from '@shared/invoice-types';
import { hoursBetween, computeTotals, formatMoney } from './calc';

function esc(s: string | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ));
}
function img(ref: string | undefined, assets: Record<string, string>, cls: string): string {
  const url = ref ? assets[ref] : undefined;
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" />` : '';
}

export function renderInvoiceHtml(invoice: Invoice, assets: Record<string, string>): string {
  const { currency, rate, taxPct } = invoice;
  const t = computeTotals(invoice.lines, rate, taxPct);
  const rows = invoice.lines.map((l) => {
    const h = hoursBetween(l.start, l.end);
    return `<tr><td>${esc(l.date)}</td><td>${esc(l.start)}–${esc(l.end)}</td><td>${esc(l.description)}</td>`
      + `<td class="num">${h}</td><td class="num">${esc(formatMoney(h * rate, currency))}</td></tr>`;
  }).join('');
  const sig = invoice.signature;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}',
    '.head{display:flex;justify-content:space-between;align-items:flex-start}',
    '.logo{max-height:64px;max-width:180px}table{width:100%;border-collapse:collapse;margin:18px 0}',
    'th,td{border:1px solid #999;padding:6px 8px;text-align:left}.num{text-align:right}',
    '.totals{width:280px;margin-left:auto}.sig{margin-top:48px}.sigimg{max-height:64px}',
    '</style></head><body>',
    `<div class="head"><div><h1>INVOICE ${esc(invoice.number)}</h1>`,
    `<div>Date: ${esc(invoice.issueDate)}</div></div>${img(invoice.sender.logoRef, assets, 'logo')}</div>`,
    `<div class="head"><div><b>From</b><br>${esc(invoice.sender.name)}<br>${esc(invoice.sender.company)}</div>`,
    `<div><b>To</b><br>${esc(invoice.client.name)}<br>${esc(invoice.client.company)} ${img(invoice.client.logoRef, assets, 'logo')}</div></div>`,
    '<table><thead><tr><th>Date</th><th>Time</th><th>Description</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    `<table class="totals"><tbody>`,
    `<tr><td>Total hours</td><td class="num">${t.totalHours}</td></tr>`,
    `<tr><td>Subtotal</td><td class="num">${esc(formatMoney(t.subtotal, currency))}</td></tr>`,
    taxPct ? `<tr><td>Tax (${taxPct}%)</td><td class="num">${esc(formatMoney(t.tax, currency))}</td></tr>` : '',
    `<tr><td><b>Total</b></td><td class="num"><b>${esc(formatMoney(t.total, currency))}</b></td></tr>`,
    '</tbody></table>',
    invoice.notes ? `<div><b>Notes</b><br>${esc(invoice.notes)}</div>` : '',
    sig ? `<div class="sig">${img(sig.signatureRef, assets, 'sigimg')}<div>${esc(sig.signerName)} ${esc(sig.signedDate)}</div><div>Signature</div></div>` : '',
    '</body></html>',
  ].join('');
}
