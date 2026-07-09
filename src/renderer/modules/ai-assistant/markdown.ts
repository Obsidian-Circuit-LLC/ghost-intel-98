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
  | { t: 'ul'; items: Inline[][] }
  // GFM pipe table. `header` is one row of cells; `rows` are the body rows. Each cell is parsed
  // inline (so bold/code/links inside a cell still work) — the renderer maps this to a native
  // <table>. Detected only when a pipe row is immediately followed by a matching `|---|---|`
  // delimiter row, so stray `|` in prose and lone `---` section rules never trigger it.
  | { t: 'table'; header: Inline[][]; rows: Inline[][][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[*\-+]\s+(.*)$/;
const DELIM_CELL = /^:?-+:?$/;

/**
 * Split a GFM table row into trimmed cell strings, dropping the optional leading/trailing pipe.
 * `| a | b |` → ['a','b']. Escaped pipes are not handled (guide/AI content has none); a `\|` would
 * split — acceptable for this limited subset. Pure.
 */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Return the cell count if `line` is a valid GFM delimiter row (every cell like `---`, `:--`,
 * `--:`, `:-:`), else -1. A delimiter MUST contain a pipe, so a bare `---` horizontal-rule /
 * section separator is never mistaken for a one-column delimiter. Pure.
 */
function delimiterCellCount(line: string): number {
  if (!line.includes('|') || !line.includes('-')) return -1;
  const cells = splitTableRow(line);
  if (cells.length === 0 || !cells.every((c) => DELIM_CELL.test(c))) return -1;
  return cells.length;
}

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

/**
 * Find the index of the `)` that closes a markdown link's `(url)`, given the index just past the
 * opening `(`. Tracks nesting so a URL that itself contains balanced parens (Wikipedia
 * disambiguation `..._(bar)`, many tracking URLs) is captured whole instead of being truncated at
 * the first inner `)`. Returns -1 if the parens never balance (unclosed — caller falls through to
 * literal text). Pure.
 */
function matchLinkClose(text: string, start: number): number {
  let depth = 1;
  for (let k = start; k < text.length; k++) {
    const ch = text[k];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return k; }
  }
  return -1;
}

/**
 * @param inLink when true we are parsing a markdown link's LABEL — link/autolink recognition is
 *   suppressed so a label containing a URL (the very common `[url](url)` form models emit, or an
 *   adversarial `[click https://evil.com here](https://good.com)`) does NOT produce a link nested
 *   inside a link. Nested `<a>` is invalid DOM and, worse, a single click would bubble through both
 *   anchors' onClick handlers, firing the clearnet-open policy twice / opening a second host the
 *   analyst never chose. Emphasis (bold/italic/code) still parses inside a label; the flag threads
 *   through those recursive calls so no link is ever recognized at any depth within a label.
 */
export function parseInline(text: string, inLink = false): Inline[] {
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
      if (end > i + 1) { pushText(); out.push({ t: 'bold', children: parseInline(text.slice(i + 2, end), inLink) }); i = end + 2; continue; }
    }
    // italic: *...* or _..._  (skip when it's a double marker — that was an unclosed bold)
    if ((c === '*' || c === '_') && text[i + 1] !== c) {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1) { pushText(); out.push({ t: 'italic', children: parseInline(text.slice(i + 1, end), inLink) }); i = end + 1; continue; }
    }
    // markdown link: [label](url) — label parsed recursively; scheme-agnostic (raw href kept).
    // Suppressed inside a link label so links never nest.
    if (!inLink && c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        // Balance-match the closing paren (not the first `)`), so a URL containing parens is not
        // truncated — mirrors trimAutolinkTail's paren balancing for the bare-URL path.
        const rparen = matchLinkClose(text, close + 2);
        if (rparen >= close + 2) {
          pushText();
          out.push({ t: 'link', href: text.slice(close + 2, rparen), children: parseInline(text.slice(i + 1, close), true) });
          i = rparen + 1;
          continue;
        }
      }
    }
    // bare-URL autolink: http(s)://… up to whitespace/`<`, trailing punctuation trimmed.
    // Suppressed inside a link label so a URL in the label does not nest a second link.
    if (!inLink && c === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i))) {
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
    case 'table':
      return [b.header, ...b.rows].map((row) => row.map(inlineToText).join(' ')).join('\n');
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

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    // GFM table: a pipe-bearing header row whose NEXT line is a delimiter row with the same cell
    // count. Body rows continue while they contain a pipe and aren't blank.
    if (!h && !b && line.includes('|') && idx + 1 < lines.length) {
      const headerCells = splitTableRow(line);
      const delimCount = delimiterCellCount(lines[idx + 1]);
      if (delimCount > 0 && delimCount === headerCells.length) {
        flushPara(); flushBullets();
        const header = headerCells.map((c) => parseInline(c));
        const rows: Inline[][][] = [];
        let j = idx + 2;
        while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
          rows.push(splitTableRow(lines[j]).map((c) => parseInline(c)));
          j++;
        }
        blocks.push({ t: 'table', header, rows });
        idx = j - 1;
        continue;
      }
    }
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
