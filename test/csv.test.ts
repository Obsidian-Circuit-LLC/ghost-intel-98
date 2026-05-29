import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/main/services/csv';

describe('toCsv', () => {
  it('emits a UTF-8 BOM and CRLF rows', () => {
    const out = toCsv([['a', 'b'], ['c', 'd']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('a,b\r\nc,d');
    expect(out.endsWith('\r\n')).toBe(true);
  });
  it('quotes cells containing commas, quotes, or newlines', () => {
    expect(toCsv([['a,b']])).toContain('"a,b"');
    expect(toCsv([['he said "hi"']])).toContain('"he said ""hi"""');
    expect(toCsv([['line1\nline2']])).toContain('"line1\nline2"');
  });
  it('neutralizes spreadsheet formula injection (leading = + - @)', () => {
    expect(toCsv([['=cmd|calc']])).toContain("'=cmd|calc");
    expect(toCsv([['+1']])).toContain("'+1");
    expect(toCsv([['-2']])).toContain("'-2");
    expect(toCsv([['@SUM(A1)']])).toContain("'@SUM(A1)");
  });
});
