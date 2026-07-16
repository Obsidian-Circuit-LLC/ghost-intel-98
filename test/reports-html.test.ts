import { describe, it, expect } from 'vitest';
import { buildReportHtml } from '../src/main/reports/report-html';
import type { Report, Contact } from '../src/shared/reports-types';

const contact: Contact = {
  id: 'c1', name: 'Jane <b>Doe</b>', title: 'Analyst', org: 'Obsidian Circuit', email: 'jane@example.com'
};

const report: Report = {
  id: 'r1', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  bannerRef: 'banner.png', fromContactId: 'c1', to: '<b>x</b> Recipient',
  blocks: [
    { id: 'b1', kind: 'text', html: '<b>Bold</b> finding' },
    { id: 'b2', kind: 'image', assetRef: 'photo.png', widthPct: 60, caption: '<script>bad()</script> evidence photo' }
  ]
};

const assets = { 'banner.png': 'data:image/png;base64,AAAA', 'photo.png': 'data:image/png;base64,BBBB' };

describe('buildReportHtml', () => {
  it('escapes the To field, image caption, and every contact field', () => {
    const html = buildReportHtml(report, assets, contact);
    expect(html).not.toContain('<b>x</b> Recipient');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; Recipient');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('Jane <b>Doe</b>');
    expect(html).toContain('Jane &lt;b&gt;Doe&lt;/b&gt;');
  });

  it('embeds the banner + image data URIs', () => {
    const html = buildReportHtml(report, assets, contact);
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('data:image/png;base64,BBBB');
  });

  it('passes a text block\'s already-sanitized html through verbatim (unescaped)', () => {
    const html = buildReportHtml(report, assets, contact);
    expect(html).toContain('<b>Bold</b> finding');
  });

  it('orders banner before From before To before blocks', () => {
    const html = buildReportHtml(report, assets, contact);
    const bannerIdx = html.indexOf('AAAA');
    const fromIdx = html.indexOf('Jane');
    const toIdx = html.indexOf('Recipient');
    const blockIdx = html.indexOf('Bold');
    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeLessThan(fromIdx);
    expect(fromIdx).toBeLessThan(toIdx);
    expect(toIdx).toBeLessThan(blockIdx);
  });

  it('clamps an out-of-range widthPct into [10,100] defensively', () => {
    const r2: Report = { ...report, blocks: [{ id: 'b3', kind: 'image', assetRef: 'photo.png', widthPct: 9999, caption: 'c' }] };
    const html = buildReportHtml(r2, assets, contact);
    expect(html).toContain('width:100%');
    const r3: Report = { ...report, blocks: [{ id: 'b4', kind: 'image', assetRef: 'photo.png', widthPct: -5, caption: 'c' }] };
    const html3 = buildReportHtml(r3, assets, contact);
    expect(html3).toContain('width:10%');
  });

  it('handles a null contact and a missing banner/asset gracefully (no throw, no literal "undefined")', () => {
    const r4: Report = { ...report, bannerRef: undefined, fromContactId: undefined, blocks: [{ id: 'b5', kind: 'image', assetRef: 'missing.png', widthPct: 60, caption: 'c' }] };
    const html = buildReportHtml(r4, {}, null);
    expect(html).toContain('Chain of Custody');
    expect(html).not.toContain('undefined');
    expect(html).toContain('src="" ');
  });
});

function base(blocks: Report['blocks']): Report {
  return { id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you', blocks };
}

describe('buildReportHtml expansion', () => {
  it('renders a table block as an HTML table with all cells', () => {
    const html = buildReportHtml(base([{ id: 'b', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }]), {}, null);
    expect(html).toContain('<table');
    expect((html.match(/<td/g) || []).length).toBe(4);
  });

  it('renders reportDate when present', () => {
    const r = base([]); r.reportDate = '2026-07-16';
    expect(buildReportHtml(r, {}, null)).toContain('2026-07-16');
  });

  it('applies image align', () => {
    const html = buildReportHtml(base([{ id: 'b', kind: 'image', assetRef: 'x', widthPct: 40, caption: 'c', align: 'center' }]), { x: 'data:image/png;base64,AA' }, null);
    expect(html).toMatch(/margin:0 auto|text-align:center|align.*center/i);
  });

  it('embeds a fixed-width page style', () => {
    expect(buildReportHtml(base([]), {}, null)).toMatch(/max-width:\s*8\.5in|width:\s*8\.5in|816px/);
  });
});
