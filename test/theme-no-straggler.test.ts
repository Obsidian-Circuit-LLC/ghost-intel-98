// test/theme-no-straggler.test.ts
//
// Quiet-amethyst NO-STRAGGLER guard (plan Task 9).
//
// Scans the *themed* renderer source for raw palette / text colour literals —
// hex (#rgb / #rgba / #rrggbb / #rrggbbaa) and the CSS colour keywords
// silver / navy / white / black / grey / gray / teal — that are used as a
// colour value (a `color`/`background`/`fill`/… declaration in CSS, or a
// colour-ish key in a TSX inline-style object). Every such literal MUST be one
// of:
//   (a) a `--ga98-*` custom-property DEFINITION (the token layer itself), OR
//   (b) listed in THEME_COLOR_ALLOWLIST (content-intrinsic, or a classic-parity
//       literal kept + re-routed for amethyst via a CSS override), OR
//   (c) inside a data: URI or an inline <svg>…</svg> block (image payload).
//
// Anything else is a straggler: a hardcoded colour that will not follow the
// quiet-amethyst skin (typically dark-on-dark or light-on-light under the
// near-black theme). The test FAILS and prints every straggler with its file,
// line, literal and the offending source line.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAPER_BG_LITERALS,
  PAPER_SURFACE_ALLOW,
  THEME_COLOR_ALLOWLIST,
} from './helpers/theme-allowlist';

const ROOT = join(__dirname, '..');

// ── which files are "themed source" ────────────────────────────────────────
// Every renderer file that paints skinned UI. `components/**` is included
// alongside shell + modules because App-level dialogs (CaseDialogs) and pickers
// (ChatSharePicker) and the graph canvas live there and carry live colour
// literals — omitting them let silver/navy islands hide under amethyst while the
// guard stayed green.
const SCAN: Array<{ dir: string; exts: string[] }> = [
  { dir: 'src/renderer/shell', exts: ['.tsx', '.css'] },
  { dir: 'src/renderer/modules', exts: ['.tsx', '.css'] },
  { dir: 'src/renderer/components', exts: ['.tsx', '.css'] },
];
const SINGLE_FILES = [
  'src/renderer/styles/theme.css',
  'src/renderer/styles/98.overrides.css',
  'src/renderer/App.tsx',
  'src/renderer/main.tsx',
];

function walk(dir: string, exts: string[], out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const { dir, exts } of SCAN) walk(join(ROOT, dir), exts, files);
  for (const f of SINGLE_FILES) files.push(join(ROOT, f));
  return files.sort();
}

// ── literal detection ───────────────────────────────────────────────────────
const ALLOW = new Set(THEME_COLOR_ALLOWLIST.map((s) => s.toLowerCase()));
// Base light "paper" literals whose BACKGROUND use is selector-scoped (see theme-allowlist.ts).
const PAPER_BG = new Set(PAPER_BG_LITERALS.map((s) => s.toLowerCase()));
// A property that paints a surface fill: `background`, `background-color`, `background-image`.
const BG_PROP_RE = /background/i;
// A reviewed paper surface is any selector CONTAINING one of the allow fragments.
function selectorAllowsPaper(selector: string): boolean {
  return PAPER_SURFACE_ALLOW.some((p) => selector.includes(p.selector));
}
const KEYWORDS = ['silver', 'navy', 'white', 'black', 'grey', 'gray', 'teal'];
// A hex colour token: 3, 4, 6 or 8 hex digits.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
// A keyword used as a *value*: preceded by `:` (CSS/JS prop) or wrapped as a
// standalone quoted string. Captures the keyword.
const KEYWORD_VALUE_RE = new RegExp(
  `(?::\\s*|['"\\s])(${KEYWORDS.join('|')})(?=['"\\s;,}\\)]|$)`,
  'gi',
);

function isValidHex(tok: string): boolean {
  const n = tok.length - 1; // minus '#'
  return n === 3 || n === 4 || n === 6 || n === 8;
}

// Blank a matched region with spaces but PRESERVE newlines, so line numbers in
// the cleaned text stay aligned with the raw source.
function blank(m: string): string {
  return m.replace(/[^\n]/g, ' ');
}

