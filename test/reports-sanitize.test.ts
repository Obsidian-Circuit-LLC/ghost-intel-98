// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeReportHtml, FONT_FAMILIES } from '../src/renderer/modules/reports/rich-text';

describe('sanitizeReportHtml expansion', () => {
  it('keeps a whitelisted font-family, drops a non-whitelisted one', () => {
    expect(sanitizeReportHtml('<span style="font-family:Georgia">x</span>')).toContain('font-family:Georgia');
    const evil = sanitizeReportHtml('<span style="font-family:EvilFont">x</span>');
    expect(evil).not.toContain('EvilFont');
    expect(evil).not.toContain('font-family');
  });

  it('keeps text-align in {left,center,right}, drops others', () => {
    expect(sanitizeReportHtml('<p style="text-align:center">x</p>')).toContain('text-align:center');
    expect(sanitizeReportHtml('<p style="text-align:justify">x</p>')).not.toContain('text-align');
  });

  it('keeps font-size alongside a font-family in one style', () => {
    const out = sanitizeReportHtml('<span style="font-size:14pt;font-family:Arial">x</span>');
    expect(out).toContain('font-size:14pt');
    expect(out).toContain('font-family:Arial');
  });

  it('keeps lists', () => {
    const out = sanitizeReportHtml('<ul><li>a</li><li>b</li></ul>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>a</li>');
  });

  it('keeps http/https/mailto links, strips javascript: and data:', () => {
    expect(sanitizeReportHtml('<a href="https://example.com">x</a>')).toContain('href="https://example.com"');
    expect(sanitizeReportHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
    const js = sanitizeReportHtml('<a href="javascript:alert(1)">x</a>');
    expect(js).not.toContain('javascript');
    const data = sanitizeReportHtml('<a href="data:text/html,x">x</a>');
    expect(data).not.toContain('data:');
  });

  it('still strips scripts, handlers, and disallowed style props', () => {
    expect(sanitizeReportHtml('<script>alert(1)</script>')).toBe('');
    expect(sanitizeReportHtml('<span onclick="x()">y</span>')).not.toContain('onclick');
    expect(sanitizeReportHtml('<span style="color:red;position:fixed">y</span>')).not.toContain('color');
  });

  it('exports exactly the six-family whitelist', () => {
    expect(FONT_FAMILIES).toEqual(['Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana']);
  });
});
