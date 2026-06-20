import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../src/renderer/modules/ai-assistant/markdown';

describe('parseInline', () => {
  it('plain text (with emoji) is a single text node', () => {
    expect(parseInline('hello 🌍')).toEqual([{ t: 'text', v: 'hello 🌍' }]);
  });
  it('parses **bold**', () => {
    expect(parseInline('a **b** c')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'bold', children: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }
    ]);
  });
  it('parses *italic* and `code`', () => {
    expect(parseInline('*i*')).toEqual([{ t: 'italic', children: [{ t: 'text', v: 'i' }] }]);
    expect(parseInline('`x`')).toEqual([{ t: 'code', v: 'x' }]);
  });
  it('unclosed ** is literal text (no throw)', () => {
    expect(parseInline('**bold')).toEqual([{ t: 'text', v: '**bold' }]);
  });
  it('never produces HTML — angle brackets stay literal text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });
});

describe('parseMarkdown', () => {
  it('a paragraph', () => {
    expect(parseMarkdown('hello world')).toEqual([{ t: 'p', children: [{ t: 'text', v: 'hello world' }] }]);
  });
  it('an ATX heading drops the hashes and records the level', () => {
    expect(parseMarkdown('## Title')).toEqual([{ t: 'h', level: 2, children: [{ t: 'text', v: 'Title' }] }]);
  });
  it('consecutive bullets become one ul', () => {
    expect(parseMarkdown('* a\n- b')).toEqual([{ t: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }]);
  });
  it('blank line separates paragraphs', () => {
    expect(parseMarkdown('a\n\nb')).toEqual([
      { t: 'p', children: [{ t: 'text', v: 'a' }] },
      { t: 'p', children: [{ t: 'text', v: 'b' }] }
    ]);
  });
  it('inline formatting inside a bullet', () => {
    expect(parseMarkdown('* **x**')).toEqual([{ t: 'ul', items: [[{ t: 'bold', children: [{ t: 'text', v: 'x' }] }]] }]);
  });
  it('empty input is no blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