// Remove regions exempt under rule (c): data: URIs and inline <svg>…</svg>.
function stripExemptRegions(text: string): string {
  return text
    // <svg …> … </svg>  (image payload; may contain fill="#..." etc.)
    .replace(/<svg[\s\S]*?<\/svg>/gi, blank)
    // data: URIs up to the closing quote / paren / whitespace
    .replace(/data:[^'"\)\s]+/gi, blank);
}

// Strip CSS comments so hex mentioned in prose (e.g. "classic #900") is ignored.
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank);
}

// Strip JS/TS comments (block + line). `://` in URLs is protected because a
// line comment only starts at `//` preceded by start-of-line or whitespace.
function stripJsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[\s;{(])\/\/[^\n]*/g, blank);
}

interface Straggler {
  file: string;
  line: number;
  literal: string;
  src: string;
}

// A property NAME (CSS-hyphenated or JS-camelCase) is "colour-ish" when it can
// carry a colour value: it contains one of these stems. This lets a bare
// keyword (`white`) be scored only in a colour context, never as prose, while
// hex is scored in every declaration value (a hex in a value is always a
// colour). Catches camelCase JS keys — backgroundColor, borderBottom,
// boxShadow — which a hyphen-only pattern would miss.
const COLOR_KEY_STEM = /(?:colou?r|background|border|fill|stroke|shadow|outline)/i;
// A declaration head in either dialect: `key:` where key is a CSS/JS identifier.
const DECL_RE = /(^|[\s;{,(])(-{0,2}[A-Za-z][A-Za-z0-9-]*)\s*:/g;

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

// The selector text of the CSS rule enclosing `index`. Scans back to the rule's `{`, then to the
// preceding `}` / `{` / `;` (or start). The stylesheets are flat (no nesting), so this yields the
// full — possibly comma-grouped — prelude, e.g. `.ga98-report-toolbar button, .ga98-report select`.
function enclosingSelector(text: string, index: number): string {
  const open = text.lastIndexOf('{', index);
  if (open === -1) return '';
  let start = 0;
  for (let i = open - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}' || c === '{' || c === ';') {
      start = i + 1;
      break;
    }
  }
  return text.slice(start, open).replace(/\s+/g, ' ').trim();
}

interface ValueContext {
  colorish: boolean; // property can carry a colour keyword value
  isBg: boolean; // property is a background* fill
  isCss: boolean; // .css file (selector scoping only applies to CSS)
  selector: string; // enclosing CSS selector (empty for TSX inline styles)
  hasVar: boolean; // value references var(--token, …) → background is token-driven
}

function pushLiteralsFromValue(
  val: string,
  ctx: ValueContext,
  file: string,
  line: number,
  src: string,
  out: Straggler[],
): void {
  HEX_RE.lastIndex = 0;
  let hm: RegExpExecArray | null;
  while ((hm = HEX_RE.exec(val)) !== null) {
    const tok = hm[0];
    if (!isValidHex(tok)) continue;
    const low = tok.toLowerCase();
    // Selector-scoped paper-background enforcement: a base light "paper" literal used as a CSS
    // background fill (not a var() fallback) is exempt ONLY on a REVIEWED paper surface. This closes
    // the value-only blind spot — a real light chrome island can no longer ride the global exemption.
    if (ctx.isCss && ctx.isBg && !ctx.hasVar && PAPER_BG.has(low)) {
      if (selectorAllowsPaper(ctx.selector)) continue;
      out.push({ file, line, literal: tok, src });
      continue;
    }
    if (ALLOW.has(low)) continue;
    out.push({ file, line, literal: tok, src });
  }
  if (!ctx.colorish) return; // keywords only count inside a colour-property value
  KEYWORD_VALUE_RE.lastIndex = 0;
  let km: RegExpExecArray | null;
  while ((km = KEYWORD_VALUE_RE.exec(val)) !== null) {
    const kw = km[1].toLowerCase();
    if (ALLOW.has(kw)) continue;
    out.push({ file, line, literal: kw, src });
  }
}

function scanText(rel: string, raw: string, isCss: boolean): Straggler[] {
  const cleaned = isCss
    ? stripCssComments(stripExemptRegions(raw))
    : stripJsComments(stripExemptRegions(raw));
  const rawLines = raw.split('\n');
  const out: Straggler[] = [];

  // Walk every `property: value` declaration. The value runs from the `:` to
  // the next `;`, `}` or newline — so a multi-line CSS gradient's head line is
  // covered and its continuation lines are picked up as their own value slices,
  // while a JS inline-style entry never bleeds into the next property. A
  // `--custom` property DEFINITION is the token layer → skipped (exemption a).
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(cleaned)) !== null) {
    const prop = m[2];
    const valStart = m.index + m[0].length;
    let end = cleaned.length;
    for (let k = valStart; k < cleaned.length; k++) {
      const c = cleaned[k];
      if (c === ';' || c === '}' || c === '\n') {
        end = k;
        break;
      }
    }
    DECL_RE.lastIndex = end;
    if (prop.startsWith('--')) continue; // token definition → exempt
    const val = cleaned.slice(valStart, end);
    const line = lineOf(cleaned, valStart);
    pushLiteralsFromValue(
      val,
      {
        colorish: COLOR_KEY_STEM.test(prop),
        isBg: BG_PROP_RE.test(prop),
        isCss,
        selector: isCss ? enclosingSelector(cleaned, m.index) : '',
        hasVar: /var\(/.test(val),
      },
      rel,
      line,
      (rawLines[line - 1] ?? '').trim(),
      out,
    );
  }

  // Continuation lines of a multi-line CSS value (e.g. a gradient's colour
  // stops on their own lines) have no `key:` head, so the declaration walk
  // above misses them. For CSS only, additionally scan every line that is a
  // bare value continuation (no `:` , not a selector/brace line) for hex.
  if (isCss) {
    const lines = cleaned.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.includes(':') || ln.includes('{') || ln.includes('}')) continue;
      HEX_RE.lastIndex = 0;
      let hm: RegExpExecArray | null;
      while ((hm = HEX_RE.exec(ln)) !== null) {
        const tok = hm[0];
        if (!isValidHex(tok)) continue;
        if (ALLOW.has(tok.toLowerCase())) continue;
        out.push({ file: rel, line: i + 1, literal: tok, src: (rawLines[i] ?? '').trim() });
      }
    }
  }
  return out;
}

