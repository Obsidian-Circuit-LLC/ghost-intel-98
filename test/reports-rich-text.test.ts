// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeReportHtml, descriptorInsertHtml, FONT_SIZES } from '../src/renderer/modules/reports/rich-text';
describe('report rich text', () => {
  it('keeps b/i/u + font-size span, strips everything else', () => {
    const out = sanitizeReportHtml('<b>x</b><i>y</i><u>z</u><span style="font-size:14pt">big</span><p>p</p>');
    expect(out).toContain('<b>x</b>'); expect(out).toContain('<i>y</i>'); expect(out).toContain('<u>z</u>');
    expect(out).toContain('font-size:14pt'); expect(out).toContain('big');
  });
  it('strips script, event handlers, and non-font-size style props', () => {
    const out = sanitizeReportHtml('<script>bad()</script><span style="font-size:12pt;color:red;position:fixed" onclick="x()">t</span><img src=x onerror=y>');
    expect(out).not.toContain('script'); expect(out).not.toContain('onclick'); expect(out).not.toContain('onerror');
    expect(out).not.toContain('color'); expect(out).not.toContain('position'); expect(out).not.toContain('<img');
    expect(out).toContain('font-size:12pt'); expect(out).toContain('t'); // the safe part survives
  });
  it('descriptorInsertHtml: text mode = body only; title mode = bold name + body', () => {
    const d = { name: 'OSINT.Industries', body: 'A tool that finds public links.' };
    expect(descriptorInsertHtml(d, 'text')).toBe('A tool that finds public links.');
    const t = descriptorInsertHtml(d, 'title');
    expect(t).toContain('<b>OSINT.Industries</b>'); expect(t).toContain('A tool that finds public links.');
  });
  it('FONT_SIZES presets: small 9 / normal 11 / large 14 / heading 18 bold', () => {
    const byKey = Object.fromEntries(FONT_SIZES.map((f) => [f.key, f]));
    expect(byKey.small.pt).toBe(9); expect(byKey.normal.pt).toBe(11);
    expect(byKey.large.pt).toBe(14); expect(byKey.heading.pt).toBe(18); expect(byKey.heading.bold).toBe(true);
  });
});
