import { describe, it, expect } from 'vitest';
import { joinPdfTextItems } from '../src/renderer/lib/pdfText';

// pdf.js getTextContent() returns an items array; text items have { str, hasEOL }, while
// marked-content items have neither. joinPdfTextItems flattens that into plain text for the AI.
describe('joinPdfTextItems', () => {
  it('concatenates item strings on one line', () => {
    expect(joinPdfTextItems([{ str: 'Hello' }, { str: ' ' }, { str: 'PDF' }])).toBe('Hello PDF');
  });

  it('inserts a newline after an item flagged hasEOL', () => {
    expect(joinPdfTextItems([{ str: 'line1', hasEOL: true }, { str: 'line2' }])).toBe('line1\nline2');
  });

  it('skips marked-content items that have no str', () => {
    expect(joinPdfTextItems([{ str: 'a' }, { type: 'beginMarkedContent' }, { str: 'b', hasEOL: true }])).toBe('ab\n');
  });

  it('returns an empty string for no items', () => {
    expect(joinPdfTextItems([])).toBe('');
  });
});
