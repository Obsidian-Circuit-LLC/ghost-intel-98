import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, stripMarkdown } from '../src/renderer/modules/ai-assistant/markdown';

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
  it('handles the underscore forms __bold__ and _italic_', () => {
    expect(parseInline('__b__')).toEqual([{ t: 'bold', children: [{ t: 'text', v: 'b' }] }]);
    expect(parseInline('_i_')).toEqual([{ t: 'italic', children: [{ t: 'text', v: 'i' }] }]);
  });
  it('empty inline code `` is literal, not an empty code node', () => {
    expect(parseInline('``')).toEqual([{ t: 'text', v: '``' }]);
  });
});

describe('parseInline links', () => {
  it('parses a markdown [label](url) into a link node', () => {
    expect(parseInline('[go](http://x.com)')).toEqual([
      { t: 'link', href: 'http://x.com', children: [{ t: 'text', v: 'go' }] }
    ]);
  });
  it('parses the label recursively so [**b**](u) keeps the bold child', () => {
    expect(parseInline('[**b**](https://x.com)')).toEqual([
      { t: 'link', href: 'https://x.com', children: [{ t: 'bold', children: [{ t: 'text', v: 'b' }] }] }
    ]);
  });
  it('splits text + bare-URL autolink: see https://x/a', () => {
    expect(parseInline('see https://x/a')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', href: 'https://x/a', children: [{ t: 'text', v: 'https://x/a' }] }
    ]);
  });
  it('autolinks http:// too', () => {
    expect(parseInline('http://x/a')).toEqual([
      { t: 'link', href: 'http://x/a', children: [{ t: 'text', v: 'http://x/a' }] }
    ]);
  });
  it('trims a trailing period off a bare URL', () => {
    expect(parseInline('https://x/a.')).toEqual([
      { t: 'link', href: 'https://x/a', children: [{ t: 'text', v: 'https://x/a' }] },
      { t: 'text', v: '.' }
    ]);
  });
  it('trims an unmatched trailing paren: (https://x/a)', () => {
    expect(parseInline('(https://x/a)')).toEqual([
      { t: 'text', v: '(' },
      { t: 'link', href: 'https://x/a', children: [{ t: 'text', v: 'https://x/a' }] },
      { t: 'text', v: ')' }
    ]);
  });
  it('keeps a matched paren inside the URL: https://x/Foo_(bar)', () => {
    expect(parseInline('https://x/Foo_(bar)')).toEqual([
      { t: 'link', href: 'https://x/Foo_(bar)', children: [{ t: 'text', v: 'https://x/Foo_(bar)' }] }
    ]);
  });
  it('does NOT autolink a URL inside inline code', () => {
    expect(parseInline('`https://x/a`')).toEqual([{ t: 'code', v: 'https://x/a' }]);
  });
  it('stays scheme-agnostic: hostile [x](javascript:...) keeps the raw href', () => {
    // Balanced-paren matching keeps the whole raw href (still scheme-agnostic — safeHref rejects it).
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'x' }] }
    ]);
  });
  // Regression (finding 3): a markdown-link href containing a literal ')' must NOT be truncated at
  // the first inner paren — balance-match the closing paren like the bare-URL path does.
  it('keeps balanced parens in a [label](url) href: Wikipedia disambiguation', () => {
    expect(parseInline('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { t: 'link', href: 'https://en.wikipedia.org/wiki/Foo_(bar)', children: [{ t: 'text', v: 'Foo' }] }
    ]);
  });
  // Regression (findings 2 & 4): a URL inside a link LABEL must NOT nest a second link node —
  // nested <a> double-fires the clearnet-open policy on one click.
  it('does NOT nest a link when the label is itself a URL: [url](url)', () => {
    expect(parseInline('[https://example.com/foo](https://example.com/foo)')).toEqual([
      { t: 'link', href: 'https://example.com/foo', children: [{ t: 'text', v: 'https://example.com/foo' }] }
    ]);
  });
  it('does NOT autolink a foreign URL inside a link label (adversarial)', () => {
    expect(parseInline('[click https://evil.com here](https://good.com)')).toEqual([
      { t: 'link', href: 'https://good.com', children: [{ t: 'text', v: 'click https://evil.com here' }] }
    ]);
  });
  it('still parses emphasis inside a link label (bold not suppressed)', () => {
    expect(parseInline('[**b** https://x](https://good.com)')).toEqual([
      { t: 'link', href: 'https://good.com', children: [
        { t: 'bold', children: [{ t: 'text', v: 'b' }] },
        { t: 'text', v: ' https://x' }
      ] }
    ]);
  });
  it('unclosed [label]( stays literal text (no throw)', () => {
    expect(parseInline('[label](')).toEqual([{ t: 'text', v: '[label](' }]);
  });
  it('a [label] with no following (url) stays literal', () => {
    expect(parseInline('[just brackets]')).toEqual([{ t: 'text', v: '[just brackets]' }]);
  });
  it('parses twice to an equal AST (deterministic)', () => {
    const s = 'see [a](http://x) and https://y/z. also `http://c` end';
    expect(parseInline(s)).toEqual(parseInline(s));
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
  it('+ bullets are recognized too', () => {
    expect(parseMarkdown('+ a\n+ b')).toEqual([{ t: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }]);
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

describe('stripMarkdown', () => {
  it('drops inline markers, keeping the spoken text (matches MarkdownView)', () => {
    expect(stripMarkdown('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });
  it('drops ATX heading hashes', () => {
    expect(stripMarkdown('## Mission Brief')).toBe('Mission Brief');
  });
  it('renders bullets as one line each, no bullet marker', () => {
    expect(stripMarkdown('- a\n- b')).toBe('a\nb');
  });
  it('flattens nested emphasis', () => {
    expect(stripMarkdown('**_x_**')).toBe('x');
  });
  it('plain text is unchanged', () => {
    expect(stripMarkdown('hello world')).toBe('hello world');
  });
  it('an unmatched single asterisk stays literal (not spoken away)', () => {
    expect(stripMarkdown('5 * 3 = 15')).toBe('5 * 3 = 15');
  });
  it('joins blocks with newlines for the sentence chunker', () => {
    expect(stripMarkdown('# Title\n\nbody text')).toBe('Title\nbody text');
  });
  it('empty / whitespace input yields empty string', () => {
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown('   \n  ')).toBe('');
  });
  it('is deterministic', () => {
    const s = '# H\n\n**a** *b*\n- one\n- two';
    expect(stripMarkdown(s)).toBe(stripMarkdown(s));
  });
  it('reads a markdown link label, not its URL', () => {
    expect(stripMarkdown('[go](http://x)')).toBe('go');
  });
  it('reads a bare-URL autolink as its URL text', () => {
    expect(stripMarkdown('visit https://x/a')).toBe('visit https://x/a');
  });
});
