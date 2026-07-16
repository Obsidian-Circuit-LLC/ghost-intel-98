import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { renderReportDocx } from '../src/main/reports/docx';
import type { Report, Contact } from '../src/shared/reports-types';

// a real 1x1 png (so imageSize/decodeDataUrl succeed and a media part is emitted)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const contact: Contact = {
  id: 'c1', name: 'Jane <b>Doe</b>', title: 'Analyst', org: 'Obsidian Circuit', email: 'jane@example.com'
};

const report: Report = {
  id: 'r1', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  bannerRef: 'banner.png', fromContactId: 'c1', to: '<b>To&Recipient</b>',
  blocks: [
    { id: 'b1', kind: 'text', html: '<b>Bold</b> <i>ital</i> <u>und</u> <span style="font-size:14pt">Big</span><p>para</p>' },
    { id: 'b2', kind: 'image', assetRef: 'photo.png', widthPct: 60, caption: '<script>bad()</script> evidence photo' }
  ]
};

const assets: Record<string, string> = { 'banner.png': PNG, 'photo.png': PNG };

describe('renderReportDocx', () => {
  it('produces a valid docx zip with document.xml + a media part', () => {
    const buf = renderReportDocx(report, assets, contact);
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('word/document.xml');
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('word/_rels/document.xml.rels');
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('emits a bold run and a sized run from the constrained rich-text', () => {
    const doc = new AdmZip(renderReportDocx(report, assets, contact)).getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('<w:b/>'); // bold
    expect(doc).toContain('<w:i/>'); // italic
    expect(doc).toContain('<w:u w:val="single"/>'); // underline
    expect(doc).toContain('<w:sz w:val="28"/>'); // 14pt -> sz half-points = 28
    expect(doc).toContain('Bold');
    expect(doc).toContain('Big');
    expect(doc).toContain('para');
  });

  it('escapes the caption + To + contact fields and emits no raw markup', () => {
    const doc = new AdmZip(renderReportDocx(report, assets, contact)).getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).not.toContain('<script>');
    expect(doc).toContain('&lt;script&gt;bad()&lt;/script&gt; evidence photo');
    expect(doc).not.toContain('<b>To&Recipient</b>');
    expect(doc).toContain('&lt;b&gt;To&amp;Recipient&lt;/b&gt;');
    expect(doc).toContain('Jane &lt;b&gt;Doe&lt;/b&gt;');
  });

  it('does not double-escape entities produced by the sanitizer in text runs', () => {
    const r2: Report = {
      ...report, bannerRef: undefined, blocks: [{ id: 't', kind: 'text', html: 'A &amp; B &lt;tag&gt;' }]
    };
    const doc = new AdmZip(renderReportDocx(r2, {}, null)).getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('A &amp; B &lt;tag&gt;');
    expect(doc).not.toContain('&amp;amp;');
    expect(doc).not.toContain('&amp;lt;');
  });

  it('handles a null contact + missing assets without throwing', () => {
    const r3: Report = {
      ...report, bannerRef: 'missing.png', fromContactId: undefined,
      blocks: [{ id: 'i', kind: 'image', assetRef: 'gone.png', widthPct: 9999, caption: 'c' }]
    };
    const buf = renderReportDocx(r3, {}, null);
    const zip = new AdmZip(buf);
    const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('Chain of Custody');
    expect(doc).not.toContain('undefined');
  });
});

function docXml(buf: Buffer): string {
  return new AdmZip(buf).readAsText('word/document.xml');
}
function baseReport(blocks: Report['blocks']): Report {
  return { id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you', blocks };
}

describe('renderReportDocx expansion', () => {
  it('emits centered paragraph alignment', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<p style="text-align:center">hi</p>' }]), {}, null));
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('emits a run font from font-family', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<span style="font-family:Georgia">hi</span>' }]), {}, null));
    expect(xml).toContain('w:rFonts');
    expect(xml).toContain('Georgia');
  });

  it('emits rPr children in ECMA-376 CT_RPr sequence order (rFonts, b, i, sz, u)', () => {
    const xml = docXml(renderReportDocx(baseReport([
      { id: 'b', kind: 'text', html: '<span style="font-size:12pt;font-family:Arial"><b><u>Hi</u></b></span>' }
    ]), {}, null));
    // Pick the run-properties block for our span (the one carrying the rFonts), not the title's.
    const rPr = (xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/g) ?? []).find((b) => b.includes('<w:rFonts')) ?? '';
    const order = ['<w:rFonts', '<w:b/>', '<w:sz', '<w:u '].map((t) => rPr.indexOf(t));
    // Every element is present…
    expect(order.every((i) => i >= 0)).toBe(true);
    // …and strictly ascending: rFonts before b before sz before u (u after sz is the schema rule).
    expect(order).toEqual([...order].sort((a, z) => a - z));
    expect(rPr.indexOf('<w:rFonts')).toBeLessThan(rPr.indexOf('<w:b/>'));
    expect(rPr.indexOf('<w:sz')).toBeLessThan(rPr.indexOf('<w:u '));
  });

  it('emits list paragraphs for ul/li', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<ul><li>a</li><li>b</li></ul>' }]), {}, null));
    expect(xml).toContain('<w:numPr>');
  });

  it('emits a hyperlink for a link', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'text', html: '<a href="https://x.co">L</a>' }]), {}, null));
    expect(xml).toMatch(/w:hyperlink|HYPERLINK/);
  });

  it('emits a w:tbl for a table block', () => {
    const xml = docXml(renderReportDocx(baseReport([{ id: 'b', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }]), {}, null));
    expect(xml).toContain('<w:tbl>');
    expect((xml.match(/<w:tc>/g) || []).length).toBe(4);
  });

  it('emits reportDate', () => {
    const r = baseReport([]); r.reportDate = '2026-07-16';
    expect(docXml(renderReportDocx(r, {}, null))).toContain('2026-07-16');
  });
});
