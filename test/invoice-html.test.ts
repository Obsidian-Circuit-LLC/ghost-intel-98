import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml } from '../src/renderer/modules/invoices/invoice-html';
import type { Invoice } from '../src/shared/invoice-types';

const inv: Invoice = {
  id: 'i1', number: '0007', issueDate: '2026-07-08', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'Ghost Intel', logoRef: 'a.png' },
  client: { name: '<script>x</script>', company: 'Client Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }],
  createdAt: '2026-07-08T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z',
};

describe('renderInvoiceHtml', () => {
  it('is deterministic and contains number, totals and a line row', () => {
    const html = renderInvoiceHtml(inv, { 'a.png': 'data:image/png;base64,AAA' });
    expect(html).toBe(renderInvoiceHtml(inv, { 'a.png': 'data:image/png;base64,AAA' }));
    expect(html).toContain('0007');
    expect(html).toContain('Recon');
    expect(html).toContain('3.5');            // line hours
    expect(html).toContain('data:image/png;base64,AAA'); // embedded logo
  });
  it('HTML-escapes user text (no raw script tag)', () => {
    const html = renderInvoiceHtml(inv, {});
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
