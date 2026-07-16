/**
 * Task 9: pure report outline + metrics. `extractOutline` scans text blocks for heading-sized
 * (18pt) spans and returns one outline entry per heading keyed by its owning block id; `wordCount`
 * sums words across text-block html and table cells; `estimatePageCount` maps a scroll height to a
 * page count (ceil, min 1). All three are HTML-strip pure (regex, no DOM) so they run under the
 * default `node` environment without jsdom.
 */
import { describe, it, expect } from 'vitest';
import { extractOutline, wordCount, estimatePageCount } from '../src/renderer/modules/reports/outline';
import type { ReportBlock } from '../src/shared/reports-types';

const blocks: ReportBlock[] = [
  { id: 't1', kind: 'text', html: '<p><span style="font-size:18pt">Overview</span></p><p>body text here</p>' },
  { id: 't2', kind: 'text', html: '<p>just body</p>' },
  { id: 'tb', kind: 'table', cells: [['a b', 'c']] }
];

describe('report outline + metrics', () => {
  it('extracts heading-sized lines as outline entries', () => {
    const o = extractOutline(blocks);
    expect(o.map((x) => x.text)).toContain('Overview');
    expect(o).toHaveLength(1);
  });
  it('counts words across text and table cells', () => {
    // "body text here"(3) + "just body"(2) + "a b"(2) + "c"(1) + "Overview"(1) = 9
    expect(wordCount(blocks)).toBe(9);
  });
  it('estimates page count as ceil(height / pageHeight), min 1', () => {
    expect(estimatePageCount(0, 1056)).toBe(1);
    expect(estimatePageCount(1100, 1056)).toBe(2);
  });
});
