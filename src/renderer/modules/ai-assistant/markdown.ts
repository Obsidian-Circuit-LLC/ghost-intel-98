/**
 * Tiny, dependency-free markdown → AST parser for the assistant pane. Deliberately a LIMITED subset
 * (bold/italic/inline-code, ATX headings, bullet lists, paragraphs); everything else is literal
 * text. It NEVER produces or interprets HTML — the AST carries only plain strings, and the renderer
 * maps them to React elements, so React escapes any literal angle brackets (no XSS). Robust to
 * partial markdown mid-stream: an unclosed/unmatched marker is emitted as literal text, never throws.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; children: Inline[] };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'ul'; items: Inline[][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[*\-+]\s+(.*)$/;

const TRAILING_PUNCT = '.,;:!?\'"';

/**
 * Trim trailing punctuation off a bare-URL autolink token so `see https://x/a.` drops the period:
 * strip trailing `.,;:!?'"`, and a trailing `)`/`]` only when the URL has no matching opener
 * (so Wikipedia-style `..._(bar)` parens survive but a wrapping `(url)` paren does not). Pure.
 */
function trimAutolinkTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (TRAILING_PUNCT.includes(ch)) { end--; continue; }
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      const slice = url.slice(0, end);
      let opens = 0;
      let closes = 0;
      for (const s of slice) { if (s === open) opens++; else if (s === ch) closes++; }
      if (opens < closes) { end--; continue; }
    }
    break;
  }
  return url.slice(0, end);
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  const pushText = (): void => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < text.length) {
    const c = text[i];
    // inline code: `...`
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) { pushText(); out.push({ t: 'code', v: text.slice(i + 1, end) }); i = end + 1; continue; }
    }
    // bold: **...** or __...__
    if ((c === '*' || c === '_') && text[i + 1] === c) {
      const marker = c + c;
      const end = text.indexOf(marker, i + 2);
      if (end > i + 1) { pushText(); out.push({ t: 'bold', children: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    // italic: *...* or _..._  (skip when it's a double marker — that was an unclosed bold)
    if ((c === '*' || c === '_') && text[i + 1] !== c) {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1) { pushText(); out.push({ t: 'italic', children: parseInline(text.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    // markdown link: [label](url) — label parsed recursively; scheme-agnostic (raw href kept)
    if (c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const rparen = text.indexOf(')', close + 2);
        if (rparen > close + 1) {
          pushText();
          out.push({ t: 'link', href: text.slice(close + 2, rparen), children: parseInline(text.slice(i + 1, close)) });
          i = rparen + 1;
          continue;
        }
      }
    }
    // bare-URL autolink: http(s)://… up to whitespace/`<`, trailing punctuation trimmed
    if (c === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i))) {
      let j = i;
      while (j < text.length && !/\s/.test(text[j]) && text[j] !== '<') j++;
      const url = trimAutolinkTail(text.slice(i, j));
      if (url.length > 0) {
        pushText();
        out.push({ t: 'link', href: url, children: [{ t: 'text', v: url }] });
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  pushText();
  return out;
}

/**
 * Flatten markdown to plain text — the spoken form for TTS. Reuses the same parser the renderer
 * uses, so what Piper voices matches exactly what MarkdownView shows: no `*`/`**`/`#`/`` ` ``
 * markers read aloud. Blocks join on newlines so the Piper sentence chunker keeps natural breaks.
 * Pure + deterministic.
 */
export function stripMarkdown(text: string): string {
  return parseMarkdown(text).map(blockToText).filter((s) => s.length > 0).join('\n');
}

function blockToText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'h':
      return inlineToText(b.children);
    case 'ul':
      return b.items.map(inlineToText).join('\n');
  }
}

function inlineToText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.v;
        case 'bold':
        case 'italic':
        case 'link':
          return inlineToText(n.children);
      }
    })
    .join('');
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let bullets: string[] | null = null;

  const flushPara = (): void => {
    if (para.length) { blocks.push({ t: 'p', children: parseInline(para.join('\n')) }); para = []; }
  };
  const flushBullets = (): void => {
    if (bullets && bullets.length) blocks.push({ t: 'ul', items: bullets.map((b) => parseInline(b)) });
    bullets = null;
  };

  for (const line of lines) {
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    if (h) {
      flushPara(); flushBullets();
      blocks.push({ t: 'h', level: h[1].length, children: parseInline(h[2]) });
    } else if (b) {
      flushPara();
      (bullets ??= []).push(b[1]);
    } else if (line.trim() === '') {
      flushPara(); flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return blocks;
}
