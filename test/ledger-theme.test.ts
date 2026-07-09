import { describe, it, expect } from 'vitest';
import { LEDGER, contrastRatio } from '../src/renderer/modules/invoices/ledger-theme';
import { renderInvoiceHtml } from '../src/renderer/modules/invoices/invoice-html';
import { renderInvoiceDocx } from '../src/main/invoices/docx';
import AdmZip from 'adm-zip';
import type { Invoice } from '../src/shared/invoice-types';

describe('ledger theme readability (WCAG AA ≥ 4.5:1)', () => {
  it('body + input text on their surfaces meet AA', () => {
    for (const bg of [LEDGER.base, LEDGER.panel, LEDGER.inset]) {
      expect(contrastRatio(LEDGER.text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('contrastRatio is symmetric + white/black is 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio(LEDGER.text, LEDGER.base)).toBeCloseTo(contrastRatio(LEDGER.base, LEDGER.text), 5);
  });
});

const inv: Invoice = {
  id: 'i', number: '1', issueDate: '2026-07-10', currency: 'USD', rate: 20,
  sender: { name: 'a', company: 'b' }, client: { name: 'c', company: 'd' }, lines: [], createdAt: 'x', updatedAt: 'x',
};
describe('theme cannot leak into an export', () => {
  it('the PDF-HTML and .docx contain none of the theme hex values', () => {
    const html = renderInvoiceHtml(inv, {});
    const xml = new AdmZip(renderInvoiceDocx(inv, {})).readAsText('word/document.xml');
    for (const hex of [LEDGER.base, LEDGER.panel, LEDGER.inset, LEDGER.accent]) {
      expect(html.toLowerCase()).not.toContain(hex.toLowerCase());
      expect(xml.toLowerCase()).not.toContain(hex.toLowerCase());
    }
  });
});