function scanFile(abs: string): Straggler[] {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  return scanText(rel, readFileSync(abs, 'utf8'), abs.endsWith('.css'));
}

describe('quiet-amethyst no-straggler guard', () => {
  it('has no un-tokenised palette/text colour literals in themed source', () => {
    const files = collectFiles();
    const stragglers: Straggler[] = [];
    for (const f of files) stragglers.push(...scanFile(f));

    if (stragglers.length > 0) {
      const report = stragglers
        .map((s) => `  ${s.file}:${s.line}  ${s.literal}\n      ${s.src}`)
        .join('\n');
      // eslint-disable-next-line no-console
      console.error(`\n${stragglers.length} straggler(s):\n${report}\n`);
    }
    expect(stragglers.map((s) => `${s.file}:${s.line} ${s.literal}`)).toEqual([]);
  });

  // Proves the criterion the value-only allowlist could NOT enforce: a real light chrome island
  // painted with an already-allow-listed paper literal can no longer ride the exemption — the
  // exemption is now tied to a REVIEWED selector, not the bare value.
  it('selector-scopes paper backgrounds so a real light island cannot ride a paper literal', () => {
    // An un-reviewed selector painting a paper literal as its background → straggler (the bug class).
    const island = scanText('synthetic.css', '.ga98-made-up-drawer { background: #fff; }', true);
    expect(island.map((s) => s.literal)).toEqual(['#fff']);

    // A reviewed content-paper surface with the SAME literal → exempt.
    expect(scanText('synthetic.css', '.ga98-report-page { background: #fff; }', true)).toEqual([]);

    // A token-driven background (literal is only a var() fallback) → exempt, theme owns it.
    expect(
      scanText('synthetic.css', '.ga98-made-up { background: var(--ga98-grey, #c0c0c0); }', true),
    ).toEqual([]);

    // A FOREGROUND use of the same literal is not selector-scoped → stays globally exempt.
    expect(scanText('synthetic.css', '.ga98-made-up { color: #fff; }', true)).toEqual([]);
  });
});
