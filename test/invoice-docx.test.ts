import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderInvoiceDocx } from '../src/main/invoices/docx';
import type { Invoice } from '../src/shared/invoice-types';

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGWqXcQAAAAAElFTkSuQmCC';
const inv: Invoice = {
  id: 'i1', number: '0007', issueDate: '2026-07-09', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'GI', logoRef: 'a.png' },
  client: { name: '<b>C</b>', company: 'Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon & <ops>' }],
  createdAt: 'x', updatedAt: 'x',
};

function docXml(buf: Buffer): string { return new AdmZip(buf).readAsText('word/document.xml'); }

describe('renderInvoiceDocx', () => {
  it('produces a valid zip with the required OOXML parts', () => {
    const zip = new AdmZip(renderInvoiceDocx(inv, {}));
    const names = zip.getEntries().map((e) => e.entryName);
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']) {
      expect(names).toContain(p);
    }
  });
  it('document.xml carries the number, a line row and the footed total; user text is XML-escaped', () => {
    const xml = docXml(renderInvoiceDocx(inv, {}));
    expect(xml).toContain('0007');
    expect(xml).toContain('Recon &amp; &lt;ops&gt;');   // escaped
    expect(xml).not.toContain('Recon & <ops>');
    expect(xml).toContain('$77.00');                     // 3.5h*20=70 +10% tax
    expect(xml).toContain('&lt;b&gt;C&lt;/b&gt;');       // client name escaped
  });
  it('strips XML-1.0-illegal control chars from free-text so document.xml stays well-formed', () => {
    // C0 controls other than tab/LF/CR (e.g. form-feed U+000C, vertical-tab U+000B,
    // unit-separator U+001F, NUL) cannot be represented in XML 1.0 even as numeric
    // entities; if they reach <w:t> Word rejects the part and shows the repair prompt.
    const dirty: Invoice = {
      ...inv,
      client: { name: 'Acme\x0cInc\x00', company: 'Co\x1f' },
      sender: { name: 'M\x0be', company: 'GI', logoRef: 'a.png' },
      notes: 'note\x1eok café 🚀',
      lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon\x0cREPORT\x1fx & <ops>' }],
    };
    const xml = docXml(renderInvoiceDocx(dirty, {}));
    // No codepoint outside the XML 1.0 Char production may survive.
    const illegal = /[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/u;
    expect(illegal.test(xml)).toBe(false);
    // Legible text around the stripped controls survives, metachars still escaped, astral kept.
    expect(xml).toContain('ReconREPORTx &amp; &lt;ops&gt;');
    expect(xml).toContain('AcmeInc');
    expect(xml).toContain('noteok café 🚀');
  });
  it('an image-bearing invoice writes a word/media part + a relationship', () => {
    const buf = renderInvoiceDocx(inv, { 'a.png': PNG });
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.startsWith('word/media/image'))).toBe(true);
    expect(zip.readAsText('word/_rels/document.xml.rels')).toMatch(/relationships\/image/);
  });
});
