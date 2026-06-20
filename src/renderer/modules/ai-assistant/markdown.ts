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
  | { t: 'code'; v: string };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'ul'; items: Inline[][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[*\-+]\s+(.*)$/;

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
      if (end > i) { pushText(); out.push({ t: 'code', v: text.slice(i + 1, end) }); i = end + 1; continue; }
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
    buf += c;
    i++;
  }
  pushText();
  return out;
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
