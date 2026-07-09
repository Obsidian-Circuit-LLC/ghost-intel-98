import { describe, it, expect } from 'vitest';
import { parseMarkdown, stripMarkdown } from '../src/renderer/modules/ai-assistant/markdown';

// The RTFM guides (and Q output) use blockquote callouts, fenced code, and `---` rules. The parser
// must consume these into real blocks so nothing renders as literal markdown syntax.
describe('markdown: blockquote / code fence / horizontal rule', () => {
  it('parses a blockquote (single + multi-line) into a quote block', () => {
    const blocks = parseMarkdown('> Get the two cookies:\n> auth_token and ct0');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].t).toBe('quote');
    if (blocks[0].t === 'quote') expect(stripMarkdown('> Get the two cookies:\n> auth_token and ct0')).toContain('Get the two cookies');
  });
  it('strips the leading > (never shows literal blockquote syntax)', () => {
    expect(stripMarkdown('> a callout')).toBe('a callout');
    expect(stripMarkdown('> a callout')).not.toContain('>');
  });
  it('parses a fenced code block, dropping the ``` markers', () => {
    const blocks = parseMarkdown('```bash\nexport TOKEN=x\necho done\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'codeblock', v: 'export TOKEN=x\necho done' });
    expect(stripMarkdown('```\ncode\n```')).not.toContain('`');
  });
  it('handles an unclosed code fence to EOF without throwing', () => {
    const blocks = parseMarkdown('```\nunterminated');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'codeblock', v: 'unterminated' });
  });
  it('parses a bare --- / *** / ___ line as a horizontal rule (not literal text)', () => {
    for (const rule of ['---', '***', '___', '----']) {
      const blocks = parseMarkdown(`a\n\n${rule}\n\nb`);
      expect(blocks.some((b) => b.t === 'hr')).toBe(true);
    }
    expect(stripMarkdown('a\n\n---\n\nb')).not.toContain('---');
  });
  it('does NOT mistake a GFM table delimiter (|---|) for an hr', () => {
    const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(blocks[0].t).toBe('table');
    expect(blocks.some((b) => b.t === 'hr')).toBe(false);
  });
});
